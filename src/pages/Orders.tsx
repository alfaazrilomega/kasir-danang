import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownUp,
  Ban,
  Calendar,
  Download,
  Eye,
  FileText,
  Filter,
  Landmark,
  MessageCircle,
  PencilLine,
  Plus,
  Printer,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullInventoryReference, pullRecentOrders } from '@/lib/sync';
import { resolveFeatures } from '@/lib/industries';
import { SalesImportModal } from '@/components/data/SalesImportModal';
import { channelFeePercent, channelLabel, resolveChannels } from '@/lib/channels';
import { hasCapability } from '@/lib/roles';
import { formatDate, formatDateTime, formatMoney, cn, uuid, isUuid } from '@/lib/format';
import type {
  Customer,
  Order,
  OrderItem,
  OrderPayment,
  OrderPaymentMethod,
  OrderType,
  PaymentMethod,
} from '@/types';
import { useNavigate } from '@/lib/router';
import { countsAsSale } from '@/lib/orderStatus';
import { buildReceiptText, printInvoice, printReceipt, whatsappLink } from '@/lib/receipt';
import { skuMapFor } from '@/lib/printSupport';

type StatusFilter = 'all' | 'done' | 'pending' | 'canceled' | 'awaiting_confirmation';
type PaymentFilter = 'all' | PaymentMethod;
type OrderTypeFilter = 'all' | OrderType;
type SortBy = 'newest' | 'oldest' | 'amount-desc' | 'amount-asc';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'awaiting_confirmation', label: 'Pesanan Website' },
  { value: 'done', label: 'Selesai' },
  { value: 'pending', label: 'Pending' },
  { value: 'canceled', label: 'Dibatalkan' },
];

const PAY_TABS: { value: PaymentFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'cash', label: 'Cash' },
  { value: 'qris', label: 'QRIS' },
  { value: 'ewallet', label: 'E-wallet' },
  { value: 'transfer', label: 'Transfer' },
  // Kasir tidak lagi menawarkan kartu, tapi pesanan lama tetap bisa disaring.
  { value: 'card', label: 'Card' },
  // Penjualan hasil impor massal: metode bayarnya tidak tercatat di berkas.
  { value: 'other', label: 'Lainnya' },
];

const TYPE_TABS: { value: OrderTypeFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'dine_in', label: 'Dine In' },
  { value: 'take_away', label: 'Take Away' },
];

interface Preset {
  key: string;
  label: string;
  range: () => { from: string; to: string };
}

function isoDate(d: Date) {
  // Tanggal kalender LOKAL, bukan UTC. toISOString() di WIB (UTC+7) masih
  // menunjuk hari kemarin sampai pukul 07.00, sehingga rentang bawaan yang
  // berakhir "hari ini" ikut membuang transaksi yang dibuat dini hari —
  // pesanan website tengah malam sempat hilang dari antrian staf karenanya.
  const lokal = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return lokal.toISOString().slice(0, 10);
}

function startOfWeekISO(d: Date) {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  return isoDate(start);
}

const DATE_PRESETS: Preset[] = [
  {
    key: 'today',
    label: 'Hari ini',
    range: () => {
      const t = isoDate(new Date());
      return { from: t, to: t };
    },
  },
  {
    key: 'yesterday',
    label: 'Kemarin',
    range: () => {
      const y = isoDate(new Date(Date.now() - 86400000));
      return { from: y, to: y };
    },
  },
  {
    key: '7d',
    label: '7 hari',
    range: () => ({
      from: isoDate(new Date(Date.now() - 6 * 86400000)),
      to: isoDate(new Date()),
    }),
  },
  {
    key: '30d',
    label: '30 hari',
    range: () => ({
      from: isoDate(new Date(Date.now() - 29 * 86400000)),
      to: isoDate(new Date()),
    }),
  },
  {
    key: 'week',
    label: 'Minggu ini',
    range: () => ({ from: startOfWeekISO(new Date()), to: isoDate(new Date()) }),
  },
  {
    key: 'mtd',
    label: 'Bulan ini',
    range: () => {
      const now = new Date();
      return {
        from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: isoDate(now),
      };
    },
  },
  {
    key: 'last-month',
    label: 'Bulan lalu',
    range: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(start), to: isoDate(end) };
    },
  },
];

function detectPreset(from: string, to: string): string | null {
  for (const p of DATE_PRESETS) {
    const r = p.range();
    if (r.from === from && r.to === to) return p.key;
  }
  return null;
}

