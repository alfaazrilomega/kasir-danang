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
  order_id: string; order_number: string; provider: 'mayar' | 'tripay'; base_amount?: number; steps?: { title: string; steps: string[] }[]; mode: string; channel: string; amount: number;
  status: 'paid' | 'expired' | 'unpaid'; expires_at: string | null; server_time: string;
  instructions: { kind: 'qris'; qr_string: string | null; qr_url?: string | null } | { kind: 'va' | 'code'; pay_code: string; bank: string } | null;
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
  const [copied, setCopied] = useState<'code' | 'amount' | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const expiryChecked = useRef('');
  const currentPayment = useRef(payment);
  currentPayment.current = payment;
  const [downloading, setDownloading] = useState(false);
  const terminal = useRef(false);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [orderId]);
  useEffect(() => {
    setPayment(null); setError(''); setQr(''); setCopied(null); setCheckedAt(null); setBusy(false);
    expiryChecked.current = '';
    return () => { currentPayment.current = null; };
  }, [orderId, token]);
  useEffect(() => {
    let alive = true, controller: AbortController | null = null, timer: ReturnType<typeof setTimeout>;
    terminal.current = false; setError('');
    async function load() {
      if (!token || !alive || terminal.current) return;
      controller = new AbortController();
      setBusy(true);
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const res = await fetch(`${loadConfig().apiBaseUrl}/api/customer/orders/${encodeURIComponent(orderId)}/payment`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (!alive) return;
        if ([401, 403, 404].includes(res.status)) { setPayment(null); terminal.current = true; }
        const body = await res.json();
        if (!alive) return;
        if (!res.ok || !body.data) throw new Error(body.error || 'Pembayaran belum dapat dimuat.');
        const next = body.data as Payment;
        setPayment(next); setError(''); setCheckedAt(new Date()); setNow(Date.now());
        const serverTime = Date.parse(next.server_time);
        setOffset(Number.isFinite(serverTime) ? serverTime - Date.now() : 0);
        terminal.current = next.status === 'paid' || next.status === 'expired';
      } catch (error) {
        if (alive) setError(error instanceof Error && error.name === 'AbortError'
          ? 'Pemeriksaan terlalu lama. Data terakhir tetap tersedia. Coba periksa kembali.'
          : error instanceof Error ? error.message : 'Koneksi terputus. Coba periksa kembali.');
      } finally {
        clearTimeout(timeout);
        if (alive) { setBusy(false); if (!terminal.current) timer = setTimeout(() => void load(), 30000); }
      }
    }
    void load();
    return () => { alive = false; clearTimeout(timer); controller?.abort(); };
  }, [orderId, token, attempt]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const raw = payment?.instructions?.kind === 'qris' ? payment.instructions.qr_string : null;
  useEffect(() => {
    let alive = true; setQr(''); setQrFailed(false);
    if (raw) void QRCode.toDataURL(raw, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setQr(url); }).catch(() => { if (alive) setQrFailed(true); });
    return () => { alive = false; };
  }, [raw]);
  const remoteQr = payment?.instructions?.kind === 'qris' ? payment.instructions.qr_url : null;
  const qrImage = qr || (!raw || qrFailed ? remoteQr : null);
  const gatewayName = payment?.provider === 'tripay' ? 'Tripay' : 'Mayar';
  const deadline = payment?.expires_at ? Date.parse(payment.expires_at) : NaN;
  const remaining = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now - offset) / 1000)) : null;
  const paid = payment?.status === 'paid';
  const expired = payment?.status === 'expired' || remaining === 0;
  const payable = payment && !paid && !expired;
  useEffect(() => {
    if (!expired || payment?.status !== 'unpaid') return;
    const key = `${orderId}:${payment.expires_at}`;
    if (expiryChecked.current === key) return;
    expiryChecked.current = key;
    setAttempt(n => n + 1);
  }, [expired, payment?.status, payment?.expires_at, orderId]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(kind: 'code' | 'amount') {
    if (!payable) return;
    const value = kind === 'amount' ? String(payment.amount)
      : payment.instructions && payment.instructions.kind !== 'qris' ? payment.instructions.pay_code : null;
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setCopied(kind); }
    catch { setError('Belum tersalin. Pilih dan salin nominal atau kode pembayaran secara manual.'); }
  }
  async function downloadQr() {
    if (!qrImage || !payable || downloading) return;
    setDownloading(true);
    let objectUrl: string | null = null;
    try {
      let href = qrImage;
      let extension = 'png';
      if (!qrImage.startsWith('data:image/png')) {
        const response = await fetch(qrImage, { signal: AbortSignal.timeout(10000), credentials: 'omit' });
        const blob = await response.blob();
        if (!response.ok || !/^image\/(png|jpeg|webp)$/.test(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error('QRIS tidak dapat diunduh.');
        extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
        href = objectUrl = URL.createObjectURL(blob);
      }
      // Status bisa berubah ketika gambar masih diunduh.
      const latest = currentPayment.current;
      if (!latest || latest.order_id !== payment.order_id || latest.status !== 'unpaid' || latest.amount !== payment.amount || latest.expires_at !== payment.expires_at
        || latest.instructions?.kind !== 'qris' || payment.instructions?.kind !== 'qris'
        || latest.instructions.qr_string !== payment.instructions.qr_string || latest.instructions.qr_url !== payment.instructions.qr_url
        || (Number.isFinite(deadline) && Date.now() + offset >= deadline)) return;
      const link = document.createElement('a');
      link.href = href; link.download = `QRIS-${payment.order_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;
      document.body.append(link); link.click(); link.remove();
    } catch { setError(remoteQr ? 'QRIS belum dapat diunduh. Gunakan Buka gambar QRIS, lalu simpan gambar dari browser.' : 'QRIS belum dapat diunduh. Coba lagi atau tekan lama gambar untuk menyimpannya.'); }
    finally { if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000); setDownloading(false); }
  }
  return <PublicShell><div className="mx-auto max-w-xl space-y-4 py-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold">Pembayaran pesanan</h1>
      {payment && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${paid ? 'bg-emerald-100 text-emerald-800' : expired ? 'bg-amber-100 text-amber-900' : 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'}`}>{paid ? 'Lunas' : expired ? 'Kedaluwarsa / dibatalkan' : 'Menunggu pembayaran'}</span>}
    </div>
    <Card className="space-y-5 p-5 sm:p-7">
      {!token ? <><p>Masuk dengan akun pemilik pesanan untuk melihat pembayaran.</p><Button onClick={() => bukaMasuk('masuk', `/toko/checkout?order=${encodeURIComponent(orderId)}`)}>Masuk</Button></> : <>
        {!payment && busy && <p role="status">Memuat pembayaran...</p>}
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
        {payment && <>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-ink-500">{payment.order_number}</span><span className="text-xs font-semibold text-brand-600">{gatewayName} · {payment.channel}</span></div>
          {payment.mode === 'sandbox' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Mode uji coba. Jangan melakukan pembayaran uang sungguhan.</p>}
          <div><p className="text-sm text-ink-500">{payment.termasuk_ongkir ? 'Total pembayaran' : 'Total pembayaran barang'}</p><p className="mt-1 select-all text-3xl font-bold">{formatMoney(payment.amount)}</p>{payable && <button type="button" onClick={() => void copy('amount')} className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-400"><Copy size={14} />{copied === 'amount' ? 'Nominal tersalin' : 'Salin nominal'}</button>}{payment.base_amount != null && payment.amount > payment.base_amount && <p className="mt-2 text-xs text-ink-500">Pesanan {formatMoney(payment.base_amount)} + biaya pembayaran {formatMoney(payment.amount - payment.base_amount)}</p>}<p className="mt-2 text-xs text-ink-500">{payment.termasuk_ongkir ? 'Sudah termasuk ongkir.' : 'Ongkir ditagih terpisah setelah dikonfirmasi toko.'}</p></div>
          {paid ? <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800"><CheckCircle2 className="mb-2" /><p className="font-semibold">Pembayaran diterima</p><p className="mt-1 text-sm">Toko akan mengonfirmasi dan memproses pesanan Anda.</p></div>
            : expired ? <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Pembayaran kedaluwarsa atau dibatalkan. Jangan membayar kode ini. Jika sudah membayar, periksa status atau hubungi toko.</p>
            : <>
              {remaining !== null && <div className={`space-y-2 rounded-xl p-4 ${remaining <= 300 ? 'bg-amber-50 text-amber-900' : 'bg-ink-50 dark:bg-ink-900'}`}>
                <div className="flex items-center gap-2 text-sm"><Clock size={16} /><span>Batas pembayaran: <strong className="font-mono tabular-nums">{Math.floor(remaining / 3600).toString().padStart(2, '0')}:{Math.floor(remaining % 3600 / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</strong></span></div>
                <p className="text-xs">{new Date(deadline).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB</p>
                {remaining <= 300 && <p className="text-xs">Waktu hampir habis. Jangan gunakan kode setelah batas pembayaran.</p>}
              </div>}
              {payment.instructions?.kind === 'qris' && <div className="space-y-3 text-center">
                {qrImage ? <><img src={qrImage} alt="QRIS pembayaran pesanan" className="mx-auto w-full max-w-72 rounded-xl" onError={() => setError('Gambar QRIS gagal dimuat. Periksa koneksi atau hubungi toko.')} /><Button type="button" variant="secondary" disabled={downloading} onClick={() => void downloadQr()}>{downloading ? 'Mengunduh...' : 'Simpan QRIS'}</Button>
                  {!qr && remoteQr && <a className="block text-sm font-semibold text-brand-600 underline" href={remoteQr} target="_blank" rel="noopener noreferrer">Buka gambar QRIS</a>}</> : <p role="status">{qrFailed ? 'QRIS belum dapat ditampilkan. Hubungi toko sebelum membayar.' : 'Menyiapkan QRIS...'}</p>}
                <p className="text-sm text-ink-500">Pindai dengan aplikasi bank atau e-wallet. Cocokkan nominal dan nama penerima sebelum membayar.</p>
              </div>}
              {payment.instructions && payment.instructions.kind !== 'qris' && <div className="space-y-3 rounded-xl bg-ink-50 p-4 dark:bg-ink-900">
                <p className="text-sm font-semibold">{payment.instructions.kind === 'va' ? 'Virtual Account' : 'Kode Pembayaran'} {payment.instructions.bank}</p>
                <p className="select-all break-all font-mono text-2xl font-bold tracking-wide">{payment.instructions.pay_code}</p>
                <Button type="button" variant="secondary" onClick={() => void copy('code')}><Copy size={16} className="mr-2" />{copied === 'code' ? 'Nomor tersalin' : payment.instructions.kind === 'va' ? 'Salin nomor VA' : 'Salin kode pembayaran'}</Button>
                <p className="text-sm text-ink-500">{payment.instructions.kind === 'va' ? 'Bayar melalui menu virtual account di aplikasi bank atau ATM.' : 'Gunakan kode ini pada kanal pembayaran yang dipilih.'} Cocokkan nominal dan nama penerima.</p>
              </div>}
              {payment.steps?.map((section, index) => <details key={index} className="rounded-xl border border-ink-200 p-4 dark:border-ink-700">
                <summary className="cursor-pointer text-sm font-semibold">{section.title || 'Petunjuk pembayaran'}</summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{section.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
              </details>)}
              {!payment.instructions && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                <p>{payment.channel === 'MAYAR' ? 'Metode yang dipilih memerlukan halaman pembayaran Mayar.' : 'Kode pembayaran belum tersedia. Pesanan sudah tersimpan. Jangan membuat pesanan baru.'}</p>
                {payment.checkout_url ? <a className="inline-block font-semibold underline" href={payment.checkout_url} target="_blank" rel="noopener noreferrer">Buka pembayaran {gatewayName} di tab baru</a> : <p>Hubungi toko untuk memeriksa pembayaran pesanan ini.</p>}
              </div>}
            </>}
          {checkedAt && <p className="text-xs text-ink-500">Status terakhir diperiksa {checkedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.</p>}
          {payment.warning && <p role="status" className="text-sm text-amber-700">{payment.warning}</p>}
          {payable && <p className="text-xs text-ink-500">Status diperiksa otomatis setiap 30 detik. Halaman ini dapat dibuka kembali melalui Akun Saya → Pesanan.</p>}
        </>}
        {!paid && <Button variant="secondary" disabled={busy} onClick={() => setAttempt((n) => n + 1)}><RefreshCcw size={16} className="mr-2" />{busy ? 'Memeriksa...' : 'Periksa status pembayaran'}</Button>}
      </>}
      <Link to="/toko/akun?tab=pesanan" className="block text-center text-sm font-semibold text-brand-600 underline">Lihat pesanan saya</Link>
    </Card>
  </div></PublicShell>;
}
