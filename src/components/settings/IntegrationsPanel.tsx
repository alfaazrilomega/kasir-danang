import { useEffect, useRef, useState } from 'react';
import { CreditCard, Truck, MessageCircle, MessagesSquare, Mail, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getBackendClient, type IntegrationSettings, type TripaySettings, type MayarSettings, type DokuSettings, type PaymentGateway, type KiriminAjaSettings, type OneSenderSettings, type MetaWhatsAppSettings } from '@/lib/api';
import { loadConfig } from '@/lib/config';
import { cn, formatMoney } from '@/lib/format';
import type { KanalBayar } from '@/lib/publicPayments';
import { Link } from '@/lib/router';

type Provider = keyof IntegrationSettings;

function useIntegration<P extends Provider>(provider: P, initial: IntegrationSettings[P]) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testChannels, setTestChannels] = useState<KanalBayar[] | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  function change(patch: Partial<IntegrationSettings[P]>) {
    setForm((current) => ({ ...current, ...patch }));
    setTestMessage('');
    setTestChannels(null);
  }
  async function save() {
    setBusy(true);
    try {
      const api = getBackendClient();
      if (!api) throw new Error('Koneksi server belum tersedia.');
      const { data, error } = await api.admin.saveIntegration(provider, form);
      if (error || !data) throw new Error(error?.message || 'Pengaturan gagal disimpan.');
      setForm(data);
      setSaved(data);
      setTestMessage('');
      setTestChannels(null);
      toast.success('Pengaturan integrasi tersimpan.');
      // Mayar: webhook didaftarkan otomatis saat kunci aktif disimpan.
      const webhook = (data as { webhook?: { ok: boolean; message: string } }).webhook;
      if (webhook) (webhook.ok ? toast.success : toast.warning)(webhook.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Pengaturan gagal disimpan.');
    } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    setTestMessage('');
    setTestChannels(null);
    try {
      const api = getBackendClient();
      if (!api) throw new Error('Koneksi server belum tersedia.');
      const { data, error } = await api.admin.testIntegration(provider);
      if (error || !data) throw new Error(error?.message || 'Tes koneksi gagal.');
      setTestMessage(data.message);
      setTestChannels(data.channels ?? null);
      toast.success(data.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tes koneksi gagal.';
      setTestMessage(message);
      if (provider === 'tripay') setTestChannels([]);
      toast.error(message);
    } finally { setBusy(false); }
  }
  return { form, saved, change, busy, dirty, testMessage, testChannels, save, test };
}

function ModeFields({ provider, enabled, mode, onChange }: {
  provider: 'tripay' | 'mayar' | 'doku' | 'kiriminaja'; enabled: boolean; mode: 'sandbox' | 'production';
  onChange: (patch: { enabled?: boolean; mode?: 'sandbox' | 'production' }) => void;
}) {
  return <div className="grid items-start gap-4 rounded-xl bg-ink-50 p-4 sm:grid-cols-2 dark:bg-ink-900">
    <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      Aktifkan {provider === 'tripay' ? 'Tripay' : provider === 'mayar' ? 'Mayar' : provider === 'doku' ? 'DOKU' : 'KiriminAja'}
    </label>
    <div className="space-y-1.5">
      <label htmlFor={`${provider}-mode`} className="block text-sm font-medium">Mode</label>
      <select id={`${provider}-mode`} className="input" value={mode} onChange={(event) => onChange({ mode: event.target.value as 'sandbox' | 'production' })}>
        <option value="sandbox">Sandbox (uji coba)</option>
        <option value="production">Production (transaksi nyata)</option>
      </select>
      <p className="text-xs text-ink-500">Gunakan kunci sesuai mode. Isi ulang kunci API saat mengganti mode.</p>
    </div>
  </div>;
}

function FormActions({ busy, dirty, testMessage, canTest, test, hint }: {
  busy: boolean; dirty: boolean; testMessage: string; canTest: boolean; test: () => Promise<void>; hint?: string;
}) {
  return <div className="space-y-3 border-t border-ink-200 pt-5 dark:border-ink-700">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={busy || !dirty}>{busy ? 'Memproses...' : 'Simpan integrasi'}</Button>
      <Button type="button" variant="secondary" disabled={busy || dirty || !canTest} onClick={() => void test()}>Tes koneksi</Button>
      {dirty && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Perubahan belum disimpan</span>}
    </div>
    <p className="text-xs text-ink-500">{hint || 'Simpan perubahan sebelum tes koneksi. Tes hanya memeriksa akses API, tanpa membuat transaksi.'}</p>
    {testMessage && <p role="status" className="rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-900">{testMessage}</p>}
  </div>;
}

function secretHint(saved: boolean) {
  return saved ? 'Kunci sudah tersimpan. Kosongkan untuk mempertahankannya.' : 'Kunci belum diisi.';
}

function TripayForm({ initial }: { initial: TripaySettings }) {
  const state = useIntegration('tripay', initial);
  const { form, change } = state;
  const [channels, setChannels] = useState<KanalBayar[]>([]);
  const [channelError, setChannelError] = useState('');
  const [loadingChannels, setLoadingChannels] = useState(false);
  useEffect(() => {
    let alive = true;
    setChannels([]);
    setChannelError('');
    const api = getBackendClient();
    if (!state.saved.hasApiKey || !api) return;
    setLoadingChannels(true);
    void api.admin.tripayChannels().then(({ data, error }) => {
      if (!alive) return;
      setChannels(data?.channels ?? []);
      setChannelError(error?.message || '');
      setLoadingChannels(false);
    });
    return () => { alive = false; };
  }, [state.saved]);
  const visibleChannels = state.testChannels ?? channels;
  const callbackExample = `${(loadConfig().apiBaseUrl || window.location.origin).replace(/\/$/, '')}/api/tripay/callback`;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="min-w-0">
    <fieldset disabled={state.busy} className="min-w-0 space-y-5">
      <legend className="sr-only">Tripay</legend>
      <ModeFields provider="tripay" enabled={form.enabled} mode={form.mode} onChange={change} />
      <p className="text-xs text-ink-500">{form.mode === 'sandbox'
        ? 'Sandbox: salin Merchant Code, API Key, dan Private Key dari API & Integrasi > Simulator > Merchant. Aktifkan kanal pada merchant Simulator yang sama.'
        : 'Production: gunakan kredensial Merchant produksi dan aktifkan kanal pada menu Atur Channel Pembayaran merchant tersebut.'}</p>
      <Input id="tripay-merchant" label="Merchant Code" value={form.merchantCode} onChange={(event) => change({ merchantCode: event.target.value })} required={form.enabled} autoComplete="off" />
      <div className="grid gap-4 md:grid-cols-2">
      <Input id="tripay-api-key" label="API Key" type="password" value={form.apiKey ?? ''} onChange={(event) => change({ apiKey: event.target.value })} hint={secretHint(form.hasApiKey)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasApiKey} />
      <Input id="tripay-private-key" label="Private Key" type="password" value={form.privateKey ?? ''} onChange={(event) => change({ privateKey: event.target.value })} hint={secretHint(form.hasPrivateKey)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasPrivateKey} />
      </div>
      <Input id="tripay-callback" label="URL Callback" type="url" placeholder={callbackExample} value={form.callbackUrl} onChange={(event) => change({ callbackUrl: event.target.value })} hint="Isi URL HTTPS API toko yang dapat diakses Tripay. Jika kosong, server menggunakan endpoint callback toko di bawah ini." />
      <p className="break-all text-xs text-ink-500">Endpoint callback toko: {callbackExample}</p>
      <Input id="tripay-return" label="URL Kembali (opsional)" type="url" value={form.returnUrl} onChange={(event) => change({ returnUrl: event.target.value })} hint="Halaman HTTPS untuk pelanggan setelah pembayaran." />
      <a href="https://tripay.co.id/developer?tab=callback" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi Tripay</a>
      <FormActions {...state} canTest={form.hasApiKey} />
      <p className="text-xs text-ink-500">Status pembayaran diperiksa ulang berkala bila callback terlambat. Selesaikan pembayaran berjalan sebelum mengganti kredensial atau mode.</p>
      <p className="text-xs text-ink-500">Tes koneksi memeriksa API Key. Merchant Code, Private Key, dan callback perlu diverifikasi melalui transaksi sandbox.</p>
      <div className="space-y-2 border-t border-ink-200 pt-4 dark:border-ink-700">
        <h3 className="text-sm font-semibold">Metode pembayaran Tripay</h3>
        <p className="text-xs text-ink-500">Daftar mengikuti merchant dan mode tersimpan. Ubah status kanal di dashboard Tripay, lalu klik Tes koneksi untuk menyinkronkan.</p>
        {state.dirty ? <p className="text-sm">Simpan perubahan untuk melihat kanal sesuai konfigurasi baru.</p> : <>
          {loadingChannels && !state.testChannels && <p role="status" className="text-sm">Memuat kanal...</p>}
          {channelError && !state.testChannels && <p role="alert" className="text-sm text-rose-600">{channelError}</p>}
          {!loadingChannels && !channelError && visibleChannels.length === 0 && <p className="text-sm text-ink-500">Belum ada kanal. Periksa kredensial dan pengaturan kanal merchant.</p>}
          {visibleChannels.length > 0 && <ul className="divide-y divide-ink-100 dark:divide-ink-700">
            {visibleChannels.map((channel) => <li key={channel.code} className="flex items-center gap-3 py-3">
              {channel.icon_url && <img src={channel.icon_url} alt="" className="h-7 w-10 object-contain" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{channel.name}</div>
                <div className="text-xs text-ink-500">{channel.group} · {channel.code}</div>
                <div className="text-xs text-ink-500">Biaya pelanggan: {channel.fee_flat || channel.fee_percent
                  ? `${formatMoney(channel.fee_flat || 0)}${channel.fee_percent ? ` + ${channel.fee_percent}%` : ''}` : 'Tanpa biaya gateway'}</div>
              </div>
              <span className={channel.active ? 'text-xs text-emerald-600' : 'text-xs text-ink-400'}>{channel.active ? 'Aktif' : 'Nonaktif'}</span>
            </li>)}
          </ul>}
        </>}
      </div>
    </fieldset>
  </form>;
}

function KiriminAjaForm({ initial }: { initial: KiriminAjaSettings }) {
  const state = useIntegration('kiriminaja', initial);
  const { form, change } = state;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="min-w-0">
    <fieldset disabled={state.busy} className="min-w-0 space-y-5">
      <legend className="sr-only">KiriminAja</legend>
      <ModeFields provider="kiriminaja" enabled={form.enabled} mode={form.mode} onChange={change} />
      <Input id="kiriminaja-token" label="API Key / Bearer Token" type="password" value={form.token ?? ''} onChange={(event) => change({ token: event.target.value })} hint={secretHint(form.hasToken)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasToken} />
      <AsalKirim form={form} tokenTersimpan={state.saved.hasToken} asalTersimpan={state.saved.originSubdistrict} change={change} />
      <p className="text-xs text-ink-500">{state.saved.enabled && state.saved.hasToken && state.saved.originSubdistrict
        ? 'Aktif: checkout menghitung ongkir otomatis. Pembeli memilih kecamatan, kelurahan, dan kurir, lalu ongkir ikut ditagih.'
        : 'Setelah token tersimpan, alamat asal dipilih, dan integrasi diaktifkan, checkout menghitung ongkir otomatis: pembeli memilih kecamatan, kelurahan, dan kurir, lalu ongkir ikut ditagih. Selama belum aktif, ongkir tetap diisi staf saat konfirmasi.'}</p>
      <a href="https://developer.kiriminaja.com/docs" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi KiriminAja</a>
      <FormActions {...state} canTest={form.hasToken} />
    </fieldset>
  </form>;
}

type LevelAsal = 'provinsi' | 'kota' | 'kecamatan' | 'kelurahan';
const TINGKAT_ASAL: LevelAsal[] = ['provinsi', 'kota', 'kecamatan', 'kelurahan'];
const LABEL_ASAL: Record<LevelAsal, string> = { provinsi: 'Provinsi', kota: 'Kota/Kabupaten', kecamatan: 'Kecamatan', kelurahan: 'Kelurahan/Desa' };

/** Alamat asal kirim dipilih bertingkat dari wilayah KiriminAja (spec 0002, AC-15). */
function AsalKirim({ form, tokenTersimpan, asalTersimpan, change }: {
  form: KiriminAjaSettings; tokenTersimpan: boolean; asalTersimpan: string; change: (patch: Partial<KiriminAjaSettings>) => void;
}) {
  const [pilih, setPilih] = useState<Record<LevelAsal, { id: number; nama: string } | null>>({ provinsi: null, kota: null, kecamatan: null, kelurahan: null });
  const [daftar, setDaftar] = useState<Record<LevelAsal, { id: number; nama: string }[]>>({ provinsi: [], kota: [], kecamatan: [], kelurahan: [] });
  const [galat, setGalat] = useState('');
  const [ubah, setUbah] = useState(!form.originSubdistrict);
  // Setelah alamat asal tersimpan, panel kembali ke ringkasan.
  useEffect(() => { if (asalTersimpan) setUbah(false); }, [asalTersimpan]);
  useEffect(() => {
    if (!tokenTersimpan || !ubah) return;
    let hidup = true;
    (async () => {
      for (const [i, level] of TINGKAT_ASAL.entries()) {
        const atas = i ? pilih[TINGKAT_ASAL[i - 1]] : undefined;
        if (atas === null) { setDaftar((d) => ({ ...d, [level]: [] })); continue; }
        const hasil = await getBackendClient()?.admin.kiriminajaWilayah(level, atas?.id);
        if (!hidup) return;
        if (!hasil?.data || hasil.error) { setGalat(hasil?.error?.message || 'Wilayah KiriminAja gagal dimuat.'); return; }
        setGalat('');
        setDaftar((d) => ({ ...d, [level]: hasil.data! }));
      }
    })();
    return () => { hidup = false; };
  }, [tokenTersimpan, ubah, pilih.provinsi?.id, pilih.kota?.id, pilih.kecamatan?.id]);
  function ganti(level: LevelAsal, id: string) {
    const item = daftar[level].find((x) => String(x.id) === id) ?? null;
    const urut = TINGKAT_ASAL.indexOf(level);
    const baru = { ...pilih, [level]: item };
    for (const bawah of TINGKAT_ASAL.slice(urut + 1)) baru[bawah] = null;
    setPilih(baru);
    const lengkap = baru.kecamatan && baru.kelurahan;
    change({
      originDistrict: lengkap ? String(baru.kecamatan!.id) : '',
      originSubdistrict: lengkap ? String(baru.kelurahan!.id) : '',
      originLabel: lengkap ? [baru.kota?.nama, baru.kecamatan?.nama, baru.kelurahan?.nama].join(', ') : '',
    });
  }
  if (!tokenTersimpan) return <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600 dark:bg-ink-900 dark:text-ink-300">Simpan token KiriminAja dulu, lalu pilih alamat asal gudang di sini.</p>;
  if (!ubah) {
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-900">
      <span><span className="block text-xs text-ink-500">Alamat asal kirim</span>{form.originLabel || `Kecamatan ${form.originDistrict}, kelurahan ${form.originSubdistrict}`}</span>
      <Button type="button" variant="secondary" onClick={() => setUbah(true)}>Ubah alamat asal</Button>
    </div>;
  }
  return <div className="space-y-2">
    <p className="text-sm font-medium">Alamat asal kirim (gudang)</p>
    {galat && <p role="alert" className="text-sm text-rose-600">{galat}</p>}
    <div className="grid gap-3 md:grid-cols-2">
      {TINGKAT_ASAL.map((level, i) => {
        const terkunci = i > 0 && !pilih[TINGKAT_ASAL[i - 1]];
        return <div key={level} className="space-y-1.5">
          <label htmlFor={`asal-${level}`} className="block text-sm font-medium">{LABEL_ASAL[level]}</label>
          <select id={`asal-${level}`} className="input min-h-[44px] w-full" disabled={terkunci} value={pilih[level] ? String(pilih[level]!.id) : ''} onChange={(event) => ganti(level, event.target.value)}>
            <option value="">{terkunci ? `Pilih ${LABEL_ASAL[TINGKAT_ASAL[i - 1]].toLowerCase()} dulu` : `Pilih ${LABEL_ASAL[level].toLowerCase()}…`}</option>
            {daftar[level].map((x) => <option key={x.id} value={String(x.id)}>{x.nama}</option>)}
          </select>
        </div>;
      })}
    </div>
    <p className="text-xs text-ink-500">Dipakai sebagai titik jemput kurir dan dasar hitung ongkir. Pilih sampai kelurahan, lalu simpan integrasi.</p>
  </div>;
}

function DokuForm({ initial }: { initial: DokuSettings }) {
  const state = useIntegration('doku', initial);
  const { form, change } = state;
  const notifikasi = form.notificationUrl || `${(loadConfig().apiBaseUrl || window.location.origin).replace(/\/$/, '')}/api/doku/notifikasi`;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="min-w-0">
    <fieldset disabled={state.busy} className="min-w-0 space-y-5">
      <legend className="sr-only">DOKU</legend>
      <ModeFields provider="doku" enabled={form.enabled} mode={form.mode} onChange={change} />
      <p className="text-sm text-ink-500">Salin Client ID dan Secret Key dari {form.mode === 'sandbox' ? 'sandbox.doku.com' : 'dashboard.doku.com'} menu Integration &gt; API Keys. Pembeli memilih metode bayar (virtual account, QRIS, dompet digital, minimarket) di halaman DOKU.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Input id="doku-client-id" label="Client ID" value={form.clientId} onChange={(event) => change({ clientId: event.target.value })} required={form.enabled} autoComplete="off" spellCheck={false} />
        <Input id="doku-secret-key" label="Secret Key" type="password" value={form.secretKey ?? ''} onChange={(event) => change({ secretKey: event.target.value })} hint={secretHint(form.hasSecretKey)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasSecretKey} />
      </div>
      <a href="https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration.md" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi DOKU Checkout</a>
      <FormActions {...state} canTest={form.hasSecretKey && !!form.clientId} />
      <div className="space-y-2 rounded-xl border border-ink-200 p-4 dark:border-ink-700">
        <h4 className="text-sm font-semibold">Alamat notifikasi pembayaran</h4>
        <p className="break-all font-mono text-sm">{notifikasi}</p>
        <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard.writeText(notifikasi).then(() => toast.success('Alamat notifikasi disalin.')).catch(() => toast.error('Alamat gagal disalin.')); }}>Salin alamat</Button>
        <p className="text-xs text-ink-500">Tempel alamat ini di DOKU Back Office &gt; Settings &gt; Payment Settings &gt; Notification URL supaya pesanan langsung lunas setelah dibayar. Tanpa langkah ini, status tetap diperiksa otomatis setiap beberapa menit.</p>
      </div>
    </fieldset>
  </form>;
}