export function Orders() {
  const navigate = useNavigate();
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [pay, setPay] = useState<PaymentFilter>('all');
  const [orderType, setOrderType] = useState<OrderTypeFilter>('all');
  const [customerId, setCustomerId] = useState<string>('all');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const initial = DATE_PRESETS.find((p) => p.key === '30d')!.range();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selected, setSelected] = useState<Order | null>(null);
  const [adjustFor, setAdjustFor] = useState<Order | null>(null);
  const [settleFor, setSettleFor] = useState<Order | null>(null);
  const [channelFilter, setChannelFilter] = useState('all');
  const [termFilter, setTermFilter] = useState<'all' | 'cash' | 'tempo' | 'receivable'>('all');
  // Penyesuaian harga & pencairan piutang menyentuh angka penjualan — admin saja.
  const canAdjust = hasCapability(profile?.role, 'manageUsers');
  // Toko tanpa tipe order (mis. toko sparepart) tidak perlu kolom Dine In/Take Away.
  const features = resolveFeatures(store?.industry, store?.features as never);
  // Centang pesanan untuk dibatalkan/dihapus sekaligus (salah input, salah impor).
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [voidBusy, setVoidBusy] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    pullRecentOrders(storeId, 500);
    // Pesanan storefront publik masuk lewat endpoint terpisah tanpa lewat
    // outbox lokal staff, jadi halaman ini butuh polling ringan sendiri
    // supaya pesanan baru terlihat tanpa reload manual.
    const t = window.setInterval(() => pullRecentOrders(storeId, 500), 20_000);
    return () => window.clearInterval(t);
  }, [storeId]);

  const orders =
    useLiveQuery(() => db.orders.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const items =
    useLiveQuery(
      () => (selected ? db.order_items.where('order_id').equals(selected.id).toArray() : Promise.resolve([] as OrderItem[])),
      [selected?.id],
    ) ?? [];

  const allCustomers =
    useLiveQuery(
      () => db.customers.where('store_id').equals(storeId).toArray(),
      [storeId],
    ) ?? [];

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allCustomers) m.set(c.id, c.name);
    return m;
  }, [allCustomers]);

  const customer =
    useLiveQuery(
      () => (selected?.customer_id ? db.customers.get(selected.customer_id) : Promise.resolve<Customer | undefined>(undefined)),
      [selected?.customer_id],
    );

  const channelRows =
    useLiveQuery(() => db.sales_channels.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const orderPayments =
    useLiveQuery(
      () =>
        selected
          ? db.order_payments.where('order_id').equals(selected.id).toArray()
          : Promise.resolve([] as OrderPayment[]),
      [selected?.id],
    ) ?? [];

  const filtered = useMemo(() => {
    const f = new Date(from + 'T00:00:00').getTime();
    const t = new Date(to + 'T23:59:59').getTime();
    const minN = minAmount ? Number(minAmount) : -Infinity;
    const maxN = maxAmount ? Number(maxAmount) : Infinity;
    const list = orders.filter((o) => {
      const ts = new Date(o.created_at).getTime();
      if (ts < f || ts > t) return false;
      if (status !== 'all' && o.order_status !== status) return false;
      if (pay !== 'all' && o.payment_method !== pay) return false;
      if (orderType !== 'all' && o.order_type !== orderType) return false;
      if (channelFilter !== 'all' && (o.sales_channel ?? 'offline') !== channelFilter) return false;
      if (termFilter === 'cash' && o.payment_term === 'tempo') return false;
      if (termFilter === 'tempo' && o.payment_term !== 'tempo') return false;
      if (termFilter === 'receivable' && receivableOf(o) <= 0) return false;
      if (customerId === 'none' && o.customer_id) return false;
      if (customerId !== 'all' && customerId !== 'none' && o.customer_id !== customerId) return false;
      if (o.total < minN || o.total > maxN) return false;
      if (q) {
        const term = q.toLowerCase();
        const tn = o.table_number?.toLowerCase() ?? '';
        const cName = (o.customer_id ? customerName.get(o.customer_id) ?? '' : '').toLowerCase();
        const ext = (o.external_order_no ?? '').toLowerCase();
        if (
          !o.order_number.toLowerCase().includes(term) &&
          !ext.includes(term) &&
          !tn.includes(term) &&
          !cName.includes(term)
        ) {
          return false;
        }
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return a.created_at < b.created_at ? -1 : 1;
        case 'amount-desc':
          return b.total - a.total;
        case 'amount-asc':
          return a.total - b.total;
        case 'newest':
        default:
          return a.created_at < b.created_at ? 1 : -1;
      }
    });
    return list;
  }, [orders, q, status, pay, orderType, customerId, minAmount, maxAmount, from, to, sortBy, customerName, channelFilter, termFilter]);

  const summary = useMemo(() => {
    let sales = 0;
    let canceled = 0;
    for (const o of filtered) {
      if (countsAsSale(o)) sales += o.total;
      else canceled++;
    }
    const avg = filtered.length > 0 ? sales / Math.max(1, filtered.length - canceled) : 0;
    return { sales, count: filtered.length, avg, canceled };
  }, [filtered]);

  // Payment breakdown for the filtered range.
  const payBreakdown = useMemo(() => {
    const m: Record<PaymentMethod, { count: number; total: number }> = {
      cash: { count: 0, total: 0 },
      qris: { count: 0, total: 0 },
      ewallet: { count: 0, total: 0 },
      card: { count: 0, total: 0 },
      transfer: { count: 0, total: 0 },
      other: { count: 0, total: 0 },
    };
    for (const o of filtered) {
      if (!countsAsSale(o)) continue;
      m[o.payment_method].count++;
      m[o.payment_method].total += o.total;
    }
    return m;
  }, [filtered]);

  /**
   * Cetak ulang.
   *
   * `format: 'invoice'` dipakai untuk pesanan toko/grosir yang minta faktur
   * satu halaman penuh (A4) — struk thermal memaksa lebar 80mm lewat @page,
   * dan itu berbenturan dengan kertas A4 saat dicetak ke printer biasa atau
   * disimpan sebagai PDF, membuat struknya kecil nangkring di pojok halaman.
   */
  function reprint(o: Order, format: 'thermal' | 'invoice' = 'thermal') {
    if (!store) return;
    db.order_items
      .where('order_id')
      .equals(o.id)
      .toArray()
      .then(async (its) => {
        if (!its.length) return;
        const nama = o.customer_id ? customerName.get(o.customer_id) ?? null : o.customer_name;
        if (format === 'invoice') {
          printInvoice({
            store,
            order: o,
            items: its,
            customerName: nama,
            skuByProductId: await skuMapFor(its),
            printedBy: profile?.full_name ?? null,
          });
        } else printReceipt({ store, order: o, items: its, customerName: nama });
      });
  }

  function shareWA(o: Order) {
    if (!store) return;
    db.order_items
      .where('order_id')
      .equals(o.id)
      .toArray()
      .then(async (its) => {
        const cust = o.customer_id ? await db.customers.get(o.customer_id) : null;
        const text = buildReceiptText({ store, order: o, items: its, customerName: cust?.name });
        window.open(whatsappLink(cust?.phone, text), '_blank');
      });
  }

  const [webOrderBusy, setWebOrderBusy] = useState<string | null>(null);
  // Pesanan web yang sedang dikonfirmasi; ongkirnya diisi di dialog.
  const [confirmFor, setConfirmFor] = useState<Order | null>(null);

  /**
   * Pesanan dari storefront publik masuk berstatus 'awaiting_confirmation' dan
   * BELUM memotong stok (lihat POST /api/public/orders di server). Konfirmasi
   * memanggil RPC confirm_web_order, yang baru di titik itu memotong stok
   * lewat apply_order_stock — sengaja tidak dilakukan di sini di client supaya
   * pemotongan stok tetap satu jalur dengan order lain.
   */
  async function confirmWebOrder(o: Order, shippingCost: number) {
    setWebOrderBusy(o.id);
    try {
      const { error } = await getBackendClient().rpc('confirm_web_order', {
        p_order_id: o.id,
        p_shipping_cost: shippingCost,
      });
      if (error) throw new Error(error.message);
      // Server menghitung ulang totalnya; cerminkan rumus yang sama di lokal
      // supaya angka tidak berkedip sebelum pullRecentOrders selesai.
      const totalBaru = Number(o.subtotal) - Number(o.discount) + Number(o.tax) + shippingCost;
      const patch = {
        order_status: 'done' as const,
        payment_status: 'paid' as const,
        shipping_cost: shippingCost,
        total: totalBaru,
      };
      await db.orders.update(o.id, patch);
      if (selected?.id === o.id) setSelected({ ...o, ...patch });
      setConfirmFor(null);
      toast.success(`Pesanan ${o.order_number} dikonfirmasi, stok terpotong.`);
      pullRecentOrders(storeId, 500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengonfirmasi pesanan.');
    } finally {
      setWebOrderBusy(null);
    }
  }

  async function rejectWebOrder(o: Order) {
    if (!confirm(`Tolak pesanan ${o.order_number}? Stok tidak akan berubah.`)) return;
    setWebOrderBusy(o.id);
    try {
      const { error } = await getBackendClient().rpc('reject_web_order', { p_order_id: o.id });
      if (error) throw new Error(error.message);
      await db.orders.update(o.id, { order_status: 'canceled' });
      if (selected?.id === o.id) setSelected({ ...o, order_status: 'canceled' });
      toast.success(`Pesanan ${o.order_number} ditolak.`);
      pullRecentOrders(storeId, 500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menolak pesanan.');
    } finally {
      setWebOrderBusy(null);
    }
  }

  const dipilih = filtered.filter((o) => picked.has(o.id));
  const semuaDipilih = filtered.length > 0 && dipilih.length === filtered.length;

  function pilihSatu(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function pilihSemua(on: boolean) {
    setPicked(on ? new Set(filtered.map((o) => o.id)) : new Set());
  }

  /**
   * Batal atau hapus pesanan yang dicentang. Hanya pesanan yang terlihat di
   * tabel yang diproses, supaya centang lama yang tersembunyi filter tidak
   * ikut terhapus diam-diam. Stok dikembalikan server dari catatan mutasinya.
   */
  async function voidPicked(hapus: boolean) {
    const target = dipilih;
    if (!target.length) return;
    const aktif = target.filter((o) => o.order_status !== 'canceled').length;
    const pesan = hapus
      ? `Hapus ${target.length} pesanan? Data pesanan hilang permanen.` +
        (aktif ? ` Stok barang dari ${aktif} pesanan yang belum batal dikembalikan.` : '')
      : `Batalkan ${target.length} pesanan? Stok barangnya dikembalikan.`;
    if (!confirm(pesan)) return;
    setVoidBusy(true);
    try {
      const ids = target.map((o) => o.id);
      const { error } = await getBackendClient().rpc('void_orders', { p_order_ids: ids, p_delete: hapus });
      if (error) throw new Error(error.message);
      if (hapus) {
        await db.transaction('rw', db.orders, db.order_items, db.order_payments, async () => {
          await db.order_items.where('order_id').anyOf(ids).delete();
          await db.order_payments.where('order_id').anyOf(ids).delete();
          await db.orders.bulkDelete(ids);
        });
      } else {
        await db.orders.where('id').anyOf(ids).modify({ order_status: 'canceled' });
      }
      if (selected && ids.includes(selected.id)) setSelected(null);
      setPicked(new Set());
      toast.success(
        hapus
          ? `${ids.length} pesanan dihapus. Stok sudah dikembalikan.`
          : `${ids.length} pesanan dibatalkan. Stok sudah dikembalikan.`,
      );
      pullRecentOrders(storeId, 500);
      pullInventoryReference(storeId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses pesanan.');
    } finally {
      setVoidBusy(false);
    }
  }

  function applyPreset(preset: Preset) {
    const r = preset.range();
    setFrom(r.from);
    setTo(r.to);
  }

  function resetFilters() {
    setQ('');
    setStatus('all');
    setPay('all');
    setOrderType('all');
    setCustomerId('all');
    setMinAmount('');
    setMaxAmount('');
    setSortBy('newest');
    const r = DATE_PRESETS.find((p) => p.key === '7d')!.range();
    setFrom(r.from);
    setTo(r.to);
  }

  async function exportCSV() {
    // Kirim daftar yang SUDAH difilter supaya isi CSV sama persis dengan tabel.
    const { exportOrdersBySKU } = await import('@/lib/exportUtils');
    const count = await exportOrdersBySKU(filtered, { filenameSuffix: `${from}_${to}` });
    toast.success(`${count} baris pesanan diekspor.`);
  }

  async function exportDanaCair() {
    const { exportDisbursement } = await import('@/lib/exportUtils');
    const count = await exportDisbursement(filtered, { filenameSuffix: `${from}_${to}` });
    toast.success(`${count} pesanan diekspor ke laporan dana cair.`);
  }

  const activePreset = detectPreset(from, to);
  // Build active filter pills (only for non-default filter values).
  const activePills: { key: string; label: string; clear: () => void }[] = [];
  if (q) activePills.push({ key: 'q', label: `Cari: "${q}"`, clear: () => setQ('') });
  if (status !== 'all') activePills.push({ key: 's', label: `Status: ${STATUS_TABS.find((x) => x.value === status)?.label}`, clear: () => setStatus('all') });
  if (pay !== 'all') activePills.push({ key: 'p', label: `Bayar: ${PAY_TABS.find((x) => x.value === pay)?.label}`, clear: () => setPay('all') });
  if (orderType !== 'all') activePills.push({ key: 't', label: `Tipe: ${TYPE_TABS.find((x) => x.value === orderType)?.label}`, clear: () => setOrderType('all') });
  if (customerId === 'none') {
    activePills.push({ key: 'c', label: 'Tanpa pelanggan', clear: () => setCustomerId('all') });
  } else if (customerId !== 'all') {
    activePills.push({ key: 'c', label: `Pelanggan: ${customerName.get(customerId) ?? customerId}`, clear: () => setCustomerId('all') });
  }
  if (minAmount) activePills.push({ key: 'mn', label: `≥ ${formatMoney(Number(minAmount), store?.currency)}`, clear: () => setMinAmount('') });
  if (maxAmount) activePills.push({ key: 'mx', label: `≤ ${formatMoney(Number(maxAmount), store?.currency)}`, clear: () => setMaxAmount('') });
  const hasActiveFilter = activePills.length > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Order History</h1>
          <p className="opacity-80 text-sm">
            {summary.count} order · {formatMoney(summary.sales, store?.currency)}
            {summary.count > 0 && (
              <span className="opacity-70"> · rata-rata {formatMoney(summary.avg, store?.currency)}</span>
            )}
            {summary.canceled > 0 && (
              <span className="opacity-70"> · {summary.canceled} dibatalkan</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <Search size={14} />
            <input
              className="bg-transparent placeholder:text-white/70 focus:outline-none w-48"
              placeholder="Cari ID / No. Pesanan Platform / meja / pelanggan"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            variant="onBrand"
          >
            <Download size={16} /> Export CSV
          </Button>
          {canAdjust && (
            <Button onClick={exportDanaCair} disabled={filtered.length === 0} variant="onBrand">
              <Landmark size={16} /> Export Dana Cair
            </Button>
          )}
          {/* Diletakkan di sebelah Add New Order sesuai permintaan client:
              "import masal pada bagian add new order". */}
          <Button onClick={() => setImportOpen(true)} variant="onBrandSoft">
            <Upload size={16} /> Impor Penjualan
          </Button>
          <Button onClick={() => navigate('/menu')} variant="onBrand">
            <Plus size={16} /> Add New Order
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        {/* Quick date presets */}
        <div className="flex flex-wrap items-center gap-2">
          <Calendar size={14} className="text-ink-500" />
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition',
                activePreset === p.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700',
              )}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 dark:border-ink-700 px-2 py-1 text-sm">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-transparent focus:outline-none"
            />
            <span className="text-ink-400">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-transparent focus:outline-none"
            />
          </div>
        </div>

        {/* Primary chip filters */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            label="Status"
            options={STATUS_TABS}
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
          />
          <FilterChips
            label="Bayar"
            options={PAY_TABS}
            value={pay}
            onChange={(v) => setPay(v as PaymentFilter)}
          />
          {features.useOrderType && (
            <FilterChips
              label="Tipe"
              options={TYPE_TABS}
              value={orderType}
              onChange={(v) => setOrderType(v as OrderTypeFilter)}
            />
          )}
          <FilterChips
            label="Termin"
            options={[
              { value: 'all', label: 'Semua' },
              { value: 'cash', label: 'Langsung' },
              { value: 'tempo', label: 'Tempo' },
              { value: 'receivable', label: 'Belum cair' },
            ]}
            value={termFilter}
            onChange={(v) => setTermFilter(v as typeof termFilter)}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-500">Channel:</span>
            <select
              className="input !w-auto !py-1 !text-xs"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            >
              <option value="all">Semua</option>
              {resolveChannels(channelRows).map((channel) => (
                <option key={channel.code} value={channel.code}>
                  {channel.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <SortDropdown value={sortBy} onChange={setSortBy} />
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
                advancedOpen
                  ? 'bg-brand-600 text-white'
                  : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300',
              )}
              title="Filter lanjutan"
            >
              <SlidersHorizontal size={12} /> Filter lanjutan
            </button>
          </div>
        </div>

        {/* Advanced filters */}
        {advancedOpen && (
          <div className="grid gap-3 rounded-xl bg-ink-50 dark:bg-ink-900/60 p-3 sm:grid-cols-3">
            <div>
              <label className="block text-[11px] text-ink-500 mb-1 font-semibold uppercase tracking-wide">
                Pelanggan
              </label>
              <div className="flex items-center gap-1.5 rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-2 py-1">
                <Users size={14} className="text-ink-500" />
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                >
                  <option value="all">Semua pelanggan</option>
                  <option value="none">Tanpa pelanggan (walk-in)</option>
                  {allCustomers
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-ink-500 mb-1 font-semibold uppercase tracking-wide">
                Total minimum
              </label>
              <input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="0"
                className="input !py-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] text-ink-500 mb-1 font-semibold uppercase tracking-wide">
                Total maksimum
              </label>
              <input
                type="number"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="∞"
                className="input !py-1.5"
              />
            </div>
          </div>
        )}

        {/* Active filter pills + payment mini-breakdown */}
        {(hasActiveFilter || summary.count > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 dark:border-ink-800 pt-3">
            {hasActiveFilter ? (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  <Filter className="inline" size={11} /> Filter aktif ({activePills.length})
                </span>
                {activePills.map((pill) => (
                  <button
                    key={pill.key}
                    onClick={pill.clear}
                    className="group flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950/40 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                  >
                    {pill.label}
                    <X size={10} className="opacity-50 group-hover:opacity-100" />
                  </button>
                ))}
                <button
                  onClick={resetFilters}
                  className="text-xs text-ink-500 hover:text-rose-600 hover:underline"
                >
                  Reset semua
                </button>
              </>
            ) : (
              <span className="text-[11px] text-ink-500">Tidak ada filter aktif.</span>
            )}

            <div className="ml-auto hidden md:flex items-center gap-2 text-[11px] text-ink-500">
              {(Object.keys(payBreakdown) as PaymentMethod[]).map((k) => {
                const v = payBreakdown[k];
                if (v.count === 0) return null;
                return (
                  <span key={k} className="flex items-center gap-1">
                    <span className="capitalize font-semibold text-ink-700 dark:text-ink-200">
                      {k}
                    </span>
                    {v.count}×
                    <span className="font-mono">{formatMoney(v.total, store?.currency)}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        {canAdjust && dipilih.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-500/30 dark:bg-brand-500/10">
            <span className="font-medium">{dipilih.length} pesanan dipilih</span>
            <button
              type="button"
              className="text-xs text-ink-500 underline"
              onClick={() => setPicked(new Set())}
            >
              Batal pilih
            </button>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => voidPicked(false)} disabled={voidBusy}>
                <Ban size={14} /> Batalkan
              </Button>
              <Button size="sm" variant="danger" onClick={() => voidPicked(true)} disabled={voidBusy}>
                <Trash2 size={14} /> Hapus
              </Button>
            </div>
          </div>
        )}
        {filtered.length === 0 ? (
          <EmptyState
            title="Tidak ada order cocok"
            description={hasActiveFilter ? 'Coba ubah filter atau rentang tanggal.' : 'Order yang Anda buat akan muncul di sini.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  {canAdjust && (
                    <th className="w-8 py-2">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua pesanan"
                        checked={semuaDipilih}
                        onChange={(e) => pilihSemua(e.target.checked)}
                      />
                    </th>
                  )}
                  <th className="py-2">Order ID</th>
                  <th className="py-2">Date</th>
                  {features.useOrderType && <th className="py-2">Type</th>}
                  <th className="py-2">Customer</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Payment</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-t border-ink-100 dark:border-ink-800">
                    {canAdjust && (
                      <td className="py-3">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${o.order_number}`}
                          checked={picked.has(o.id)}
                          onChange={(e) => pilihSatu(o.id, e.target.checked)}
                        />
                      </td>
                    )}
                    <td className="py-3 font-semibold">
                      {o.order_number}
                      {o.external_order_no && (
                        <div className="font-mono text-[10px] font-normal text-ink-500">
                          {o.external_order_no}
                        </div>
                      )}
                    </td>
                    <td className="py-3">{formatDateTime(o.created_at)}</td>
                    {features.useOrderType && (
                      <td className="py-3 text-xs">
                        {o.order_type === 'dine_in' ? 'Dine In' : 'Take Away'}
                        {o.table_number && <span className="text-ink-500"> · {o.table_number}</span>}
                      </td>
                    )}
                    <td className="py-3 text-xs">
                      {o.customer_id
                        ? customerName.get(o.customer_id) ?? '—'
                        : o.customer_name
                          ? o.customer_name
                          : <span className="text-ink-400">walk-in</span>}
                    </td>
                    <td className="py-3 font-mono">{formatMoney(o.total, store?.currency)}</td>
                    <td className="py-3 capitalize">{o.payment_method}</td>
                    <td className="py-3">
                      <Badge
                        tone={
                          o.order_status === 'done'
                            ? 'success'
                            : o.order_status === 'awaiting_confirmation'
                            ? 'info'
                            : o.order_status === 'pending'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {o.order_status === 'awaiting_confirmation' ? 'menunggu konfirmasi' : o.order_status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-1">
                        {o.order_status === 'awaiting_confirmation' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => setConfirmFor(o)}
                              disabled={webOrderBusy === o.id}
                            >
                              Konfirmasi
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => rejectWebOrder(o)}
                              disabled={webOrderBusy === o.id}
                            >
                              Tolak
                            </Button>
                          </>
                        )}
                        <button
                          onClick={() => reprint(o)}
                          className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                          title="Cetak ulang struk thermal / simpan PDF"
                        >
                          <Printer size={14} />
                        </button>
                        <button
                          onClick={() => reprint(o, 'invoice')}
                          className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                          title="Cetak faktur A4 / simpan PDF"
                        >
                          <FileText size={14} />
                        </button>
                        <button
                          onClick={() => shareWA(o)}
                          className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                          title="Kirim via WhatsApp"
                        >
                          <MessageCircle size={14} />
                        </button>
                        <button
                          onClick={() => setSelected(o)}
                          className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                          title="Detail"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SalesImportModal
        open={importOpen}
        storeId={storeId}
        currency={store?.currency}
        onClose={() => setImportOpen(false)}
        onDone={() => pullRecentOrders(storeId, 500)}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.order_number ?? ''} size="lg">
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal" value={formatDateTime(selected.created_at)} />
              <Field label="Channel" value={channelLabel(selected.sales_channel, channelRows)} />
              {selected.external_order_no && (
                <Field label="No. Pesanan Platform" value={selected.external_order_no} />
              )}
              <Field
                label="Termin"
                value={selected.payment_term === 'tempo' ? 'Tempo / Piutang' : 'Bayar langsung'}
              />
              <Field label="Pembayaran" value={selected.payment_method} />
              <Field label="Status" value={selected.payment_status} />
              {selected.table_number && <Field label="Meja" value={selected.table_number} />}
              {customer && <Field label="Pelanggan" value={`${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}`} />}
              {/* Pesanan hasil impor marketplace tidak punya baris pelanggan,
                  hanya nama penerima. Tanpa baris ini nama itu tersimpan tapi
                  tidak pernah terlihat. */}
              {!customer && selected.customer_name && (
                <Field label="Pelanggan" value={selected.customer_name} />
              )}
              {selected.customer_phone && <Field label="No. HP" value={selected.customer_phone} />}
            </div>
            {selected.delivery_address && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                <div className="font-semibold uppercase text-sky-700 dark:text-sky-300">Alamat Kirim</div>
                <p className="mt-1 text-ink-700 dark:text-ink-200">{selected.delivery_address}</p>
              </div>
            )}
            <div className="border-t border-ink-100 dark:border-ink-800 pt-3">
              <div className="text-xs text-ink-500 uppercase mb-2">Items</div>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{it.name}</span>
                      {it.size && <span className="text-ink-500 text-xs ml-1">({it.size})</span>}
                      <span className="text-ink-500 text-xs ml-1">× {it.qty}</span>
                      {it.note && <div className="text-[11px] text-ink-500 italic">note: {it.note}</div>}
                    </div>
                    <span>{formatMoney(it.price * it.qty, store?.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-ink-100 dark:border-ink-800 pt-3 space-y-1.5">
              <Row label="Subtotal" value={formatMoney(selected.subtotal, store?.currency)} />
              {selected.discount > 0 && (
                <Row
                  label={`Diskon${selected.promo_code ? ` (${selected.promo_code})` : ''}`}
                  value={`-${formatMoney(selected.discount, store?.currency)}`}
                />
              )}
              <Row label="Pajak" value={formatMoney(selected.tax, store?.currency)} />
              {Number(selected.shipping_cost ?? 0) > 0 && (
                <Row label="Ongkir" value={formatMoney(Number(selected.shipping_cost), store?.currency)} />
              )}
              <Row label="Total" value={formatMoney(selected.total, store?.currency)} bold />
              {selected.payment_method === 'cash' && selected.received_amount != null && (
                <>
                  <Row label="Diterima" value={formatMoney(Number(selected.received_amount), store?.currency)} />
                  <Row label="Kembali" value={formatMoney(Number(selected.change_amount ?? 0), store?.currency)} />
                </>
              )}
              {selected.points_earned > 0 && (
                <Row label="Poin" value={`+${selected.points_earned}`} />
              )}
            </div>
            {selected.payment_term === 'tempo' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">
                  Piutang
                </div>
                <div className="mt-1.5 space-y-1">
                  <Row label="Sudah cair" value={formatMoney(Number(selected.paid_amount ?? 0), store?.currency)} />
                  <Row
                    label="Sisa"
                    value={formatMoney(receivableOf(selected), store?.currency)}
                    bold
                  />
                  {selected.due_date && (
                    <Row label="Jatuh tempo" value={formatDate(selected.due_date)} />
                  )}
                </div>
                {orderPayments.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2 text-xs dark:border-amber-500/30">
                    {orderPayments.map((payment: OrderPayment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-2">
                        <span>
                          {formatDateTime(payment.paid_at)} · {payment.method}
                          {payment.reference && ` · ${payment.reference}`}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatMoney(payment.amount, store?.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {selected.adjusted_at && (
              <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-xs dark:border-brand-500/20 dark:bg-brand-950/25">
                <div className="font-semibold text-brand-700 dark:text-brand-200">
                  Harga sudah disesuaikan
                </div>
                <div className="mt-1 text-ink-600 dark:text-ink-300">
                  Total awal {formatMoney(Number(selected.original_total ?? 0), store?.currency)} →{' '}
                  {formatMoney(selected.total, store?.currency)} (
                  {Number(selected.adjustment_amount) >= 0 ? '+' : ''}
                  {formatMoney(Number(selected.adjustment_amount), store?.currency)}) ·{' '}
                  {formatDateTime(selected.adjusted_at)}
                </div>
                {selected.adjustment_note && (
                  <div className="mt-1 italic text-ink-500">{selected.adjustment_note}</div>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-2 dark:border-ink-800">
              {selected.order_status === 'awaiting_confirmation' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => rejectWebOrder(selected)}
                    disabled={webOrderBusy === selected.id}
                  >
                    Tolak Pesanan
                  </Button>
                  <Button onClick={() => setConfirmFor(selected)} disabled={webOrderBusy === selected.id}>
                    Konfirmasi Pesanan
                  </Button>
                </>
              )}
              {canAdjust && selected.order_status !== 'canceled' && selected.order_status !== 'awaiting_confirmation' && (
                <Button variant="secondary" onClick={() => setAdjustFor(selected)}>
                  <PencilLine size={14} /> Sesuaikan harga
                </Button>
              )}
              {canAdjust && selected.payment_term === 'tempo' && receivableOf(selected) > 0 && (
                <Button variant="secondary" onClick={() => setSettleFor(selected)}>
                  <Landmark size={14} /> Catat pencairan
                </Button>
              )}
              <Button variant="secondary" onClick={() => shareWA(selected)}>
                <MessageCircle size={14} /> WhatsApp
              </Button>
              <Button variant="secondary" onClick={() => reprint(selected)}>
                <Printer size={14} /> Cetak Thermal / PDF
              </Button>
              <Button onClick={() => reprint(selected, 'invoice')}>
                <FileText size={14} /> Cetak Faktur A4 / PDF
              </Button>
            </div>
            <p className="text-right text-[11px] text-ink-500">
              Untuk menyimpan PDF, pilih "Simpan sebagai PDF" di jendela cetak.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmWebOrderModal
        order={confirmFor}
        currency={store?.currency}
        busy={!!confirmFor && webOrderBusy === confirmFor.id}
        onClose={() => setConfirmFor(null)}
        onConfirm={(ongkir) => confirmFor && confirmWebOrder(confirmFor, ongkir)}
      />

      <AdjustPriceModal
        order={adjustFor}
        currency={store?.currency}
        actorId={profile?.id ?? null}
        feePercent={adjustFor ? channelFeePercent(adjustFor.sales_channel, channelRows) : 0}
        onClose={() => setAdjustFor(null)}
        onSaved={(updated) => {
          setAdjustFor(null);
          setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
        }}
      />

      <SettleReceivableModal
        order={settleFor}
        storeId={storeId}
        currency={store?.currency}
        actorId={profile?.id ?? null}
        onClose={() => setSettleFor(null)}
        onSaved={(updated) => {
          setSettleFor(null);
          setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
        }}
      />
    </div>
  );
}

/** Sisa piutang order tempo. Order non-tempo selalu 0. */
function receivableOf(order: Order): number {
  if (order.payment_term !== 'tempo') return 0;
  return Math.max(0, Number(order.total) - Number(order.paid_amount ?? 0));
}

/**
 * Menyesuaikan total order yang sudah terjual — dipakai saat potongan
 * marketplace baru ketahuan setelah settlement. Total asli disimpan di
 * original_total supaya jejaknya tidak hilang.
 */
/**
 * Konfirmasi pesanan web sekaligus mengisi ongkirnya.
 *
 * Ongkir belum bisa dihitung otomatis (KiriminAja menunggu API key), jadi
 * staff mengetiknya di sini. Tanpa langkah ini total pesanan cuma berisi
 * harga barang, sehingga tagihan ke pembeli dan rekap kas tidak cocok dengan
 * uang yang benar-benar diterima.
 */
function ConfirmWebOrderModal({
  order,
  currency,
  busy,
  onClose,
  onConfirm,
}: {
  order: Order | null;
  currency?: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (shippingCost: number) => void;
}) {
  const [ongkir, setOngkir] = useState('0');

  useEffect(() => {
    // Nilai lama jangan terbawa ke pesanan berikutnya.
    setOngkir(order ? String(Number(order.shipping_cost ?? 0)) : '0');
  }, [order?.id]);

  if (!order) return null;

  const nilaiOngkir = Number(ongkir) || 0;
  const barang = Number(order.subtotal) - Number(order.discount) + Number(order.tax);
  const total = barang + nilaiOngkir;
  const ongkirValid = Number.isFinite(nilaiOngkir) && nilaiOngkir >= 0;

  return (
    <Modal open onClose={onClose} title={`Konfirmasi ${order.order_number}`} size="sm">
      <div className="space-y-3 text-sm">
        <p className="text-ink-500">
          Setelah dikonfirmasi, stok produk langsung terpotong dan pesanan masuk ke penjualan.
        </p>

        {order.delivery_address && (
          <div className="rounded-xl bg-ink-50 p-3 text-xs dark:bg-ink-800/60">
            <div className="font-semibold uppercase text-ink-500">Alamat kirim</div>
            <p className="mt-1">{order.delivery_address}</p>
          </div>
        )}

        <Input
          name="shipping_cost"
          label="Ongkos Kirim"
          type="number"
          min="0"
          value={ongkir}
          onChange={(e) => setOngkir(e.target.value)}
          hint="Isi 0 kalau diambil sendiri atau ongkirnya ditanggung toko."
        />

        <div className="space-y-1 border-t border-ink-100 pt-3 dark:border-ink-800">
          <Row label="Barang" value={formatMoney(barang, currency)} />
          <Row label="Ongkir" value={formatMoney(nilaiOngkir, currency)} />
          <Row label="Total tagihan" value={formatMoney(total, currency)} bold />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => onConfirm(nilaiOngkir)} disabled={busy || !ongkirValid}>
            {busy ? 'Memproses...' : 'Konfirmasi & Potong Stok'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AdjustPriceModal({
  order,
  currency,
  actorId,
  feePercent,
  onClose,
  onSaved,
}: {
  order: Order | null;
  currency?: string;
  actorId: string | null;
  feePercent: number;
  onClose: () => void;
  onSaved: (order: Order) => void;
}) {
  const [total, setTotal] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) return;
    setTotal(String(order.total));
    setNote(order.adjustment_note ?? '');
  }, [order]);

  if (!order) return null;
  const current = order;

  // Angka pembanding selalu total asli, bukan total hasil penyesuaian sebelumnya.
  const baseline = Number(current.original_total ?? current.total);
  const nextTotal = Number(total || 0);
  const delta = nextTotal - baseline;
  const suggested = Math.round(baseline * (1 - feePercent / 100));

  async function submit() {
    if (nextTotal < 0) {
      toast.error('Total tidak boleh negatif.');
      return;
    }
    setBusy(true);
    try {
      const patch = {
        total: nextTotal,
        original_total: baseline,
        adjustment_amount: delta,
        adjustment_note: note.trim() || null,
        adjusted_at: new Date().toISOString(),
        adjusted_by: isUuid(actorId) ? actorId : null,
      };
      const { error } = await getBackendClient().from('orders').update(patch).eq('id', current.id);
      if (error) throw error;
      const updated = { ...current, ...patch } as Order;
      await db.orders.put(updated);
      toast.success('Harga transaksi disesuaikan.');
      onSaved(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyesuaikan harga.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Sesuaikan Harga · ${order.order_number}`} size="md">
      <div className="space-y-3">
        <div className="rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-800/50">
          <Row label="Total tayang awal" value={formatMoney(baseline, currency)} />
          {feePercent > 0 && (
            <Row
              label={`Estimasi setelah potongan ${feePercent}%`}
              value={formatMoney(suggested, currency)}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
            Total riil diterima
          </label>
          <input
            type="number"
            min={0}
            className="input"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
          {feePercent > 0 && (
            <button
              onClick={() => setTotal(String(suggested))}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Pakai estimasi potongan {feePercent}%
            </button>
          )}
        </div>

        <div
          className={cn(
            'rounded-xl border p-3 text-sm',
            delta === 0
              ? 'border-ink-100 dark:border-ink-800'
              : delta < 0
                ? 'border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10'
                : 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
          )}
        >
          Selisih terhadap harga awal:{' '}
          <span className="font-bold tabular-nums">
            {delta >= 0 ? '+' : ''}
            {formatMoney(delta, currency)}
          </span>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
            Alasan penyesuaian
          </label>
          <textarea
            className="input min-h-[70px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Potongan admin & ongkir Shopee, settlement 12 Agustus"
          />
        </div>

        <p className="text-xs text-ink-500">
          Item dan harga satuan tidak diubah — hanya total order yang disesuaikan, supaya laporan
          penjualan memakai angka yang benar-benar diterima. Angka lama tetap tersimpan.
        </p>

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan penyesuaian'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Mencatat pencairan dana marketplace / pelunasan tempo toko. */
function SettleReceivableModal({
  order,
  storeId,
  currency,
  actorId,
  onClose,
  onSaved,
}: {
  order: Order | null;
  storeId: string;
  currency?: string;
  actorId: string | null;
  onClose: () => void;
  onSaved: (order: Order) => void;
}) {
  const [amount, setAmount] = useState('0');
  const [method, setMethod] = useState<OrderPaymentMethod>('transfer');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const rest = order ? receivableOf(order) : 0;

  useEffect(() => {
    if (!order) return;
    setAmount(String(Math.round(receivableOf(order))));
    setPaidAt(new Date().toISOString().slice(0, 10));
    setReference('');
  }, [order]);

  if (!order) return null;
  const current = order;

  async function submit() {
    const value = Number(amount || 0);
    if (value <= 0) {
      toast.error('Nominal harus lebih dari nol.');
      return;
    }
    if (value > rest + 0.5) {
      toast.error(`Nominal melebihi sisa piutang (${formatMoney(rest, currency)}).`);
      return;
    }
    setBusy(true);
    try {
      const api = getBackendClient();
      const row: OrderPayment = {
        id: uuid(),
        store_id: storeId,
        order_id: current.id,
        amount: value,
        method,
        paid_at: new Date(`${paidAt}T12:00:00`).toISOString(),
        reference: reference.trim() || null,
        note: null,
        created_by: isUuid(actorId) ? actorId : null,
        created_at: new Date().toISOString(),
      };
      const { error } = await api.from('order_payments').insert(row);
      if (error) throw error;
      await db.order_payments.put(row);

      // paid_amount & payment_status dihitung trigger; tarik ulang order-nya.
      const { data } = await api.from('orders').select('*').eq('id', current.id);
      const fresh = (data as Order[] | null)?.[0];
      if (fresh) await db.orders.put(fresh);
      toast.success(value >= rest ? 'Piutang lunas.' : 'Pencairan sebagian dicatat.');
      onSaved(fresh ?? current);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mencatat pencairan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Pencairan · ${order.order_number}`} size="sm">
      <div className="space-y-3">
        <div className="rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-800/50">
          <Row label="Total order" value={formatMoney(order.total, currency)} />
          <Row label="Sudah cair" value={formatMoney(Number(order.paid_amount ?? 0), currency)} />
          <Row label="Sisa" value={formatMoney(rest, currency)} bold />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">Nominal</label>
          <input
            type="number"
            min={0}
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
              Metode
            </label>
            <select
              className="input"
              value={method}
              onChange={(e) => setMethod(e.target.value as OrderPaymentMethod)}
            >
              <option value="transfer">Transfer</option>
              <option value="cash">Tunai</option>
              <option value="ewallet">E-wallet</option>
              <option value="qris">QRIS</option>
              <option value="card">Kartu</option>
              <option value="other">Lainnya</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
              Tanggal cair
            </label>
            <input
              type="date"
              className="input"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
            Referensi
          </label>
          <input
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="No. settlement / mutasi bank"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Menyimpan...' : 'Catat pencairan'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FilterChips<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-ink-500">{label}:</span>
      <div className="flex gap-1 rounded-full bg-ink-100 dark:bg-ink-800 p-1 text-xs font-semibold">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full px-2.5 py-1',
              value === o.value ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortDropdown({ value, onChange }: { value: SortBy; onChange: (v: SortBy) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortBy)}
        className="appearance-none rounded-full border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 pl-7 pr-7 py-1 text-xs font-semibold focus:outline-none focus:border-brand-500"
        title="Urutkan"
      >
        <option value="newest">Terbaru</option>
        <option value="oldest">Terlama</option>
        <option value="amount-desc">Total tertinggi</option>
        <option value="amount-asc">Total terendah</option>
      </select>
      <ArrowDownUp size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="font-medium capitalize">{value}</div>
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-500">{label}</span>
      <span className={bold ? 'font-bold' : ''}>{value}</span>
    </div>
  );
}
