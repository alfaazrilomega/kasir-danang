import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getBackendClient, type IntegrationSettings, type TripaySettings, type KiriminAjaSettings, type OneSenderSettings, type MetaWhatsAppSettings } from '@/lib/api';
import { loadConfig } from '@/lib/config';

type Provider = keyof IntegrationSettings;

function useIntegration<P extends Provider>(provider: P, initial: IntegrationSettings[P]) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  function change(patch: Partial<IntegrationSettings[P]>) {
    setForm((current) => ({ ...current, ...patch }));
    setTestMessage('');
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
      toast.success('Pengaturan integrasi tersimpan.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Pengaturan gagal disimpan.');
    } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    setTestMessage('');
    try {
      const api = getBackendClient();
      if (!api) throw new Error('Koneksi server belum tersedia.');
      const { data, error } = await api.admin.testIntegration(provider);
      if (error || !data) throw new Error(error?.message || 'Tes koneksi gagal.');
      setTestMessage(data.message);
      toast.success(data.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tes koneksi gagal.';
      setTestMessage(message);
      toast.error(message);
    } finally { setBusy(false); }
  }
  return { form, change, busy, dirty, testMessage, save, test };
}

function ModeFields({ provider, enabled, mode, onChange }: {
  provider: 'tripay' | 'kiriminaja'; enabled: boolean; mode: 'sandbox' | 'production';
  onChange: (patch: { enabled?: boolean; mode?: 'sandbox' | 'production' }) => void;
}) {
  return <>
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      Aktifkan {provider === 'tripay' ? 'Tripay' : 'KiriminAja'}
    </label>
    <div className="space-y-1.5">
      <label htmlFor={`${provider}-mode`} className="block text-sm font-medium">Mode</label>
      <select id={`${provider}-mode`} className="input" value={mode} onChange={(event) => onChange({ mode: event.target.value as 'sandbox' | 'production' })}>
        <option value="sandbox">Sandbox (uji coba)</option>
        <option value="production">Production (transaksi nyata)</option>
      </select>
      <p className="text-xs text-ink-500">Gunakan kunci sesuai mode. Isi ulang kunci API saat mengganti mode.</p>
    </div>
  </>;
}

function FormActions({ busy, dirty, testMessage, canTest, test, hint }: {
  busy: boolean; dirty: boolean; testMessage: string; canTest: boolean; test: () => Promise<void>; hint?: string;
}) {
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy || !dirty}>{busy ? 'Memproses...' : 'Simpan integrasi'}</Button>
      <Button type="button" variant="secondary" disabled={busy || dirty || !canTest} onClick={() => void test()}>Tes koneksi</Button>
    </div>
    <p className="text-xs text-ink-500">{hint || 'Simpan perubahan sebelum tes koneksi. Tes hanya memeriksa akses API, tanpa membuat transaksi.'}</p>
    {testMessage && <p role="status" className="text-sm">{testMessage}</p>}
  </div>;
}

function secretHint(saved: boolean) {
  return saved ? 'Kunci sudah tersimpan. Kosongkan untuk mempertahankannya.' : 'Kunci belum diisi.';
}