function OneSenderForm({ initial }: { initial: OneSenderSettings }) {
  const state = useIntegration('onesender', initial);
  const { form, change } = state;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="min-w-0">
    <fieldset disabled={state.busy} className="min-w-0 space-y-5">
      <legend className="sr-only">OneSender</legend>
      <Input id="onesender-phone" label="Phone number" type="tel" value={form.phoneNumber} onChange={(event) => change({ phoneNumber: event.target.value })} placeholder="6281234567890" maxLength={30} required hint="Nomor perangkat pengirim yang terdaftar di OneSender, dengan kode negara. Nomor 08 akan diubah menjadi 628." />
      <Input id="onesender-api-url" label="API URL" type="url" value={form.apiUrl} onChange={(event) => change({ apiUrl: event.target.value })} placeholder="http://server-anda:3001/api/v1/messages" required autoComplete="off" spellCheck={false} hint="Salin API URL lengkap dari Device info OneSender. HTTP dan HTTPS didukung. Isi ulang API Key jika URL diganti." />
      <Input id="onesender-api-key" label="API Key" type="password" value={form.apiKey ?? ''} onChange={(event) => change({ apiKey: event.target.value })} hint={secretHint(form.hasApiKey)} autoComplete="new-password" spellCheck={false} required={!form.hasApiKey} />
      <a href="https://documenter.getpostman.com/view/11282121/Uyr8md8U" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi OneSender</a>
      <FormActions {...state} canTest={form.hasApiKey && !!form.apiUrl && !!form.phoneNumber} hint="Simpan perubahan sebelum tes koneksi. Tes memeriksa akses API tanpa mengirim pesan WhatsApp." />
      <p className="text-xs text-ink-500">Hubungkan nomor perangkat melalui Scan QR Code di dashboard OneSender. Tes API tidak memastikan perangkat WhatsApp sedang online.</p>
      <Link to="/whatsapp-templates" className="inline-block text-sm font-semibold text-brand-600 underline">Atur template order dan follow-up WhatsApp</Link>
    </fieldset>
  </form>;
}

