import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { waApi, WA_LABELS, WA_STATUS, type WAMessage, type WAOrder, type WATemplateKey } from '@/lib/whatsapp';
import { formatMoney } from '@/lib/format';

export function WhatsAppFollowup({ customerId, customerName, templateKey, initialOrderId, onClose, onSent }: {
  customerId: string; customerName: string; templateKey: WATemplateKey; initialOrderId?: string;
  onClose: () => void; onSent?: () => void;
}) {
  const [orders, setOrders] = useState<WAOrder[]>([]);
  const [orderId, setOrderId] = useState(initialOrderId || '');
  const [preview, setPreview] = useState<WAMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void waApi.orders(customerId).then((rows) => { if (alive) setOrders(rows); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [customerId]);
  async function prepare() {
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await waApi.preview(customerId, templateKey, orderId || undefined)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Pratinjau gagal dimuat.'); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!preview || preview.status !== 'draft' || busy) return;
    setBusy(true); setError('');
    try {
      const result = await waApi.send(preview.id);
      setPreview(result); onSent?.();
      toast.success('Pesan diterima API WhatsApp.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pengiriman gagal.');
      // ID yang sama tetap dipakai bila respons browser terputus. Server mencegah pengiriman ganda.
      onSent?.();
    } finally { setBusy(false); }
  }
  return <Modal open title={`${WA_LABELS[templateKey]} · ${customerName}`} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="wa-followup-order" className="text-sm font-medium">Pesanan untuk follow-up</label>
        <select id="wa-followup-order" className="input" value={orderId} disabled={busy || preview?.status === 'accepted'} onChange={(e) => { setOrderId(e.target.value); setPreview(null); setError(''); }}>
          <option value="">Pesanan terbaru (atau data customer jika belum ada)</option>
          {orders.map((order) => <option key={order.id} value={order.id}>{order.order_number} · {formatMoney(order.total)}</option>)}
        </select>
      </div>
      <Button variant="secondary" disabled={busy || preview?.status === 'accepted'} onClick={() => void prepare()}>{busy && !preview ? 'Menyiapkan...' : 'Pratinjau pesan'}</Button>
      {preview && <div className="space-y-2">
        <p className="text-sm">Ke <strong>{preview.recipient}</strong> melalui <strong>{preview.provider === 'onesender' ? 'OneSender' : 'WhatsApp resmi Meta'}</strong></p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-50 p-4 font-sans text-sm dark:bg-ink-800">{preview.message_text}</pre>
        <p role="status" className="text-sm font-medium">{WA_STATUS[preview.status]}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <p className="text-xs text-ink-500">Diterima API berarti pesan masuk antrean pengiriman. Status sampai/dibaca perlu diperiksa pada penyedia. Jika respons tidak pasti, periksa antrean sebelum membuat pesan baru.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onClose}>Tutup</Button>
        <Button disabled={busy || !preview || preview.status !== 'draft'} onClick={() => void send()}>{busy && preview ? 'Mengirim...' : 'Kirim WhatsApp'}</Button>
      </div>
    </div>
  </Modal>;
}
