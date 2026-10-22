import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Clock, Copy, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PublicShell } from '@/components/layout/PublicShell';
import { useBukaMasuk } from '@/components/public/KerangkaAuth';
import { useCustomer } from '@/lib/customerAccount';
import { loadConfig } from '@/lib/config';
import { formatMoney } from '@/lib/format';
import { Link } from '@/lib/router';

interface Payment {
  order_id: string; order_number: string; mode: string; channel: string; amount: number;
  status: 'paid' | 'expired' | 'unpaid'; expires_at: string | null; server_time: string;
  instructions: { kind: 'qris'; qr_string: string } | { kind: 'va'; pay_code: string; bank: string } | null;
  checkout_url: string | null; warning: string | null;
  /** Nominal sudah termasuk ongkir KiriminAja (spec 0002). */
  termasuk_ongkir?: boolean;
}

export function CheckoutPayment({ orderId }: { orderId: string }) {
  const token = useCustomer((s) => s.token);
  const bukaMasuk = useBukaMasuk();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const terminal = useRef(false);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [orderId]);
  useEffect(() => {
    let alive = true, controller: AbortController | null = null, timer: ReturnType<typeof setTimeout>;
    terminal.current = false; setPayment(null); setError(''); setQr('');
    async function load() {
      if (!token || !alive || terminal.current) return;
      controller = new AbortController();
      setBusy(true);
      try {
        const res = await fetch(`${loadConfig().apiBaseUrl}/api/customer/orders/${encodeURIComponent(orderId)}/payment`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const body = await res.json();
        if (!res.ok || !body.data) throw new Error(body.error || 'Pembayaran belum dapat dimuat.');
        if (!alive) return;
        const next = body.data as Payment;
        setPayment(next); setError('');
        setOffset(Date.parse(next.server_time) - Date.now());
        terminal.current = next.status === 'paid' || next.status === 'expired';
      } catch (error) {
        if (alive) setError(error instanceof Error ? error.message : 'Koneksi terputus. Coba periksa kembali.');
      } finally {
        if (alive) { setBusy(false); if (!terminal.current) timer = setTimeout(() => void load(), 30000); }
      }
    }
    void load();
    return () => { alive = false; clearTimeout(timer); controller?.abort(); };
  }, [orderId, token, attempt]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const raw = payment?.instructions?.kind === 'qris' ? payment.instructions.qr_string : null;
  useEffect(() => {
    let alive = true; setQr('');
    if (raw) void QRCode.toDataURL(raw, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setQr(url); }).catch(() => { if (alive) setError('QRIS belum dapat ditampilkan. Hubungi toko sebelum membayar.'); });
    return () => { alive = false; };
  }, [raw]);
  const remaining = payment?.expires_at ? Math.max(0, Math.ceil((Date.parse(payment.expires_at) - now - offset) / 1000)) : null;
  const paid = payment?.status === 'paid';
  const expired = payment?.status === 'expired' || remaining === 0;
  const payable = payment && !paid && !expired;
  async function copy() {
    if (payment?.instructions?.kind !== 'va') return;
    try { await navigator.clipboard.writeText(payment.instructions.pay_code); setCopied(true); }
    catch { setError('Nomor belum tersalin. Pilih dan salin nomor virtual account secara manual.'); }
  }
  return <PublicShell><div className="mx-auto max-w-xl space-y-4 py-6">
    <h1 className="text-xl font-bold">Pembayaran pesanan</h1>
    <Card className="space-y-5 p-5 sm:p-7">
      {!token ? <><p>Masuk dengan akun pemilik pesanan untuk melihat pembayaran.</p><Button onClick={() => bukaMasuk('masuk', `/toko/checkout?order=${encodeURIComponent(orderId)}`)}>Masuk</Button></> : <>
        {!payment && busy && <p role="status">Memuat pembayaran...</p>}
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
        {payment && <>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-ink-500">{payment.order_number}</span><span className="text-xs font-semibold text-brand-600">Mayar · {payment.channel}</span></div>
          {payment.mode === 'sandbox' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Mode uji coba. Jangan melakukan pembayaran uang sungguhan.</p>}
          <div><p className="text-sm text-ink-500">{payment.termasuk_ongkir ? 'Total pembayaran' : 'Total pembayaran barang'}</p><p className="mt-1 text-3xl font-bold">{formatMoney(payment.amount)}</p><p className="mt-2 text-xs text-ink-500">{payment.termasuk_ongkir ? 'Sudah termasuk ongkir.' : 'Ongkir ditagih terpisah setelah dikonfirmasi toko.'}</p></div>
          {paid ? <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800"><CheckCircle2 className="mb-2" /><p className="font-semibold">Pembayaran diterima</p><p className="mt-1 text-sm">Toko akan mengonfirmasi dan memproses pesanan Anda.</p></div>
            : expired ? <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Pembayaran kedaluwarsa atau dibatalkan. Jangan membayar kode ini. Jika sudah membayar, periksa status atau hubungi toko.</p>
            : <>
              {remaining !== null && <div className="flex items-center gap-2 text-sm"><Clock size={16} /><span>Batas pembayaran: <strong>{Math.floor(remaining / 3600).toString().padStart(2, '0')}:{Math.floor(remaining % 3600 / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</strong></span></div>}
              {payment.instructions?.kind === 'qris' && <div className="space-y-3 text-center">
                {qr ? <><img src={qr} alt="QRIS pembayaran pesanan" className="mx-auto w-full max-w-72 rounded-xl" /><a className="inline-block text-sm font-semibold text-brand-600 underline" href={qr} download={`QRIS-${payment.order_number}.png`}>Unduh QRIS</a></> : <p>Menyiapkan QRIS...</p>}
                <p className="text-sm text-ink-500">Pindai dengan aplikasi bank atau e-wallet. Cocokkan nominal dan nama penerima sebelum membayar.</p>
              </div>}
              {payment.instructions?.kind === 'va' && <div className="space-y-3 rounded-xl bg-ink-50 p-4 dark:bg-ink-900">
                <p className="text-sm font-semibold">Virtual Account {payment.instructions.bank}</p>
                <p className="break-all font-mono text-2xl font-bold tracking-wide">{payment.instructions.pay_code}</p>
                <Button type="button" variant="secondary" onClick={() => void copy()}><Copy size={16} className="mr-2" />{copied ? 'Nomor tersalin' : 'Salin nomor VA'}</Button>
                <p className="text-sm text-ink-500">Bayar melalui menu virtual account di aplikasi bank atau ATM. Cocokkan nominal dan nama penerima.</p>
              </div>}
              {!payment.instructions && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                <p>{payment.channel === 'MAYAR' ? 'Metode yang dipilih memerlukan halaman pembayaran Mayar.' : 'Kode pembayaran belum tersedia dari Mayar. Pesanan sudah tersimpan. Jangan membuat pesanan baru.'}</p>
                {payment.checkout_url ? <a className="inline-block font-semibold underline" href={payment.checkout_url} target="_blank" rel="noopener noreferrer">Buka pembayaran Mayar di tab baru</a> : <p>Hubungi toko untuk memeriksa pembayaran pesanan ini.</p>}
              </div>}
            </>}
          {payment.warning && <p role="status" className="text-sm text-amber-700">{payment.warning}</p>}
          {payable && <p className="text-xs text-ink-500">Status diperiksa otomatis setiap 30 detik. Halaman ini dapat dibuka kembali melalui Akun Saya → Pesanan.</p>}
        </>}
        {!paid && <Button variant="secondary" disabled={busy} onClick={() => setAttempt((n) => n + 1)}><RefreshCcw size={16} className="mr-2" />{busy ? 'Memeriksa...' : 'Periksa status pembayaran'}</Button>}
      </>}
      <Link to="/toko/akun?tab=pesanan" className="block text-center text-sm font-semibold text-brand-600 underline">Lihat pesanan saya</Link>
    </Card>
  </div></PublicShell>;
}