function MetaWhatsAppForm({ initial }: { initial: MetaWhatsAppSettings }) {
  const state = useIntegration('meta_whatsapp', initial);
  const { form, change } = state;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="min-w-0">
    <fieldset disabled={state.busy} className="min-w-0 space-y-5">
      <legend className="sr-only">WhatsApp Cloud API (Meta)</legend>
      <p className="text-sm text-ink-500">Masukkan kredensial WhatsApp Business Platform dari dashboard aplikasi Meta.</p>
      <div className="grid gap-4 md:grid-cols-2">
      <Input id="meta-wa-waba" label="WhatsApp Business Account ID (WABA)" value={form.wabaId} onChange={(event) => change({ wabaId: event.target.value })} inputMode="numeric" pattern="[1-9][0-9]{0,29}" maxLength={30} required hint="ID akun WhatsApp Business, bukan Business Portfolio ID." />
      <Input id="meta-wa-phone-id" label="Phone Number ID" value={form.phoneNumberId} onChange={(event) => change({ phoneNumberId: event.target.value })} inputMode="numeric" pattern="[1-9][0-9]{0,29}" maxLength={30} required hint="ID nomor dari menu WhatsApp > API Setup di Meta, bukan nomor telepon 628...." />
      </div>
      <Input id="meta-wa-token" label="Access Token" type="password" value={form.accessToken ?? ''} onChange={(event) => change({ accessToken: event.target.value })} required={!form.hasAccessToken} autoComplete="new-password" spellCheck={false} hint={form.hasAccessToken ? 'Token sudah tersimpan. Kosongkan untuk mempertahankannya.' : 'Tempel token tanpa awalan Bearer. Tes akses akun memerlukan izin whatsapp_business_management.'} />
      <Input id="meta-wa-version" label="Versi Graph API" value={form.apiVersion} onChange={(event) => change({ apiVersion: event.target.value })} placeholder="vNN.0" pattern="v[1-9][0-9]{0,2}\.0" required hint="Salin versi yang digunakan pada contoh request di dashboard Meta." />
      <p className="break-all text-xs text-ink-500">Server API: https://graph.facebook.com</p>
      <a href="https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi resmi Meta</a>
      <FormActions {...state} canTest={form.hasAccessToken && !!form.wabaId && !!form.phoneNumberId && !!form.apiVersion} hint="Simpan perubahan sebelum tes koneksi. Tes memeriksa akses token dan nomor pada WABA, tanpa mengirim pesan WhatsApp." />
      <p className="text-xs text-ink-500">Pengiriman memerlukan izin whatsapp_business_messaging. Pilih Meta dan template approved di menu Template WA. Tes koneksi hanya memeriksa akses akun, bukan pengiriman pesan.</p>
      <Link to="/whatsapp-templates" className="inline-block text-sm font-semibold text-brand-600 underline">Atur template order dan follow-up WhatsApp</Link>
    </fieldset>
  </form>;
}

