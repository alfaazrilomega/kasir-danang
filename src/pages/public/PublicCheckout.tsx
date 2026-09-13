import { useEffect, useMemo, useState } from 'react';
import { Banknote, ChevronLeft, QrCode, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { PublicShell } from '@/components/layout/PublicShell';
import { formatMoney, cn } from '@/lib/format';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { usePublicCart, type PublicCartLine } from '@/stores/publicCart';
import { submitPublicOrder } from '@/lib/publicOrders';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { updateCustomerMe, useCustomer } from '@/lib/customerAccount';

type PayOption = 'cash' | 'qris';

export function PublicCheckout() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const isDirect = new URLSearchParams(search).get('mode') === 'direct';

  const cartLines = usePublicCart((s) => s.lines);
  const clearCart = usePublicCart((s) => s.clear);
  const removeLine = usePublicCart((s) => s.remove);
  const buyNow = usePublicCart((s) => s.buyNow);
  const clearBuyNow = usePublicCart((s) => s.clearBuyNow);

  // "Beli Sekarang" checkout hanya satu item ini, TIDAK menyentuh keranjang.
  // Dari keranjang: ?pilih=id1,id2 berarti hanya barang yang dicentang yang dibayar.
  const pilihParam = new URLSearchParams(search).get('pilih');
  const pilihIds = pilihParam ? pilihParam.split(',') : null;
  const lines: PublicCartLine[] =
    isDirect && buyNow ? [buyNow] : pilihIds ? cartLines.filter((l) => pilihIds.includes(l.product_id)) : cartLines;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [payment, setPayment] = useState<PayOption>('cash');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Keputusan client: belanja memakai akun. Keranjang boleh diisi tanpa masuk,
  // checkout wajib masuk supaya pesanan tercatat di akun pembeli.
  const token = useCustomer((s) => s.token);
  const me = useCustomer((s) => s.me);
  const setMe = useCustomer((s) => s.setMe);
  useEffect(() => {
    if (!me) return;
    setName((v) => v || me.name);
    setPhone((v) => v || me.phone || '');
    setAddress((v) => v || me.address || '');
  }, [me]);

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.price * l.qty, 0), [lines]);
  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);

  if (lines.length === 0) {
    return (
      <PublicShell>
        <Card className="p-8">
          <EmptyState
            icon={<ShoppingBag size={24} />}
            title="Belum ada yang mau dibeli"
            description="Pilih produk dulu sebelum checkout."
            action={<Button onClick={() => navigate('/toko')}>Lihat Katalog</Button>}
          />
        </Card>
      </PublicShell>
    );
  }

  if (!token) {
    const kembali = encodeURIComponent(`/toko/checkout${search}`);
    return (
      <PublicShell>
        <Card className="mx-auto max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-bold">Masuk untuk checkout</h1>
          <p className="text-sm text-ink-500">
            Pesanan dicatat di akun kamu, jadi statusnya bisa dipantau kapan saja. Isi keranjang
            tetap tersimpan.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => navigate(`/toko/masuk?tab=daftar&next=${kembali}`)}>
              Daftar
            </Button>
            <Button onClick={() => navigate(`/toko/masuk?next=${kembali}`)}>Masuk</Button>
          </div>
        </Card>
      </PublicShell>
    );
  }

  async function submit() {
    if (!token) return;
    if (!name.trim()) return toast.error('Nama penerima wajib diisi.');
    if (!phone.trim()) return toast.error('Nomor HP wajib diisi.');
    if (!address.trim()) return toast.error('Alamat pengiriman wajib diisi.');

    setBusy(true);
    const { data, error } = await submitPublicOrder({
      store_id: PUBLIC_STORE_ID,
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      delivery_address: address.trim(),
      payment_method: payment,
      notes: notes.trim() || undefined,
      items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
    }, token);
    setBusy(false);

    if (error || !data) {
      toast.error(error || 'Gagal mengirim pesanan.');
      return;
    }

    // Alamat pertama disimpan ke akun supaya checkout berikutnya terisi otomatis.
    if (me && !me.address) {
      void updateCustomerMe(token, {
        name: me.name,
        phone: me.phone || phone.trim(),
        address: address.trim(),
      }).then(({ data: baru }) => baru && setMe(baru));
    }
    if (isDirect) clearBuyNow();
    else if (pilihIds) pilihIds.forEach(removeLine);
    else clearCart();
    navigate(`/toko/selesai?order=${encodeURIComponent(data.order_number)}`);
  }

  return (
    <PublicShell>
      <div className="space-y-4">
        <Link
          to={isDirect ? '/toko' : '/toko/keranjang'}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand-600"
        >
          <ChevronLeft size={16} /> {isDirect ? 'Kembali ke katalog' : 'Kembali ke keranjang'}
        </Link>

        <h1 className="text-xl font-bold">Checkout</h1>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
          {/* ---- Kolom kiri: data penerima & pembayaran ---- */}
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <div className="text-sm font-semibold">Data Penerima</div>
              <Input
                name="customer_name"
                label="Nama Penerima"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                name="customer_phone"
                label="Nomor HP / WhatsApp"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
                hint="Dipakai toko untuk konfirmasi pesanan dan pengiriman."
                required
              />
              <TextArea
                name="delivery_address"
                label="Alamat Pengiriman"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Jalan, nomor rumah, kelurahan, kecamatan, kota, kode pos"
              />
              {/* Ongkir belum dihitung otomatis di sini — menunggu integrasi KiriminAja. */}
              <Input
                name="notes"
                label="Catatan (opsional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contoh: warna, ukuran, titip pesan ke kurir"
              />
            </Card>

            <Card className="space-y-2 p-4">
              <div className="text-sm font-semibold">Metode Pembayaran</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <PayChoice
                  active={payment === 'cash'}
                  onClick={() => setPayment('cash')}
                  icon={<Banknote size={17} />}
                  title="Bayar Tunai (COD)"
                  subtitle="Bayar saat barang diterima"
                />
                <PayChoice
                  active={payment === 'qris'}
                  onClick={() => setPayment('qris')}
                  icon={<QrCode size={17} />}
                  title="QRIS"
                  subtitle="Kode QR dikirim via WhatsApp"
                />
              </div>
            </Card>
          </div>

          {/* ---- Kolom kanan: ringkasan pesanan ---- */}
          <Card className="divide-y divide-ink-100 lg:sticky lg:top-20 dark:divide-ink-800">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold">Ringkasan Pesanan</span>
              <span className="text-xs text-ink-500">{totalQty} barang</span>
            </div>

            <ul className="max-h-72 space-y-3 overflow-y-auto p-4">
              {lines.map((line) => (
                <li key={line.product_id} className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-ink-100 dark:bg-ink-800">
                    {line.image_url ? (
                      <img src={line.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                        <ShoppingBag size={16} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-medium leading-5">{line.name}</div>
                    <div className="text-xs text-ink-500">
                      {line.qty} × {formatMoney(line.price)}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatMoney(line.price * line.qty)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between text-ink-600 dark:text-ink-300">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between text-ink-600 dark:text-ink-300">
                <span>Ongkir</span>
                <span className="text-xs">Dihitung toko saat konfirmasi</span>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-bold dark:border-ink-800">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
            </div>

            <div className="space-y-2 p-4">
              <Button className="w-full" size="lg" onClick={submit} disabled={busy}>
                {busy ? 'Mengirim...' : 'Buat Pesanan'}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-ink-500">
                Pesanan belum otomatis lunas. Toko akan mengonfirmasi lewat WhatsApp sebelum
                pesanan diproses dan dikirim.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}

function PayChoice({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3 text-left transition',
        active
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
          : 'border-ink-200 hover:border-brand-300 dark:border-ink-700',
      )}
    >
      <span className={cn('mt-0.5', active ? 'text-brand-600' : 'text-ink-500')}>{icon}</span>
      <span>
        <span className={cn('block text-sm font-medium', active && 'text-brand-700 dark:text-brand-200')}>
          {title}
        </span>
        <span className="block text-[11px] text-ink-500">{subtitle}</span>
      </span>
    </button>
  );
}