function TripayForm({ initial }: { initial: TripaySettings }) {
  const state = useIntegration('tripay', initial);
  const { form, change } = state;
  const callbackExample = `${(loadConfig().apiBaseUrl || window.location.origin).replace(/\/$/, '')}/api/tripay/callback`;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
    <fieldset disabled={state.busy} className="space-y-4">
      <legend className="mb-3 text-base font-semibold">Tripay</legend>
      <ModeFields provider="tripay" enabled={form.enabled} mode={form.mode} onChange={change} />
      <Input id="tripay-merchant" label="Merchant Code" value={form.merchantCode} onChange={(event) => change({ merchantCode: event.target.value })} required={form.enabled} autoComplete="off" />
      <Input id="tripay-api-key" label="API Key" type="password" value={form.apiKey ?? ''} onChange={(event) => change({ apiKey: event.target.value })} hint={secretHint(form.hasApiKey)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasApiKey} />
      <Input id="tripay-private-key" label="Private Key" type="password" value={form.privateKey ?? ''} onChange={(event) => change({ privateKey: event.target.value })} hint={secretHint(form.hasPrivateKey)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasPrivateKey} />
      <Input id="tripay-callback" label="URL Callback" type="url" placeholder={callbackExample} value={form.callbackUrl} onChange={(event) => change({ callbackUrl: event.target.value })} hint="Isi URL HTTPS API toko yang dapat diakses Tripay. Jika kosong, gunakan URL callback yang sudah diatur di dashboard Tripay." />
      <p className="break-all text-xs text-ink-500">Endpoint callback toko: {callbackExample}</p>
      <Input id="tripay-return" label="URL Kembali (opsional)" type="url" value={form.returnUrl} onChange={(event) => change({ returnUrl: event.target.value })} hint="Halaman HTTPS untuk pelanggan setelah pembayaran." />
      <a href="https://tripay.co.id/developer?tab=callback" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi Tripay</a>
      <FormActions {...state} canTest={form.hasApiKey} />
      <p className="text-xs text-ink-500">Tes koneksi memeriksa API Key. Merchant Code, Private Key, dan callback perlu diverifikasi melalui transaksi sandbox.</p>
    </fieldset>
  </form>;
}

function KiriminAjaForm({ initial }: { initial: KiriminAjaSettings }) {
  const state = useIntegration('kiriminaja', initial);
  const { form, change } = state;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
    <fieldset disabled={state.busy} className="space-y-4">
      <legend className="mb-3 text-base font-semibold">KiriminAja</legend>
      <ModeFields provider="kiriminaja" enabled={form.enabled} mode={form.mode} onChange={change} />
      <Input id="kiriminaja-token" label="API Key / Bearer Token" type="password" value={form.token ?? ''} onChange={(event) => change({ token: event.target.value })} hint={secretHint(form.hasToken)} autoComplete="new-password" spellCheck={false} required={form.enabled && !form.hasToken} />
      <Input id="kiriminaja-district" label="ID Kecamatan Asal" inputMode="numeric" pattern="[1-9][0-9]*" value={form.originDistrict} onChange={(event) => change({ originDistrict: event.target.value })} required={form.enabled} hint="ID kecamatan gudang dari data wilayah KiriminAja." />
      <Input id="kiriminaja-subdistrict" label="ID Kelurahan Asal" inputMode="numeric" pattern="[1-9][0-9]*" value={form.originSubdistrict} onChange={(event) => change({ originSubdistrict: event.target.value })} required={form.enabled} hint="ID kelurahan gudang dari data wilayah KiriminAja, bukan kode pos." />
      <a href="https://developer.kiriminaja.com/docs" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi KiriminAja</a>
      <FormActions {...state} canTest={form.hasToken} />
    </fieldset>
  </form>;
}

function OneSenderForm({ initial }: { initial: OneSenderSettings }) {
  const state = useIntegration('onesender', initial);
  const { form, change } = state;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
    <fieldset disabled={state.busy} className="space-y-4">
      <legend className="mb-3 text-base font-semibold">OneSender</legend>
      <Input id="onesender-phone" label="Phone number" type="tel" value={form.phoneNumber} onChange={(event) => change({ phoneNumber: event.target.value })} placeholder="6281234567890" maxLength={30} required hint="Nomor perangkat pengirim yang terdaftar di OneSender, dengan kode negara. Nomor 08 akan diubah menjadi 628." />
      <Input id="onesender-api-url" label="API URL" type="url" value={form.apiUrl} onChange={(event) => change({ apiUrl: event.target.value })} placeholder="http://server-anda:3001/api/v1/messages" required autoComplete="off" spellCheck={false} hint="Salin API URL lengkap dari Device info OneSender. HTTP dan HTTPS didukung. Isi ulang API Key jika URL diganti." />
      <Input id="onesender-api-key" label="API Key" type="password" value={form.apiKey ?? ''} onChange={(event) => change({ apiKey: event.target.value })} hint={secretHint(form.hasApiKey)} autoComplete="new-password" spellCheck={false} required={!form.hasApiKey} />
      <a href="https://documenter.getpostman.com/view/11282121/Uyr8md8U" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi OneSender</a>
      <FormActions {...state} canTest={form.hasApiKey && !!form.apiUrl && !!form.phoneNumber} hint="Simpan perubahan sebelum tes koneksi. Tes memeriksa akses API tanpa mengirim pesan WhatsApp." />
      <p className="text-xs text-ink-500">Hubungkan nomor perangkat melalui Scan QR Code di dashboard OneSender. Tes API tidak memastikan perangkat WhatsApp sedang online.</p>
    </fieldset>
  </form>;
}