function MayarForm({ initial }: { initial: MayarSettings }) {
  const state = useIntegration('mayar', initial);
  const [channels, setChannels] = useState<KanalBayar[]>([]);
  const [channelError, setChannelError] = useState('');
  const [registering, setRegistering] = useState(false);
  const { form, change } = state;
  useEffect(() => {
    let active = true;
    setChannels([]); setChannelError('');
    if (state.saved.hasApiKey) void getBackendClient()?.admin.mayarChannels().then(({ data, error }) => {
      if (active) { setChannels(data?.channels || []); setChannelError(error?.message || ''); }
    });
    return () => { active = false; };
  }, [state.saved]);
  async function registerWebhook() {
    setRegistering(true);
    try {
      const result = await getBackendClient()?.admin.registerMayarWebhook();
      if (!result?.data || result.error) throw new Error(result?.error?.message || 'Webhook gagal didaftarkan.');
      toast.success(result.data.message);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Webhook gagal didaftarkan.'); }
    finally { setRegistering(false); }
  }
  const callback = `${(loadConfig().apiBaseUrl || window.location.origin).replace(/\/$/, '')}/api/mayar/callback`;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }}>
    <fieldset disabled={state.busy || registering} className="min-w-0 space-y-5">
      <legend className="sr-only">Mayar</legend>
      <ModeFields provider="mayar" enabled={form.enabled} mode={form.mode} onChange={change} />
      <p className="text-sm text-ink-500">Buat API Key dengan izin Read &amp; Write pada {form.mode === 'sandbox' ? 'web.mayar.io' : 'web.mayar.id'}. Simpan kredensial, tes koneksi, lalu pilih Mayar sebagai layanan checkout di atas.</p>
      <Input id="mayar-api-key" label="API Key Mayar" type="password" value={form.apiKey ?? ''} onChange={(event) => change({ apiKey: event.target.value })} hint={secretHint(form.hasApiKey)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasApiKey} />
      <p className="text-xs text-ink-500">QRIS dan virtual account yang didukung dapat dipilih di checkout toko. Kode bayar tampil jika tersedia dari API Mayar. Metode lainnya memerlukan halaman Mayar. Tagihan berlaku 1 jam. Biaya Request Payment ditanggung merchant.</p>
      <a href="https://docs.mayar.id/api-reference-v2/introduction" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi Mayar API V2</a>
      <FormActions {...state} canTest={form.hasApiKey} />
      <div className="space-y-3 rounded-xl border border-ink-200 p-4 dark:border-ink-700">
        <h4 className="text-sm font-semibold">Webhook pembayaran</h4>
        <p className="break-all text-sm text-ink-500">{callback}</p>
        <p className="text-xs text-ink-500">Daftarkan URL ini untuk menerima status pembayaran. Tombol di bawah mengganti URL webhook pada akun Mayar. Pastikan akun tersebut digunakan untuk toko ini.</p>
        <Button type="button" variant="secondary" disabled={state.busy || state.dirty || !form.hasApiKey || registering} onClick={() => void registerWebhook()}>{registering ? 'Mendaftarkan...' : 'Daftarkan webhook toko'}</Button>
        <p className="text-xs text-ink-500">Status selalu diverifikasi ke API Mayar. Pemeriksaan berkala juga berjalan sebagai cadangan webhook. Selesaikan pembayaran berjalan sebelum mengganti mode atau kredensial.</p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Kanal di akun Mayar</h4>
        <p className="text-xs text-ink-500">Ubah kanal melalui dashboard Mayar, lalu klik Tes koneksi untuk memuat ulang.</p>
        {state.dirty ? <p className="text-sm">Simpan perubahan untuk memuat kanal.</p> : <>
          {channelError && !state.testChannels && <p role="alert" className="text-sm text-rose-600">{channelError}</p>}
          {(state.testChannels ?? channels).map((channel) => <div key={channel.code} className="flex justify-between gap-3 border-b border-ink-100 py-3 text-sm dark:border-ink-700"><span>{channel.name}</span><span className={channel.active ? 'text-emerald-600' : 'text-ink-400'}>{channel.active ? 'Aktif' : 'Nonaktif'}</span></div>)}
          {!form.hasApiKey && <p className="text-sm text-ink-500">Simpan API Key untuk melihat kanal pembayaran.</p>}
        </>}
      </div>
    </fieldset>
  </form>;
}

