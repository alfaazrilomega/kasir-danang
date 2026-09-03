import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Banknote,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Minus,
  Pause,
  Pencil,
  PlayCircle,
  Plus,
  QrCode,
  ShoppingCart,
  Smartphone,
  Tag,
  Trash2,
  UserSearch,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/lib/db';
import { useCart, cartTotals } from '@/stores/cart';
import { useAuth } from '@/stores/auth';
import { useUI } from '@/stores/ui';
import { resolveFeatures } from '@/lib/industries';
import { cn, formatMoney, nextOrderNumber, uuid, isUuid } from '@/lib/format';
import type { Customer, Order, OrderItem, OrderType, PaymentMethod, Promo } from '@/types';
import { channelFeePercent, channelLabel, isMarketplace, resolveChannels } from '@/lib/channels';
import { enqueueOrder } from '@/lib/sync';
import { logSaleToActiveShift } from '@/lib/shiftHelpers';
import { ReceiptModal } from '@/components/cart/ReceiptModal';

export function OrderPanel() {
  const {
    lines, orderType, tableNumber, payment, customerId, promo, manualDiscount, receivedAmount,
    parked, salesChannel, paymentTerm, dueDate, externalOrderNo,
    setOrderType, setTable, setPayment, updateQty, remove, setNote, setPrice, clear, setPromo,
    setManualDiscount, setReceivedAmount, setCustomer, park, resume, dropParked,
    setSalesChannel, setPaymentTerm, setDueDate, setExternalOrderNo,
  } = useCart();
  const { profile, store } = useAuth();
  const collapsed = useUI((s) => s.cartCollapsed);
  const toggleCart = useUI((s) => s.toggleCart);
  const features = resolveFeatures(store?.industry, store?.features as never);
  const taxRate = Number(store?.tax_rate ?? 0);
  const pointsPerAmount = Number(store?.points_per_amount ?? 0);
  const totals = useMemo(
    () => cartTotals(lines, taxRate, promo, manualDiscount, pointsPerAmount),
    [lines, taxRate, promo, manualDiscount, pointsPerAmount],
  );
  const [busy, setBusy] = useState(false);

  const channelRows =
    useLiveQuery(
      () => db.sales_channels.where('store_id').equals(profile?.store_id ?? '').toArray(),
      [profile?.store_id],
    ) ?? [];
  const channels = useMemo(() => resolveChannels(channelRows), [channelRows]);

  // Peringatan lunak untuk No. Pesanan yang sudah pernah dicatat. Sengaja tidak
  // memblokir: kolomnya tidak unique di database (lihat migrasi 009), dan
  // pembatalan/pesanan ulang bisa memakai nomor yang sama.
  const duplicateOrder = useLiveQuery(async () => {
    const target = externalOrderNo.trim().toUpperCase();
    if (!target) return null;
    const rows = await db.orders.where('store_id').equals(profile?.store_id ?? '').toArray();
    return rows.find((row) => (row.external_order_no ?? '').toUpperCase() === target) ?? null;
  }, [externalOrderNo, profile?.store_id]) ?? null;

  const getNextNum = (channel = salesChannel) =>
    nextOrderNumber({
      storeName: store?.name || 'Toko',
      platform: channelLabel(channel, channelRows),
    });
  // Pakai getNextNum supaya konsisten dengan pergantian channel: sebelumnya
  // render pertama memakai kode mentah ("shopee") sedangkan getNextNum memakai
  // label ("Shopee"), jadi nomor berubah sendiri saat channel diklik.
  const [orderNumber, setOrderNumber] = useState(() => getNextNum(salesChannel));
  // Order ID yang diketik kasir. Kosong berarti pakai nomor otomatis.
  const [manualOrderNo, setManualOrderNo] = useState('');
  /** Alasan selisih antara total pesanan dan dana yang benar-benar diterima. */
  const [adjustNote, setAdjustNote] = useState('');
  const finalOrderNumber = manualOrderNo.trim() || orderNumber;

  // Nomor pesanan wajib unik: Retur Barang memanggil pesanan lewat nomor ini,
  // jadi dua pesanan bernomor sama membuat pencarian retur menjadi ambigu.
  const duplicateOrderNumber = useLiveQuery(async () => {
    const target = manualOrderNo.trim().toUpperCase();
    if (!target) return null;
    const rows = await db.orders.where('store_id').equals(profile?.store_id ?? '').toArray();
    return rows.find((row) => (row.order_number ?? '').toUpperCase() === target) ?? null;
  }, [manualOrderNo, profile?.store_id]) ?? null;
  const [promoOpen, setPromoOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<{ order: Order; items: OrderItem[]; customer: Customer | null } | null>(null);

  const customer = useLiveQuery(
    () => (customerId ? db.customers.get(customerId) : Promise.resolve<Customer | undefined>(undefined)),
    [customerId],
  );
  const feePercent = channelFeePercent(salesChannel, channelRows);
  const isTempo = paymentTerm === 'tempo';
  // Perkiraan uang yang benar-benar masuk setelah potongan marketplace.
  const estimatedNet = isTempo ? totals.total * (1 - feePercent / 100) : totals.total;

  const change = payment === 'cash' && !isTempo ? Math.max(0, receivedAmount - totals.total) : 0;

  // Untuk metode selain tunai, angka yang diketik bukan uang kembalian
  // melainkan total yang BENAR-BENAR diterima setelah potongan biaya admin
  // marketplace. Sebelumnya kolom ini terkunci untuk non-tunai, jadi selisih
  // itu baru bisa dicatat belakangan lewat Riwayat Transaksi — pekerjaan
  // tambahan untuk sesuatu yang sudah diketahui saat transaksinya dibuat.
  const settlementDiisi = !isTempo && payment !== 'cash' && receivedAmount > 0;
  const settlementSelisih = settlementDiisi ? receivedAmount - totals.total : 0;
  const totalAkhir = settlementDiisi ? receivedAmount : totals.total;
  const cashShort =
    payment === 'cash' && !isTempo && receivedAmount > 0 && receivedAmount < totals.total;

  /** Ganti channel: marketplace default tempo, offline default tunai. Update suffix order_number. */
  function pickChannel(code: string) {
    setSalesChannel(code);
    setOrderNumber(getNextNum(code));
    const meta = channels.find((c) => c.code === code);
    if (isMarketplace(code)) {
      setPaymentTerm('tempo');
      const days = meta?.default_term_days ?? 0;
      setDueDate(new Date(Date.now() + days * 86400000).toISOString().slice(0, 10));
    } else {
      setPaymentTerm('cash');
      setDueDate('');
    }
  }

  async function placeOrder() {
    if (lines.length === 0) {
      toast.error('Keranjang kosong.');
      return;
    }
    if (!profile?.store_id || !store) {
      toast.error('Tidak ada toko aktif.');
      return;
    }
    if (cashShort) {
      toast.error('Uang yang diterima kurang dari total.');
      return;
    }
    if (duplicateOrderNumber) {
      toast.error(
        `Order ID ${manualOrderNo.trim()} sudah dipakai pesanan lain. Ganti nomornya.`,
      );
      return;
    }
    if (isTempo && !dueDate) {
      toast.error('Penjualan tempo wajib punya tanggal jatuh tempo.');
      return;
    }
    if (
      duplicateOrder &&
      !confirm(
        `No. Pesanan ${externalOrderNo.trim()} sudah tercatat di ${duplicateOrder.order_number}.

Lanjutkan simpan?`,
      )
    ) {
      return;
    }
    setBusy(true);
    const orderId = uuid();
    const nowIso = new Date().toISOString();

    // Order tempo belum menghasilkan uang tunai, jadi tidak masuk kas shift.
    const shiftId =
      payment === 'cash' && !isTempo
        ? await logSaleToActiveShift({ storeId: profile.store_id, amount: totals.total, orderId })
        : null;

    const order = {
      id: orderId,
      store_id: profile.store_id,
      customer_id: customerId,
      // Nama pelanggan lepas belum diisi dari POS; kolomnya dipakai
      // impor rekap marketplace.
      customer_name: null,
      // Akun demo punya id non-UUID ('usr-cashier-001') yang tidak ada di
      // tabel profiles, jadi dikirim null agar order tetap tersimpan di server.
      cashier_id: isUuid(profile.id) ? profile.id : null,
      order_number: finalOrderNumber,
      subtotal: totals.subtotal,
      tax: totals.tax,
      discount: totals.discount,
      total: totalAkhir,
      payment_method: payment,
      payment_status: (isTempo ? 'unpaid' : 'paid') as 'paid' | 'unpaid',
      order_status: 'done' as const,
      order_type: orderType,
      table_number: tableNumber || null,
      notes: null,
      created_at: nowIso,
      promo_code: promo?.code ?? null,
      received_amount: isTempo ? 0 : receivedAmount || totals.total,
      change_amount: payment === 'cash' && !isTempo ? change : 0,
      points_earned: totals.pointsEarned,
      shift_id: shiftId,
      sales_channel: salesChannel,
      payment_term: paymentTerm,
      due_date: isTempo ? dueDate : null,
      paid_amount: isTempo ? 0 : totalAkhir,
      settled_at: isTempo ? null : nowIso,
      // Selisih dana yang masuk dicatat memakai kolom penyesuaian yang sama
      // dengan fitur "Sesuaikan Harga" di Riwayat Transaksi, supaya satu
      // kejadian tidak punya dua bentuk penyimpanan yang berbeda.
      original_total: settlementSelisih !== 0 ? totals.total : null,
      adjustment_amount: settlementSelisih,
      adjustment_note: settlementSelisih !== 0 ? adjustNote.trim() || null : null,
      adjusted_at: settlementSelisih !== 0 ? nowIso : null,
      adjusted_by: settlementSelisih !== 0 && isUuid(profile.id) ? profile.id : null,
      external_order_no: isMarketplace(salesChannel)
        ? externalOrderNo.trim() || null
        : null,
    };
    const itemsPayload = lines.map((l) => ({
      product_id: l.product_id,
      name: l.name,
      size: l.size,
      qty: l.qty,
      price: l.price,
      note: l.note || null,
      cost_price: l.cost_price,
    }));

    try {
      await enqueueOrder({
        id: orderId,
        payload: { order, items: itemsPayload },
        created_at: nowIso,
        attempts: 0,
      });

      // Fetch the stored items with proper IDs for receipt display.
      const storedItems = await db.order_items.where('order_id').equals(orderId).toArray();

      toast.success(
        isTempo
          ? `Order ${finalOrderNumber} dicatat sebagai piutang, jatuh tempo ${dueDate}.`
          : `Order ${finalOrderNumber} disimpan.`,
      );
      setLastOrder({
        order: order as Order,
        items: storedItems.length ? storedItems : itemsPayload.map((it, idx) => ({
          ...it,
          id: `${orderId}:${idx}`,
          order_id: orderId,
        })),
        customer: customer ?? null,
      });
      clear();
      setOrderNumber(getNextNum());
      setManualOrderNo('');
      setAdjustNote('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan order.');
    } finally {
      setBusy(false);
    }
  }

  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const isEmpty = lines.length === 0;

  // Empty cart with no parked orders → render only modals (receipt may be showing).
  if (isEmpty && parked.length === 0) {
    return <ReceiptModal data={lastOrder} onClose={() => setLastOrder(null)} />;
  }

  // Empty cart, but parked orders exist → floating pill to resume them.
  if (isEmpty) {
    return (
      <>
        <button
          onClick={() => setParkedOpen(true)}
          className="fixed bottom-6 right-6 z-20 inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white shadow-xl shadow-amber-500/30 hover:bg-amber-600"
          title="Lihat & resume order yang di-park"
        >
          <PlayCircle size={16} /> {parked.length} parked
        </button>
        <ParkedOrdersModal
          open={parkedOpen}
          onClose={() => setParkedOpen(false)}
          parked={parked}
          currency={store?.currency}
          onResume={(id) => {
            if (resume(id)) {
              toast.success('Order di-resume.');
              setParkedOpen(false);
            }
          }}
          onDrop={(id) => {
            if (confirm('Hapus order parked ini?')) dropParked(id);
          }}
        />
        <ReceiptModal data={lastOrder} onClose={() => setLastOrder(null)} />
      </>
    );
  }

  if (collapsed) {
    return (
      <>
        <Card className="fixed bottom-6 right-6 z-20 w-72 max-w-[calc(100vw-2rem)] flex h-fit flex-col p-3 shadow-xl shadow-black/20">
          <button
            onClick={toggleCart}
            className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800"
            title="Buka order panel"
          >
            <span className="flex items-center gap-2">
              <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                <ShoppingCart size={16} />
                {itemCount > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                    {itemCount}
                  </span>
                )}
              </span>
              <span className="text-left">
                <span className="block text-[11px] text-ink-500">Order {finalOrderNumber}</span>
                <span className="block text-sm font-semibold">{formatMoney(totals.total, store?.currency)}</span>
              </span>
            </span>
            <ChevronUp size={16} className="text-ink-500" />
          </button>
          {parked.length > 0 && (
            <button
              onClick={() => setParkedOpen(true)}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-amber-100 dark:bg-amber-500/20 px-2 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/30"
            >
              <PlayCircle size={12} /> {parked.length} parked
            </button>
          )}
          <Button
            id="btn-place-order"
            className="mt-2 w-full"
            size="sm"
            onClick={placeOrder}
            disabled={busy || lines.length === 0}
            title="Place order (F9)"
          >
            Place Order
          </Button>
        </Card>
        <ParkedOrdersModal
          open={parkedOpen}
          onClose={() => setParkedOpen(false)}
          parked={parked}
          currency={store?.currency}
          onResume={(id) => {
            if (lines.length > 0) {
              const ok = confirm('Keranjang aktif akan di-park dulu. Lanjut?');
              if (!ok) return;
              park();
            }
            if (resume(id)) {
              toast.success('Order di-resume.');
              setParkedOpen(false);
            }
          }}
          onDrop={(id) => {
            if (confirm('Hapus order parked ini?')) dropParked(id);
          }}
        />
        <ReceiptModal data={lastOrder} onClose={() => setLastOrder(null)} />
      </>
    );
  }

  return (
    <>
      <Card className="fixed top-24 right-4 left-4 md:left-auto md:right-6 z-20 md:w-[400px] flex h-fit flex-col max-h-[calc(100vh-7rem)] shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between p-4 border-b border-ink-100 dark:border-ink-800">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Order Details</div>
          </div>
          <div className="flex items-center gap-2">
            {parked.length > 0 && (
              <button
                onClick={() => setParkedOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/30"
                title="Lihat & resume order yang di-park"
              >
                <PlayCircle size={12} /> {parked.length} parked
              </button>
            )}
            <button
              onClick={toggleCart}
              className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
              title="Sembunyikan panel"
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        {/* Order ID menempati baris yang dulu dipakai Dine In / Take Away dan
            nomor meja. Tokonya jualan online: yang perlu dilihat kasir di sini
            adalah nomor pesanannya, bukan tempat duduk. Kolomnya juga harus
            berada di tempat nomornya ditampilkan — sebelumnya nomor terlihat di
            atas sementara kolom isiannya jauh di bawah, dan kasir tidak
            menemukan cara mengubahnya. */}
        <div className="border-b border-ink-100 p-4 dark:border-ink-800">
          <label
            htmlFor="input-order-id"
            className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-500 dark:text-ink-400"
          >
            <Pencil className="h-3 w-3" aria-hidden /> Order ID
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="input-order-id"
              value={manualOrderNo}
              onChange={(e) => setManualOrderNo(e.target.value)}
              placeholder={orderNumber}
              className="!py-2 flex-1"
            />
            {manualOrderNo.trim() !== '' && (
              <button
                type="button"
                onClick={() => setManualOrderNo('')}
                className="shrink-0 rounded-lg border border-ink-200 px-2.5 py-2 text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                title="Kembali ke nomor otomatis"
              >
                Otomatis
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
            {manualOrderNo.trim()
              ? 'Nomor manual dipakai; penomoran otomatis dilewati.'
              : `Dikosongkan berarti pakai nomor otomatis: ${orderNumber}`}
          </p>
          {duplicateOrderNumber && (
            <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-300">
              Nomor ini sudah dipakai pesanan lain.
            </p>
          )}
        </div>

        {(features.useOrderType || features.useTable) && (
          <div
            className={cn(
              'grid gap-2 p-4 border-b border-ink-100 dark:border-ink-800',
              features.useOrderType && features.useTable ? 'grid-cols-2' : 'grid-cols-1',
            )}
          >
            {features.useOrderType && (
              <Segmented
                value={orderType}
                onChange={(v) => setOrderType(v as OrderType)}
                options={[
                  { value: 'dine_in', label: 'Dine In' },
                  { value: 'take_away', label: 'Take Away' },
                ]}
              />
            )}
            {features.useTable && (
              <Input
                placeholder="No. meja"
                value={tableNumber}
                onChange={(e) => setTable(e.target.value)}
                className="!py-2"
              />
            )}
          </div>
        )}

        <div className="px-4 pt-3 pb-1">
          <button
            onClick={() => setCustOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-ink-200 dark:border-ink-700 px-3 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
          >
            <span className="flex items-center gap-2">
              <UserSearch size={14} className="text-ink-500" />
              {customer ? (
                <>
                  <span className="font-medium">{customer.name}</span>
                  <span className="text-xs text-ink-500">· {customer.points} poin</span>
                </>
              ) : (
                <span className="text-ink-500">Pilih pelanggan (opsional)</span>
              )}
            </span>
            {customer && (
              <span onClick={(e) => { e.stopPropagation(); setCustomer(null); }} className="rounded-full p-1 hover:bg-ink-200 dark:hover:bg-ink-700">
                <X size={12} />
              </span>
            )}
          </button>
        </div>

        {/* Seluruh isi panel ikut digulir. Sebelumnya hanya daftar barang
            yang bisa digulir, sehingga pada layar 1366x768 tombol Place
            Order terpotong dan tidak bisa ditekan sama sekali. */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 space-y-3">
          {lines.length === 0 && (
            <p className="text-center text-sm text-ink-500 py-12">Pilih menu atau tembak barcode untuk memulai.</p>
          )}
          {lines.map((l, i) => (
            <div key={`${l.product_id}-${l.size}-${i}`} className="rounded-xl border border-ink-100 dark:border-ink-800 p-3">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-lg bg-ink-100 dark:bg-ink-800">
                  {l.image_url && <img src={l.image_url} alt={l.name} className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{l.name}</div>
                      <div className="flex items-center gap-1 text-xs text-ink-500">
                        {l.size && <span>Size: {l.size}</span>}
                        {l.sku && <span>· {l.sku}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => remove(i)}
                      className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      title="Hapus"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-1 text-sm font-bold">{formatMoney(l.price * l.qty, store?.currency)}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateQty(i, l.qty - 1)}
                    className="grid h-7 w-7 place-items-center rounded-full border border-ink-200 dark:border-ink-700"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{l.qty}</span>
                  <button
                    onClick={() => updateQty(i, l.qty + 1)}
                    className="grid h-7 w-7 place-items-center rounded-full border border-ink-200 dark:border-ink-700"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <input
                  placeholder="Catatan..."
                  value={l.note}
                  onChange={(e) => setNote(i, e.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-ink-200 dark:border-ink-700 dark:bg-ink-900 px-2 py-1 text-xs focus:outline-none focus:border-brand-500"
                />
              </div>
              {/* Harga satuan bisa ditimpa manual: potongan tiap marketplace
                  berbeda, jadi yang dibayar pembeli sering tidak sama dengan
                  harga master produk. */}
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[11px] text-ink-500 dark:text-ink-400">Harga satuan</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={l.price}
                  onChange={(e) => setPrice(i, Number(e.target.value))}
                  className="w-28 rounded-lg border border-ink-200 px-2 py-1 text-right text-xs tabular-nums focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
                />
                {l.price !== l.base_price && (
                  <button
                    type="button"
                    onClick={() => setPrice(i, l.base_price)}
                    className="text-[11px] text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
                    title={`Harga master ${formatMoney(l.base_price, store?.currency)}`}
                  >
                    kembalikan
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-ink-100 dark:border-ink-800 p-4 space-y-3">
          <button
            onClick={() => setPromoOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-dashed border-ink-200 dark:border-ink-700 px-3 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
          >
            <span className="flex items-center gap-2">
              <Tag size={14} className="text-ink-500" />
              {promo ? (
                <span><span className="font-mono text-brand-600">{promo.code}</span> · {promo.name}</span>
              ) : (
                <span className="text-ink-500">Terapkan promo</span>
              )}
            </span>
            {promo ? (
              <span onClick={(e) => { e.stopPropagation(); setPromo(null); }} className="rounded-full p-1 hover:bg-ink-200">
                <X size={12} />
              </span>
            ) : (
              <Plus size={14} className="text-ink-500" />
            )}
          </button>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-ink-500 mb-0.5">Diskon manual</label>
              <input
                type="number"
                value={manualDiscount || ''}
                onChange={(e) => setManualDiscount(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="input !py-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] text-ink-500 mb-0.5">
                {payment === 'cash' ? 'Uang diterima' : 'Total riil diterima'}
              </label>
              <input
                type="number"
                value={receivedAmount || ''}
                onChange={(e) => setReceivedAmount(parseFloat(e.target.value) || 0)}
                placeholder={formatMoney(totals.total, store?.currency)}
                title={
                  payment === 'cash'
                    ? 'Uang yang diserahkan pembeli.'
                    : 'Isi bila dana yang masuk berbeda dari total, misalnya sudah dipotong biaya admin marketplace. Kosongkan bila sama.'
                }
                className="input !py-1.5"
                disabled={isTempo}
              />
            </div>
          </div>

          {settlementSelisih !== 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="flex items-center justify-between text-xs text-amber-900 dark:text-amber-100">
                <span>Selisih terhadap total</span>
                <span className="font-semibold">
                  {settlementSelisih > 0 ? '+' : '−'}
                  {formatMoney(Math.abs(settlementSelisih), store?.currency)}
                </span>
              </div>
              <input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="Alasan, cth. potongan admin & ongkir Shopee"
                className="input !py-1.5 text-xs"
              />
              <p className="text-[11px] text-amber-900/80 dark:text-amber-100/80">
                Barang dan harga satuan tidak diubah — hanya total pesanan, supaya laporan
                penjualan memakai angka yang benar-benar diterima. Total awal tetap tersimpan.
              </p>
            </div>
          )}

          {payment === 'cash' && totals.total > 0 && (
            <QuickTender
              total={totals.total}
              currency={store?.currency}
              onPick={(amt) => setReceivedAmount(amt)}
            />
          )}

          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatMoney(totals.subtotal, store?.currency)} />
            {totals.discount > 0 && (
              <Row label="Diskon" value={`-${formatMoney(totals.discount, store?.currency)}`} red />
            )}
            <Row label={`Pajak (${taxRate}%)`} value={formatMoney(totals.tax, store?.currency)} />
            <div className="border-t border-dashed border-ink-200 dark:border-ink-700 my-1" />
            <Row label="Total" value={formatMoney(totals.total, store?.currency)} bold />
            {payment === 'cash' && receivedAmount > 0 && (
              <Row
                label="Kembali"
                value={formatMoney(change, store?.currency)}
                red={cashShort}
              />
            )}
            {totals.pointsEarned > 0 && (
              <Row label="Poin loyalitas" value={`+${totals.pointsEarned}`} muted />
            )}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">Channel Penjualan</div>
            <div className="flex flex-wrap gap-1.5">
              {channels.map((channel) => (
                <button
                  key={channel.code}
                  onClick={() => pickChannel(channel.code)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    salesChannel === channel.code
                      ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                      : 'bg-ink-100 text-ink-600 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-300',
                  )}
                >
                  {channel.name}
                </button>
              ))}
            </div>

            {isMarketplace(salesChannel) && (
              <div className="mt-2">
                <label className="mb-1 block text-[11px] font-semibold text-ink-600 dark:text-ink-300">
                  No. Pesanan Platform
                </label>
                <input
                  className="input"
                  value={externalOrderNo}
                  onChange={(e) => setExternalOrderNo(e.target.value)}
                  placeholder="cth. 2608113TQ8HWAB / 585506423461087094"
                />
                <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
                  Nomor asli dari platform, dipakai untuk mencocokkan dana settlement.
                  Kosongkan bila channel ini tidak punya nomor pesanan.
                </p>
                {duplicateOrder && (
                  <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                    No. Pesanan ini sudah tercatat di {duplicateOrder.order_number}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">Pembayaran</div>
            <div className="mb-2 flex gap-1 rounded-full bg-ink-100 p-1 text-xs font-semibold dark:bg-ink-800">
              {(['cash', 'tempo'] as const).map((term) => (
                <button
                  key={term}
                  onClick={() => {
                    setPaymentTerm(term);
                    if (term === 'tempo' && !dueDate) {
                      setDueDate(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
                    }
                  }}
                  className={cn(
                    'flex-1 rounded-full px-3 py-1.5 transition',
                    paymentTerm === term
                      ? 'bg-brand-600 text-white'
                      : 'text-ink-600 dark:text-ink-300',
                  )}
                >
                  {term === 'cash' ? 'Bayar Sekarang' : 'Tempo / Piutang'}
                </button>
              ))}
            </div>

            {isTempo ? (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <label className="block text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  Jatuh tempo pencairan
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="input !py-1.5"
                />
                <div className="text-[11px] text-amber-700 dark:text-amber-300">
                  Tercatat sebagai piutang, belum masuk kas shift.
                  {feePercent > 0 && (
                    <>
                      {' '}Estimasi bersih setelah potongan {feePercent}%:{' '}
                      <span className="font-bold">
                        {formatMoney(estimatedNet, store?.currency)}
                      </span>
                      . Harga bisa disesuaikan di Riwayat Transaksi saat settlement asli masuk.
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                <PayTile icon={Banknote} label="Cash" active={payment === 'cash'} onClick={() => setPayment('cash')} />
                <PayTile icon={QrCode} label="QRIS" active={payment === 'qris'} onClick={() => setPayment('qris')} />
                <PayTile icon={Smartphone} label="E-wallet" active={payment === 'ewallet'} onClick={() => setPayment('ewallet')} />
                <PayTile icon={CreditCard} label="Debit/Credit" active={payment === 'card'} onClick={() => setPayment('card')} />
              </div>
            )}
          </div>

          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-ink-100 p-4 dark:border-ink-800">
            <Button
              id="btn-park-order"
              variant="secondary"
              className="!px-3"
              onClick={() => {
                if (lines.length === 0) {
                  toast.info('Keranjang kosong — tidak ada yang di-park.');
                  return;
                }
                const id = park();
                if (id) {
                  toast.success('Order di-park. Resume kapan saja.');
                  setOrderNumber(getNextNum());
                }
              }}
              title="Park / hold order (Ctrl+P)"
            >
              <Pause size={14} /> Park
            </Button>
            <Button id="btn-cancel-order" variant="secondary" className="flex-1" onClick={() => { clear(); setOrderNumber(getNextNum()); }}>
              Cancel
            </Button>
            <Button id="btn-place-order" className="flex-1" onClick={placeOrder} disabled={busy} title="Place order (F9)">Place Order</Button>
          </div>
      </Card>

      <PromoModal open={promoOpen} onClose={() => setPromoOpen(false)} onSelect={setPromo} />
      <CustomerPickerModal open={custOpen} onClose={() => setCustOpen(false)} onSelect={setCustomer} />
      <ParkedOrdersModal
        open={parkedOpen}
        onClose={() => setParkedOpen(false)}
        parked={parked}
        currency={store?.currency}
        onResume={(id) => {
          if (lines.length > 0) {
            const ok = confirm('Keranjang aktif akan di-park dulu. Lanjut?');
            if (!ok) return;
            park();
          }
          if (resume(id)) {
            toast.success('Order di-resume.');
            setParkedOpen(false);
          }
        }}
        onDrop={(id) => {
          if (confirm('Hapus order parked ini?')) dropParked(id);
        }}
      />
      <ReceiptModal data={lastOrder} onClose={() => setLastOrder(null)} />
    </>
  );
}

function QuickTender({ total, currency, onPick }: { total: number; currency: string | undefined; onPick: (n: number) => void }) {
  // Round up to nearest "nice" denominations larger than total: 5k → 10k → 20k → 50k → 100k.
  const ladders = [5000, 10000, 20000, 50000, 100000];
  const suggestions: number[] = [];
  // Exact total first.
  suggestions.push(Math.ceil(total));
  // Round up to next multiple in each ladder; dedupe.
  for (const step of ladders) {
    const v = Math.ceil(total / step) * step;
    if (v > 0 && !suggestions.includes(v)) suggestions.push(v);
    if (suggestions.length >= 5) break;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.slice(0, 5).map((v, i) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={cn(
            'rounded-lg border border-ink-200 dark:border-ink-700 px-2.5 py-1 text-xs font-semibold hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/40',
            i === 0 && 'border-brand-300 text-brand-700 dark:text-brand-300 dark:border-brand-500/60',
          )}
          title={i === 0 ? 'Pas (tanpa kembali)' : 'Quick tender'}
        >
          {i === 0 ? 'Pas' : formatMoney(v, currency)}
        </button>
      ))}
    </div>
  );
}

function ParkedOrdersModal({
  open, onClose, parked, currency, onResume, onDrop,
}: {
  open: boolean;
  onClose: () => void;
  parked: { id: string; label: string; parked_at: string; lines: { price: number; qty: number }[]; orderType: string }[];
  currency: string | undefined;
  onResume: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Parked Orders (${parked.length})`}>
      <div className="space-y-2">
        {parked.length === 0 ? (
          <p className="text-sm text-ink-500 py-8 text-center">Belum ada order yang di-park.</p>
        ) : (
          parked.map((p) => {
            const total = p.lines.reduce((s, l) => s + l.qty * l.price, 0);
            const items = p.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-ink-100 dark:border-ink-800 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <BookmarkPlus size={14} className="text-amber-500" />
                    <span className="truncate">{p.label}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {items} item · {formatMoney(total, currency)} · {new Date(p.parked_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => onResume(p.id)}>
                    <PlayCircle size={14} /> Resume
                  </Button>
                  <button
                    onClick={() => onDrop(p.id)}
                    className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    title="Hapus"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value, bold, red, muted }: { label: string; value: string; bold?: boolean; red?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between', bold && 'text-base font-bold')}>
      <span className={muted ? 'text-ink-500' : 'text-ink-500'}>{label}</span>
      <span className={cn(red && 'text-rose-600', muted && 'text-ink-500')}>{value}</span>
    </div>
  );
}

function PayTile({ icon: Icon, label, active, onClick }: { icon: typeof CreditCard; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-xl p-2.5 text-[11px] font-semibold leading-tight text-center border transition',
        active
          ? 'bg-brand-600 text-white border-brand-600'
          : 'bg-white border-ink-200 text-ink-700 dark:bg-ink-900 dark:border-ink-700 dark:text-ink-200 hover:border-brand-400',
      )}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-2 rounded-full border border-ink-200 dark:border-ink-700 p-1 text-xs font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-2 py-1.5 transition',
            value === o.value ? 'bg-brand-600 text-white' : 'text-ink-600 dark:text-ink-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PromoModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (p: Promo | null) => void }) {
  const { profile } = useAuth();
  const promos = useLiveQuery(
    () => db.promos.where('store_id').equals(profile?.store_id ?? '').toArray(),
    [profile?.store_id],
  ) ?? [];
  const [code, setCode] = useState('');
  const active = promos.filter((p) => p.is_active);

  function apply(p: Promo) {
    onSelect(p);
    onClose();
  }
  function applyCode() {
    const match = active.find((p) => p.code.toLowerCase() === code.trim().toLowerCase());
    if (!match) {
      toast.error('Kode promo tidak ditemukan.');
      return;
    }
    apply(match);
  }

  return (
    <Modal open={open} onClose={onClose} title="Pilih Promo">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Masukkan kode" className="font-mono uppercase" />
          <Button onClick={applyCode}>Terapkan</Button>
        </div>
        <div className="space-y-2">
          {active.length === 0 && <p className="text-sm text-ink-500">Belum ada promo aktif.</p>}
          {active.map((p) => (
            <button
              key={p.id}
              onClick={() => apply(p)}
              className="flex w-full items-center justify-between rounded-xl border border-ink-100 dark:border-ink-800 p-3 hover:bg-ink-50 dark:hover:bg-ink-800 text-left"
            >
              <div>
                <div className="font-semibold font-mono">{p.code}</div>
                <div className="text-xs text-ink-500">{p.name}</div>
              </div>
              <div className="text-sm font-bold text-brand-600">
                {p.type === 'percent' ? `${p.value}%` : formatMoney(p.value)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CustomerPickerModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (id: string) => void }) {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [q, setQ] = useState('');
  const customers = useLiveQuery(() => db.customers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const filtered = customers.filter((c) =>
    !q ? true : c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone ?? '').includes(q),
  );
  return (
    <Modal open={open} onClose={onClose} title="Pilih Pelanggan">
      <div className="space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau no. HP" />
        <div className="max-h-80 overflow-y-auto space-y-1 scrollbar-thin">
          {filtered.length === 0 && <p className="text-sm text-ink-500 py-8 text-center">Tidak ada pelanggan cocok.</p>}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => { onSelect(c.id); onClose(); }}
              className="flex w-full items-center justify-between rounded-xl border border-ink-100 dark:border-ink-800 p-3 hover:bg-ink-50 dark:hover:bg-ink-800 text-left"
            >
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-ink-500">{c.phone ?? '—'}</div>
              </div>
              <div className="text-xs font-mono text-brand-600">{c.points} pts</div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