function MetaWhatsAppForm({ initial }: { initial: MetaWhatsAppSettings }) {
  const state = useIntegration('meta_whatsapp', initial);
  const { form, change } = state;
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} className="rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
    <fieldset disabled={state.busy} className="space-y-4">
      <legend className="mb-3 text-base font-semibold">WhatsApp Cloud API (Meta)</legend>
      <p className="text-sm text-ink-500">Masukkan kredensial WhatsApp Business Platform dari dashboard aplikasi Meta.</p>
      <Input id="meta-wa-waba" label="WhatsApp Business Account ID (WABA)" value={form.wabaId} onChange={(event) => change({ wabaId: event.target.value })} inputMode="numeric" pattern="[1-9][0-9]{0,29}" maxLength={30} required hint="ID akun WhatsApp Business, bukan Business Portfolio ID." />
      <Input id="meta-wa-phone-id" label="Phone Number ID" value={form.phoneNumberId} onChange={(event) => change({ phoneNumberId: event.target.value })} inputMode="numeric" pattern="[1-9][0-9]{0,29}" maxLength={30} required hint="ID nomor dari menu WhatsApp > API Setup di Meta, bukan nomor telepon 628...." />
      <Input id="meta-wa-token" label="Access Token" type="password" value={form.accessToken ?? ''} onChange={(event) => change({ accessToken: event.target.value })} required={!form.hasAccessToken} autoComplete="new-password" spellCheck={false} hint={form.hasAccessToken ? 'Token sudah tersimpan. Kosongkan untuk mempertahankannya.' : 'Tempel token tanpa awalan Bearer. Tes akses akun memerlukan izin whatsapp_business_management.'} />
      <Input id="meta-wa-version" label="Versi Graph API" value={form.apiVersion} onChange={(event) => change({ apiVersion: event.target.value })} placeholder="vNN.0" pattern="v[1-9][0-9]{0,2}\.0" required hint="Salin versi yang digunakan pada contoh request di dashboard Meta." />
      <p className="break-all text-xs text-ink-500">Server API: https://graph.facebook.com</p>
      <a href="https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api" target="_blank" rel="noreferrer" className="inline-block text-sm text-brand-600 underline">Dokumentasi resmi Meta</a>
      <FormActions {...state} canTest={form.hasAccessToken && !!form.wabaId && !!form.phoneNumberId && !!form.apiVersion} hint="Simpan perubahan sebelum tes koneksi. Tes memeriksa akses token dan nomor pada WABA, tanpa mengirim pesan WhatsApp." />
      <p className="text-xs text-ink-500">Pengaturan ini menyimpan koneksi API. Pengiriman pesan dan penerimaan webhook belum diaktifkan melalui form ini.</p>
    </fieldset>
  </form>;
}

export function IntegrationsPanel() {
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
  return <div className="space-y-4">
    <p className="text-sm text-ink-500">Kunci disimpan terenkripsi di server. Masing-masing integrasi memiliki tombol simpan sendiri dan memerlukan koneksi internet.</p>
    <div className="grid items-start gap-4 lg:grid-cols-2"><TripayForm initial={data.tripay} /><KiriminAjaForm initial={data.kiriminaja} /><OneSenderForm initial={data.onesender} /><MetaWhatsAppForm initial={data.meta_whatsapp} /></div>
  </div>;
}