function PaymentGatewaySelector() {
  const [saved, setSaved] = useState<PaymentGateway | null>(null);
  const [provider, setProvider] = useState<PaymentGateway>('tripay');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getBackendClient()?.admin.getPaymentGateway().then((result) => {
      if (!active) return;
      if (!result.data || result.error) setError(result.error?.message || 'Pilihan pembayaran gagal dimuat.');
      else { setSaved(result.data.provider); setProvider(result.data.provider); }
    });
    return () => { active = false; };
  }, []);
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await getBackendClient()?.admin.setPaymentGateway(provider);
      if (!result?.data || result.error) throw new Error(result?.error?.message || 'Pilihan gagal disimpan.');
      setSaved(result.data.provider);
      toast.success('Layanan pembayaran checkout diperbarui.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Pilihan gagal disimpan.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-900">
    <label htmlFor="checkout-gateway" className="block text-sm font-semibold">Layanan pembayaran checkout</label>
    <p className="text-xs text-ink-500">Layanan utama dipakai untuk pesanan baru. Bila layanan utama gangguan, checkout otomatis memakai layanan lain yang aktif dengan urutan Tripay, Mayar, DOKU, termasuk untuk pesanan yang gagal dibayar di layanan utama. Pembayaran pesanan sebelumnya tetap mengikuti layanan asal. Pembayaran manual tetap tersedia.</p>
    <div className="flex flex-wrap gap-3">
      <select id="checkout-gateway" className="input w-full sm:w-64" value={provider} disabled={busy || !saved} onChange={(event) => setProvider(event.target.value as PaymentGateway)}>
        <option value="tripay">Tripay</option><option value="mayar">Mayar</option><option value="doku">DOKU</option><option value="manual">Pembayaran manual saja</option>
      </select>
      <Button type="button" disabled={busy || !saved || provider === saved} onClick={() => void save()}>{busy ? 'Memeriksa koneksi...' : 'Gunakan layanan ini'}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
  </div>;
}

