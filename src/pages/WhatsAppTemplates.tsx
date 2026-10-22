import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Link } from '@/lib/router';
import { formatDateTime } from '@/lib/format';
import { waApi, WA_LABELS, WA_STATUS, REMINDER_STATUS, type WASettings, type WATemplateKey, type WAMessage, type WAReminder } from '@/lib/whatsapp';
import { WhatsAppFollowup } from '@/components/customers/WhatsAppFollowup';

const SAMPLE: Record<string, string> = { nama_customer: 'Budi', nama_toko: 'Toko Anda', nomor_order: 'WEB-CONTOH', rincian_order: '1. Gear Set — 2 x Rp 100.000 = Rp 200.000', total: 'Rp 200.000', ongkir: 'Dikonfirmasi terpisah oleh toko', metode_pembayaran: 'BRIVA', status_pembayaran: 'Belum lunas', alamat: 'Jl. Contoh No. 1, Banyumas', link_pembayaran: 'https://toko.example/toko/akun?tab=pesanan', telepon_customer: '6281234567890' };
export function WhatsAppTemplates() {
  const [form, setForm] = useState<WASettings | null>(null);
  const [saved, setSaved] = useState('');
  const [variables, setVariables] = useState<string[]>([]);
  const [key, setKey] = useState<WATemplateKey>('order_new');
  const [history, setHistory] = useState<WAMessage[]>([]);
  const [retry, setRetry] = useState<WAMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [reminders, setReminders] = useState<WAReminder[]>([]);
  const [reminderError, setReminderError] = useState('');
  async function load() {
    setError('');
    try { const data = await waApi.settings(); setForm(data.settings); setSaved(JSON.stringify(data.settings)); setVariables(data.variables); }
    catch (e) { setError(e instanceof Error ? e.message : 'Pengaturan gagal dimuat.'); }
  }
  async function loadHistory() {
    try { setHistory(await waApi.history()); setHistoryError(''); }
    catch (e) { setHistoryError(e instanceof Error ? e.message : 'Riwayat gagal dimuat.'); }
  }
  async function loadReminders() {
    try { setReminders(await waApi.reminders()); setReminderError(''); }
    catch (e) { setReminderError(e instanceof Error ? e.message : 'Jadwal reminder gagal dimuat.'); }
  }
  useEffect(() => { void load(); void loadHistory(); void loadReminders(); }, []);
  async function save() {
    if (!form) return;
    setBusy(true); setError('');
    try { const data = await waApi.save(form); setForm(data); setSaved(JSON.stringify(data)); void loadReminders(); toast.success('Template dan pengiriman WhatsApp disimpan.'); }
    catch (e) { const message = e instanceof Error ? e.message : 'Gagal menyimpan template.'; setError(message); toast.error(message); }
    finally { setBusy(false); }
  }
  if (!form) return <Card className="space-y-3 p-5">{error ? <><p role="alert">{error}</p><Button onClick={() => void load()}>Coba lagi</Button></> : <p role="status">Memuat template WhatsApp...</p>}</Card>;
  const template = form.templates[key];
  const changeTemplate = (patch: Partial<typeof template>) => setForm({ ...form, templates: { ...form.templates, [key]: { ...template, ...patch } } });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold">Template WA</h1><p className="text-sm text-ink-500">Notifikasi rincian order dan follow-up customer.</p></div><Link to="/settings#integrations" className="text-sm font-semibold text-brand-600 underline">Pengaturan koneksi API</Link></div>
    <Card className="space-y-4 p-5">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Kirim rincian order website otomatis ke customer</label>
      <div className="space-y-1"><label htmlFor="wa-provider" className="text-sm font-medium">Layanan pengirim</label><select id="wa-provider" className="input" disabled={busy} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as WASettings['provider'] })}><option value="onesender">OneSender</option><option value="meta_whatsapp">WhatsApp resmi Meta</option></select></div>
      <p className="text-xs text-ink-500">Satu layanan dipakai untuk notifikasi dan follow-up. Tidak berpindah otomatis saat gagal agar pesan tidak terkirim ganda.</p>
    </Card>
    <Card className="space-y-4 p-5">
      <div><h2 className="font-semibold">Reminder pembayaran otomatis</h2><p className="mt-1 text-sm text-ink-500">WA 1, WA 2, dan WA 3 untuk pesanan website yang belum dibayar.</p></div>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.reminders.enabled} disabled={busy} onChange={(e) => setForm({ ...form, reminders: { ...form.reminders, enabled: e.target.checked } })} />Aktifkan reminder pembayaran otomatis</label>
      <div className="grid gap-3 sm:grid-cols-3">{(['wa1', 'wa2', 'wa3'] as const).map((stage, index) => <Input key={stage} id={`reminder-${stage}`} label={`${WA_LABELS[stage]} — menit setelah order`} type="number" min={5} max={4320} step={1} value={form.reminders.minutes[index]} disabled={busy || !form.reminders.enabled} onChange={(e) => setForm({ ...form, reminders: { ...form.reminders, minutes: form.reminders.minutes.map((value, i) => i === index ? Number(e.target.value) : value) } })} />)}</div>
      <p className="text-xs text-ink-500">Dihitung sejak order dibuat, bukan dari pesan sebelumnya. Urutkan dengan selisih minimal 10 menit, maksimal 3 hari. Sistem memeriksa jadwal setiap menit.</p>
      <div className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">Berlaku untuk order baru setelah disimpan. COD dilewati. Reminder berhenti jika pembayaran sudah tercatat, pesanan dibatalkan, atau transaksi Tripay kedaluwarsa. Untuk transfer manual, admin perlu mencatat pembayaran di aplikasi.</div>
      <p className="text-xs text-ink-500">Jadwal order yang sudah masuk tetap memakai waktu awal. Mematikan opsi membatalkan seluruh reminder yang belum dikirim. Jadwal yang terlewat lebih dari 5 menit dilewati agar pesan tidak terkirim sekaligus. Isi pesan memakai template WA 1 / WA 2 / WA 3 di bawah.</p>
      <Button disabled={busy || JSON.stringify(form) === saved} onClick={() => void save()}>{busy ? 'Menyimpan...' : 'Simpan pengaturan WA'}</Button>
    </Card>
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap gap-2">{(Object.keys(WA_LABELS) as WATemplateKey[]).map((value) => <Button key={value} variant={value === key ? 'primary' : 'secondary'} onClick={() => setKey(value)} aria-pressed={value === key}>{WA_LABELS[value]}</Button>)}</div>
      <p className="text-sm text-ink-500">{key === 'order_new' ? 'Dikirim setelah order website tersimpan.' : `${WA_LABELS[key]} digunakan untuk reminder otomatis jika diaktifkan, dan dapat dikirim manual dari halaman Customers.`}</p>
      {form.provider === 'onesender' ? <div className="grid gap-4 lg:grid-cols-2">
        <TextArea id="wa-template-text" label="Isi template OneSender" rows={13} maxLength={3000} disabled={busy} value={template.text} onChange={(e) => changeTemplate({ text: e.target.value })} />
        <div><h2 className="mb-2 text-sm font-medium">Contoh hasil pesan</h2><pre className="whitespace-pre-wrap break-words rounded-xl bg-ink-50 p-4 font-sans text-sm dark:bg-ink-800">{template.text.replace(/{([^{}]+)}/g, (match, name) => SAMPLE[name] ?? match)}</pre></div>
      </div> : <div className="space-y-4">
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-950 dark:text-brand-200">Gunakan template teks yang sudah APPROVED di WhatsApp Manager. Isi pesan mengikuti template Meta, dengan parameter pada BODY. Template dengan media atau tombol belum didukung.</p>
        <div className="grid gap-4 sm:grid-cols-2"><Input id="wa-meta-name" label="Nama template Meta" value={template.metaName} disabled={busy} onChange={(e) => changeTemplate({ metaName: e.target.value })} placeholder="rincian_order" /><Input id="wa-meta-language" label="Kode bahasa" value={template.metaLanguage} disabled={busy} onChange={(e) => changeTemplate({ metaLanguage: e.target.value })} placeholder="id" /></div>
        <TextArea id="wa-meta-parameters" label="Parameter BODY, satu nilai per baris sesuai urutan variabel Meta" rows={7} disabled={busy} value={template.metaParameters.join('\n')} onChange={(e) => changeTemplate({ metaParameters: e.target.value ? e.target.value.split('\n') : [] })} placeholder={'{nama_customer}\n{nomor_order}\n{rincian_order}\n{total}'} />
        <p className="text-xs text-ink-500">Pratinjau follow-up mengambil teks template langsung dari Meta dan memeriksa jumlah parameter. Baris baru dalam rincian barang disesuaikan menjadi pemisah untuk parameter Meta.</p>
      </div>}
      <div className="space-y-2"><h2 className="text-sm font-medium">Variabel tersedia</h2><div className="flex flex-wrap gap-2">{variables.map((value) => <code key={value} className="rounded bg-ink-100 px-2 py-1 text-xs dark:bg-ink-800">{'{' + value + '}'}</code>)}</div></div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <Button disabled={busy || JSON.stringify(form) === saved} onClick={() => void save()}>{busy ? 'Menyimpan...' : 'Simpan template WA'}</Button>
    </Card>
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Riwayat pengiriman terakhir</h2><Button variant="secondary" onClick={() => void loadHistory()}>Muat ulang</Button></div>
      <p className="text-xs text-ink-500">Diterima API belum berarti sampai/dibaca customer. Jika status belum pasti atau sedang diproses terlalu lama, periksa antrean OneSender/Meta sebelum mengirim ulang.</p>
      {historyError && <p role="alert" className="text-sm text-rose-600">{historyError}</p>}
      {!history.length && !historyError && <p className="text-sm text-ink-500">Belum ada pengiriman WhatsApp.</p>}
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">{history.map((row) => <li key={row.id} className="space-y-2 py-3">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{WA_LABELS[row.template_key]} · {row.recipient || 'Nomor belum tersedia'}</span><span className={row.status === 'accepted' ? 'text-emerald-600' : 'text-amber-700'}>{WA_STATUS[row.status]}</span></div>
        <p className="break-all text-xs text-ink-500">{row.provider === 'onesender' ? 'OneSender' : 'Meta'} · {formatDateTime(row.created_at)}{row.provider_message_id ? ` · ID ${row.provider_message_id}` : ''}</p>
        {row.error_message && <p className="text-sm text-rose-600">{row.error_message}</p>}
        {row.message_text && <details><summary className="cursor-pointer text-sm text-brand-600">Lihat pesan</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{row.message_text}</pre></details>}
        {row.status === 'failed' && row.customer_id && <Button variant="secondary" onClick={() => setRetry(row)}>Siapkan ulang</Button>}
      </li>)}</ul>
    </Card>
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Jadwal & riwayat reminder</h2><Button variant="secondary" onClick={() => void loadReminders()}>Muat ulang jadwal</Button></div>
      {reminderError && <p role="alert" className="text-sm text-rose-600">{reminderError}</p>}
      {!reminders.length && !reminderError && <p className="text-sm text-ink-500">Belum ada reminder terjadwal. Aktifkan opsi, simpan, lalu jadwal dibuat untuk order baru selain COD.</p>}
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">{reminders.map((row) => <li key={row.id} className="space-y-1 py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{row.order_number} · {WA_LABELS[row.template_key]}</span><span>{REMINDER_STATUS[row.status]}</span></div>
        <p className="text-xs text-ink-500">{formatDateTime(row.scheduled_at)}</p>
        {row.reason && <p className="text-xs text-ink-500">{row.reason}</p>}
      </li>)}</ul>
    </Card>
    {retry?.customer_id && <WhatsAppFollowup customerId={retry.customer_id} customerName={retry.recipient || 'Customer'} templateKey={retry.template_key} initialOrderId={retry.order_id || undefined} onClose={() => setRetry(null)} onSent={() => void loadHistory()} />}
  </div>;
}
