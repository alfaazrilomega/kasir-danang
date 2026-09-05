import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/stores/auth';
import { cn, formatDateTime, formatMoney } from '@/lib/format';
import {
  buildReceiptText,
  mailtoLink,
  printInvoice,
  printReceipt,
  whatsappLink,
} from '@/lib/receipt';
import { sendDigitalReceipt, type NotificationChannel } from '@/lib/notifications';
import type { Customer, Order, OrderItem } from '@/types';

interface ReceiptData {
  order: Order;
  items: OrderItem[];
  customer: Customer | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Kartu',
  qris: 'QRIS',
  ewallet: 'E-wallet',
};

export function ReceiptModal({
  data,
  onClose,
}: {
  data: ReceiptData | null;
  onClose: () => void;
}) {
  const { store } = useAuth();
  const [waPhone, setWaPhone] = useState('');
  const [emailAddr, setEmailAddr] = useState('');
  const [sending, setSending] = useState<NotificationChannel | null>(null);

  useEffect(() => {
    if (!data) return;
    setWaPhone(data.customer?.phone ?? '');
    setEmailAddr(data.customer?.email ?? '');
  }, [data?.order.id, data?.customer?.id]);

  if (!data || !store) return null;

  const { order, items, customer } = data;
  const text = buildReceiptText({ store, order, items, customerName: customer?.name });
  const money = (n: number) => formatMoney(n, store.currency);
  const paymentLabel = PAYMENT_LABELS[order.payment_method] ?? order.payment_method.toUpperCase();

  async function copyText() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast.success('Struk disalin ke clipboard.');
    } catch {
      toast.error('Gagal menyalin.');
    }
  }

  function downloadTxt() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.order_number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendReceipt(channel: NotificationChannel) {
    const to = channel === 'whatsapp' ? waPhone : emailAddr;
    if (channel === 'whatsapp' && !waValid) {
      toast.error('Nomor WhatsApp belum valid.');
      return;
    }
    if (channel === 'email' && !emailValid) {
      toast.error('Alamat email belum valid.');
      return;
    }

    try {
      setSending(channel);
      await sendDigitalReceipt({
        channel,
        to,
        message: text,
        subject: `Struk ${order.order_number}`,
        storeName: store?.name,
        orderNumber: order.order_number,
      });
      toast.success(
        channel === 'whatsapp'
          ? 'Struk terkirim via Fonnte WhatsApp.'
          : 'Struk terkirim via Gmail SMTP.',
      );
    } catch (error) {
      if (shouldUseFallback(error)) {
        openFallback(channel, to);
        toast.message(
          channel === 'whatsapp'
            ? 'Integrasi Fonnte belum aktif. WhatsApp dibuka manual.'
            : 'Integrasi Gmail SMTP belum aktif. Email dibuka manual.',
        );
      } else {
        toast.error(error instanceof Error ? error.message : 'Gagal mengirim struk digital.');
      }
    } finally {
      setSending(null);
    }
  }

  function openFallback(channel: NotificationChannel, to: string) {
    const href =
      channel === 'whatsapp'
        ? whatsappLink(to, text)
        : mailtoLink(to, `Struk ${order.order_number}`, text);
    if (channel === 'whatsapp') {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    window.location.href = href;
  }

  const waValid = waPhone.replace(/\D/g, '').length >= 8;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr);

  return (
    <Modal open onClose={onClose} title={`Struk ${order.order_number}`} size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/15">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white">
            <Check size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">
              Order tersimpan
            </div>
            <div className="truncate text-xs text-emerald-700/80 dark:text-emerald-200/80">
              Bayar {paymentLabel}
              {order.points_earned > 0 ? ` · +${order.points_earned} poin` : ''}
              {customer?.name ? ` · ${customer.name}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-emerald-700/80 dark:text-emerald-200/80">Total</div>
            <div className="text-base font-bold text-emerald-700 dark:text-emerald-200">
              {money(order.total)}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-800 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100">
          {store.logo_url && (
            <div className="mb-2 flex justify-center">
              <img
                src={store.logo_url}
                alt=""
                className="h-12 w-12 rounded-lg object-cover"
              />
            </div>
          )}
          <div className="text-center text-sm font-bold uppercase tracking-wide">
            {store.name}
          </div>
          {store.address && (
            <div className="text-center text-[10px] text-ink-500">{store.address}</div>
          )}
          {store.receipt_header && (
            <div className="mt-1 whitespace-pre-wrap text-center text-[10px]">
              {store.receipt_header}
            </div>
          )}
          <Dash />
          <Line left={order.order_number} right={formatDateTime(order.created_at)} />
          {customer?.name && <Line left="Customer" right={customer.name} />}
          <Line
            left="Type"
            right={
              (order.order_type === 'dine_in' ? 'Dine In' : 'Take Away') +
              (order.table_number ? ` · ${order.table_number}` : '')
            }
          />
          <Dash />
          {items.map((it) => (
            <div key={it.id}>
              <Line
                left={`${it.name}${it.size ? ` (${it.size})` : ''} × ${it.qty}`}
                right={money(it.price * it.qty)}
              />
              {it.note && (
                <div className="pl-2 text-[10px] text-ink-500">note: {it.note}</div>
              )}
            </div>
          ))}
          <Dash />
          <Line left="Subtotal" right={money(order.subtotal)} />
          {order.discount > 0 && (
            <Line
              left={`Diskon${order.promo_code ? ` (${order.promo_code})` : ''}`}
              right={`-${money(order.discount)}`}
              negative
            />
          )}
          <Line left="Pajak" right={money(order.tax)} />
          <Line left="TOTAL" right={money(order.total)} bold />
          <Line
            left={`Bayar (${order.payment_method.toUpperCase()})`}
            right={money(order.received_amount ?? order.total)}
          />
          {(order.change_amount ?? 0) > 0 && (
            <Line left="Kembali" right={money(order.change_amount ?? 0)} />
          )}
          {order.points_earned > 0 && (
            <Line left="Poin diperoleh" right={`+${order.points_earned}`} />
          )}
          <Dash />
          <div className="whitespace-pre-wrap text-center text-[10px] text-ink-500">
            {store.receipt_footer ?? 'Terima kasih atas kunjungan Anda!'}
          </div>
        </div>

        {/* Dua pilihan cetak, bukan satu: struk thermal 80mm memaksa lebar
            halaman lewat @page, dan itu berbenturan dengan kertas A4 kalau
            tujuan cetaknya printer biasa atau simpan PDF — hasilnya struk
            kecil nangkring di pojok halaman kosong. Faktur A4 punya templat
            sendiri yang memang dirancang mengisi satu halaman penuh, dipakai
            saat toko/pembeli grosir minta faktur yang bisa dibaca jelas. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button
            variant="secondary"
            onClick={() =>
              printReceipt({ store, order, items, customerName: customer?.name })
            }
            title="Cetak ke printer thermal 80mm"
          >
            <Printer size={14} /> Thermal
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              printInvoice({ store, order, items, customerName: customer?.name })
            }
            title="Cetak faktur satu halaman penuh (A4), atau simpan sebagai PDF"
          >
            <FileText size={14} /> Faktur A4
          </Button>
          <Button variant="secondary" onClick={copyText} title="Salin teks struk">
            <Copy size={14} /> Salin
          </Button>
          <Button variant="secondary" onClick={downloadTxt} title="Unduh sebagai .txt">
            <Download size={14} /> Unduh
          </Button>
        </div>

        <div className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Kirim digital
            </span>
            {(customer?.phone || customer?.email) && (
              <span className="text-[10px] text-ink-400">
                Dari data pelanggan
              </span>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-ink-200 px-2.5 py-1.5 dark:border-ink-700">
                <Phone size={12} className="text-ink-400" />
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="Nomor WhatsApp (+62...)"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  className="w-full bg-transparent text-sm focus:outline-none"
                />
              </div>
              <Button
                variant="secondary"
                className="whitespace-nowrap"
                disabled={sending !== null || !waValid}
                onClick={() => sendReceipt('whatsapp')}
                title="Kirim via Fonnte WhatsApp atau buka WhatsApp manual"
              >
                {sending === 'whatsapp' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <MessageCircle size={14} />
                )}
                Kirim
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-ink-200 px-2.5 py-1.5 dark:border-ink-700">
                <Mail size={12} className="text-ink-400" />
                <input
                  type="email"
                  inputMode="email"
                  placeholder="Email pelanggan"
                  value={emailAddr}
                  onChange={(e) => setEmailAddr(e.target.value)}
                  className="w-full bg-transparent text-sm focus:outline-none"
                />
              </div>
              <Button
                variant="secondary"
                className="whitespace-nowrap"
                disabled={sending !== null || !emailValid}
                onClick={() => sendReceipt('email')}
                title="Kirim via Gmail SMTP atau buka email manual"
              >
                {sending === 'email' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Mail size={14} />
                )}
                Kirim
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose}>Selesai</Button>
        </div>
      </div>
    </Modal>
  );
}

function shouldUseFallback(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /belum dikonfigurasi|belum aktif|endpoint notifikasi/i.test(error.message);
}

function Dash() {
  return <div className="my-2 border-t border-dashed border-ink-300 dark:border-ink-700" />;
}

function Line({
  left,
  right,
  bold,
  negative,
}: {
  left: string;
  right: string;
  bold?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-2',
        bold && 'text-sm font-bold',
        negative && 'text-rose-600',
      )}
    >
      <span className="break-words">{left}</span>
      <span className="whitespace-nowrap">{right}</span>
    </div>
  );
}