const INTEGRATION_TABS = [
  { id: 'tripay', label: 'Tripay', category: 'Pembayaran', icon: CreditCard, description: 'Kelola koneksi pembayaran dan kanal yang tersedia di checkout customer.' },
  { id: 'mayar', label: 'Mayar', category: 'Pembayaran', icon: CreditCard, description: 'Hubungkan Mayar dan kelola pembayaran melalui halaman checkout Mayar.' },
  { id: 'doku', label: 'DOKU', category: 'Pembayaran', icon: CreditCard, description: 'Hubungkan DOKU Checkout sebagai layanan pembayaran utama atau cadangan.' },
  { id: 'kiriminaja', label: 'KiriminAja', category: 'Pengiriman', icon: Truck, description: 'Atur koneksi layanan pengiriman dan wilayah asal gudang toko.' },
  { id: 'onesender', label: 'OneSender', category: 'WhatsApp', icon: MessageCircle, description: 'Hubungkan perangkat untuk mengirim rincian order dan follow-up customer.' },
  { id: 'meta_whatsapp', label: 'WhatsApp Meta', category: 'WhatsApp resmi', icon: MessagesSquare, description: 'Hubungkan WhatsApp Business Platform menggunakan akun dan nomor pengirim Meta.' },
  { id: 'email', label: 'Email', category: 'Email otomatis', icon: Mail, description: 'Kelola pengirim Mailketing atau SMTP dan template email toko.' },
] as const;
type IntegrationTab = typeof INTEGRATION_TABS[number]['id'];

