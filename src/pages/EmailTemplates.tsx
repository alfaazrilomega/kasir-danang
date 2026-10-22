import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmailEditor } from '@/components/email/EmailEditor';
import { emailApi, EMAIL_LABELS, type EmailSettings, type EmailTemplateKey, type EmailPreview } from '@/lib/emailSettings';
import { Link } from '@/lib/router';

export function EmailTemplates() {
  const [form, setForm] = useState<EmailSettings | null>(null);
  const [saved, setSaved] = useState('');
  const [variables, setVariables] = useState<Record<EmailTemplateKey, string[]>>({ order_customer: [], order_admin: [], password_reset: [] });
  const [key, setKey] = useState<EmailTemplateKey>('order_customer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  async function load() {
    setError('');
    try { const data = await emailApi.load(); const next = { config: data.config, templates: data.templates }; setForm(next); setSaved(JSON.stringify(next)); setVariables(data.variables); }
    catch (e) { setError(e instanceof Error ? e.message : 'Pengaturan email gagal dimuat.'); }
  }
  useEffect(() => { void load(); }, []);
  async function action(kind: 'save' | 'test' | 'preview') {
    if (!form) return;
    setBusy(true); setError(''); setTestMessage('');
    try {
      if (kind === 'save') { const result = await emailApi.save(form); setForm(result); setSaved(JSON.stringify(result)); setPreview(null); toast.success('Pengaturan dan template email disimpan.'); }
      else if (kind === 'test') setTestMessage((await emailApi.test()).message);
      else setPreview(await emailApi.preview(key, form.templates));
    } catch (e) { setError(e instanceof Error ? e.message : 'Permintaan gagal.'); }
    finally { setBusy(false); }
  }
  if (!form) return <Card className="space-y-3 p-5">{error ? <><p role="alert">{error}</p><Button onClick={() => void load()}>Coba lagi</Button></> : <p role="status">Memuat pengaturan email...</p>}</Card>;
  const config = form.config;
  const template = form.templates[key];
  const dirty = JSON.stringify(form) !== saved;
  const changeConfig = (patch: Partial<typeof config>) => { setForm({ ...form, config: { ...config, ...patch } }); setTestMessage(''); setError(''); };
  const changeTemplate = (patch: Partial<typeof template>) => { setForm({ ...form, templates: { ...form.templates, [key]: { ...template, ...patch } } }); setPreview(null); setError(''); };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold">Email & Template</h1><p className="text-sm text-ink-500">Atur pengirim dan isi email otomatis untuk toko ini.</p></div><Link to="/settings#integrations" className="text-sm font-semibold text-brand-600 underline">Kembali ke Integrasi API</Link></div>
    <Card className="space-y-4 p-5"><h2 className="font-semibold">Pengaturan pengiriman email</h2>
      <div className="space-y-1"><label htmlFor="email-provider" className="text-sm font-medium">Layanan email</label><select id="email-provider" className="input" disabled={busy} value={config.provider} onChange={(e) => changeConfig({ provider: e.target.value as typeof config.provider })}><option value="server">Pengaturan server yang sudah ada</option><option value="mailketing">Mailketing API</option><option value="smtp">SMTP</option></select></div>
      {config.provider === 'server' ? <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600 dark:bg-ink-900 dark:text-ink-300">Pengiriman mengikuti konfigurasi email di server. Pilih Mailketing atau SMTP agar admin dapat mengganti kredensial melalui aplikasi. Template di bawah tetap digunakan.</p> : <>
        <div className="grid gap-4 sm:grid-cols-2"><Input id="email-from-name" label="Nama pengirim" disabled={busy} value={config.fromName} onChange={(e) => changeConfig({ fromName: e.target.value })} maxLength={254} /><Input id="email-from-address" label="Email pengirim" type="email" disabled={busy} value={config.fromEmail} onChange={(e) => changeConfig({ fromEmail: e.target.value })} maxLength={254} placeholder="notifikasi@domain-toko.id" /></div>
        {config.provider === 'mailketing' ? <><Input id="email-api-token" label="API Token Mailketing" type="password" autoComplete="new-password" disabled={busy} value={config.apiToken || ''} onChange={(e) => changeConfig({ apiToken: e.target.value })} hint={config.hasApiToken ? 'Token tersimpan terenkripsi. Kosongkan untuk mempertahankannya.' : 'Salin token dari menu API Integration Mailketing, bukan password login akun.'} /><p className="text-xs text-ink-500">Gunakan domain pengirim yang sudah diverifikasi di Mailketing. <a href="https://api.mailketing.co.id/docs/" target="_blank" rel="noreferrer" className="text-brand-600 underline">Dokumentasi Mailketing</a></p></> : <>
          <div className="grid gap-4 sm:grid-cols-2"><Input id="email-smtp-host" label="Host SMTP" disabled={busy} value={config.smtpHost} onChange={(e) => changeConfig({ smtpHost: e.target.value })} placeholder="smtp.penyedia.com" /><div className="space-y-1"><label htmlFor="email-smtp-port" className="text-sm font-medium">Port / keamanan</label><select id="email-smtp-port" className="input" disabled={busy} value={config.smtpPort} onChange={(e) => changeConfig({ smtpPort: Number(e.target.value) })}><option value={587}>587 · STARTTLS</option><option value={465}>465 · TLS</option><option value={2525}>2525 · STARTTLS</option></select></div><Input id="email-smtp-user" label="Username SMTP" autoComplete="off" disabled={busy} value={config.smtpUser} onChange={(e) => changeConfig({ smtpUser: e.target.value })} /><Input id="email-smtp-password" label="Password SMTP" type="password" autoComplete="new-password" disabled={busy} value={config.smtpPassword || ''} onChange={(e) => changeConfig({ smtpPassword: e.target.value })} hint={config.hasSmtpPassword ? 'Password tersimpan. Isi ulang jika mengganti host atau username.' : 'Gunakan password SMTP atau app password dari penyedia.'} /></div>
        </>}
      </>}
      <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.orderNotifyEmail === null} disabled={busy} onChange={(e) => changeConfig({ orderNotifyEmail: e.target.checked ? null : '' })} />Gunakan penerima notifikasi admin dari pengaturan server</label>{config.orderNotifyEmail !== null && <Input id="email-notify-admin" label="Email penerima notifikasi order admin" type="email" disabled={busy} value={config.orderNotifyEmail} onChange={(e) => changeConfig({ orderNotifyEmail: e.target.value })} hint="Kosongkan jika admin tidak perlu menerima notifikasi order lewat email." />}</div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={busy || dirty || config.provider === 'server'} onClick={() => void action('test')}>Tes koneksi email</Button><span className="text-xs text-ink-500">Simpan dahulu. Tes koneksi tidak mengirim email.</span></div>
      {testMessage && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{testMessage}</p>}
    </Card>
    <Card className="space-y-4 p-5"><div><h2 className="font-semibold">Template email</h2><p className="text-sm text-ink-500">Atur subjek dan isi pesan dengan editor Tiptap.</p></div>
      <div className="flex flex-wrap gap-2">{(Object.keys(EMAIL_LABELS) as EmailTemplateKey[]).map((value) => <Button key={value} variant={value === key ? 'primary' : 'secondary'} disabled={busy} aria-pressed={value === key} onClick={() => { setKey(value); setPreview(null); setError(''); }}>{EMAIL_LABELS[value]}</Button>)}</div>
      <Input id="email-subject" label="Subjek email" disabled={busy} maxLength={200} value={template.subject} onChange={(e) => changeTemplate({ subject: e.target.value })} hint="Variabel juga dapat diketik pada subjek, misalnya {nama_toko}." />
      <EmailEditor key={key} value={template.html} onChange={(html) => changeTemplate({ html })} variables={variables[key]} disabled={busy} />
      {key === 'password_reset' && <p className="text-xs text-ink-500">Pertahankan variabel {'{kode_reset}'} agar customer menerima kode verifikasi.</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !dirty} onClick={() => void action('save')}>{busy ? 'Memproses...' : 'Simpan pengaturan & template'}</Button><Button variant="secondary" disabled={busy} onClick={() => void action('preview')}>Pratinjau email</Button></div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {preview && <div className="space-y-3 rounded-xl border border-ink-200 p-3 dark:border-ink-700"><h3 className="text-sm font-semibold">Pratinjau dengan data contoh</h3><p className="break-words text-sm">Subjek: {preview.subject}</p><iframe title="Pratinjau email" sandbox="" srcDoc={preview.html.replace('<html>', '<html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"></head>')} className="h-96 w-full rounded-lg border-0 bg-white" /></div>}
    </Card>
  </div>;
}