export function IntegrationsPanel() {
  const [activeTab, setActiveTab] = useState<IntegrationTab>('tripay');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [data, setData] = useState<IntegrationSettings | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    async function load() {
      try {
        const api = getBackendClient();
        if (!api) throw new Error('Koneksi server belum tersedia.');
        const result = await api.admin.getIntegrations();
        if (result.error || !result.data) throw new Error(result.error?.message || 'Pengaturan gagal dimuat.');
        if (active) setData(result.data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Pengaturan gagal dimuat.');
      }
    }
    void load();
    return () => { active = false; };
  }, [attempt]);
  if (error) return <div role="alert" className="space-y-3"><p className="text-sm text-red-500">{error}</p><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Coba lagi</Button></div>;
  if (!data) return <p role="status" className="text-sm text-ink-500">Memuat pengaturan integrasi...</p>;
  return <div className="min-w-0 space-y-5">
    <div className="flex items-start gap-2 text-xs leading-relaxed text-ink-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>Kredensial tersimpan terenkripsi. Pilih layanan untuk mengatur koneksi dan menyimpan perubahannya.</p></div>
    <PaymentGatewaySelector />
    <div role="tablist" aria-label="Layanan integrasi" className="flex gap-1 overflow-x-auto rounded-xl border border-ink-200 bg-ink-50 p-1.5 dark:border-ink-700 dark:bg-ink-900">
      {INTEGRATION_TABS.map((tab, index) => <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }}
        type="button" role="tab" id={`integration-tab-${tab.id}`} aria-controls={`integration-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
        onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % INTEGRATION_TABS.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + INTEGRATION_TABS.length) % INTEGRATION_TABS.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = INTEGRATION_TABS.length - 1;
          else return;
          event.preventDefault(); setActiveTab(INTEGRATION_TABS[next].id);
          tabRefs.current[next]?.focus({ preventScroll: true });
          tabRefs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
        className={cn('flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:flex-1', activeTab === tab.id ? 'bg-white text-brand-700 shadow-sm ring-1 ring-ink-200 dark:bg-ink-800 dark:text-brand-300 dark:ring-ink-700' : 'text-ink-500 hover:bg-white/70 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100')}>
        <tab.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{tab.label}
      </button>)}
    </div>
    {INTEGRATION_TABS.map((tab) => <div key={tab.id} role="tabpanel" id={`integration-panel-${tab.id}`} aria-labelledby={`integration-tab-${tab.id}`} hidden={activeTab !== tab.id} tabIndex={0} className="min-w-0 rounded-2xl border border-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-700">
      <div className="flex items-start gap-3 border-b border-ink-100 p-4 sm:p-5 dark:border-ink-700">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300"><tab.icon size={22} aria-hidden="true" /></div>
        <div className="min-w-0"><p className="mb-0.5 text-xs font-medium text-ink-500">{tab.category}</p><h3 className="text-base font-semibold">{tab.label}</h3><p className="mt-1 text-sm leading-relaxed text-ink-500">{tab.description}</p></div>
      </div>
      <div className="p-4 sm:p-5">
        {tab.id === 'tripay' && <TripayForm initial={data.tripay} />}
        {tab.id === 'mayar' && <MayarForm initial={data.mayar} />}
        {tab.id === 'doku' && <DokuForm initial={data.doku} />}
        {tab.id === 'kiriminaja' && <KiriminAjaForm initial={data.kiriminaja} />}
        {tab.id === 'onesender' && <OneSenderForm initial={data.onesender} />}
        {tab.id === 'meta_whatsapp' && <MetaWhatsAppForm initial={data.meta_whatsapp} />}
        {tab.id === 'email' && <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-ink-50 p-4 dark:bg-ink-900"><h4 className="text-sm font-semibold">Pengaturan pengirim</h4><p className="mt-2 text-sm leading-relaxed text-ink-500">Pilih Mailketing atau SMTP, atur nama dan email pengirim, lalu uji koneksinya.</p></div>
            <div className="rounded-xl bg-ink-50 p-4 dark:bg-ink-900"><h4 className="text-sm font-semibold">Template email</h4><p className="mt-2 text-sm leading-relaxed text-ink-500">Sesuaikan rincian order customer, notifikasi admin, dan reset kata sandi dengan editor dan pratinjau.</p></div>
          </div>
          <Link to="/email-templates" className="btn-primary inline-flex items-center gap-2">Buka pengaturan email <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>}
      </div>
    </div>)}
  </div>;
}
