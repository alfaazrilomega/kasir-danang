// Receipt printing & digital delivery helpers.
// Physical print: render an 80mm-wide HTML to a hidden iframe and call print().
// Digital: build text + WhatsApp (wa.me) or mailto: links.

import type { Order, OrderItem, Store } from '@/types';
import { formatDateTime, formatMoney } from '@/lib/format';

interface ReceiptInput {
  store: Store;
  order: Order;
  items: OrderItem[];
  customerName?: string | null;
}

export function buildReceiptHTML({ store, order, items, customerName }: ReceiptInput): string {
  const money = (n: number) => formatMoney(n, store.currency);
  const lines = items
    .map((it) => {
      const desc = `${escapeHtml(it.name)}${it.size ? ` (${escapeHtml(it.size)})` : ''}`;
      const line = `${desc} × ${it.qty}`;
      return `
        <tr>
          <td>${line}</td>
          <td class="r">${money(it.price * it.qty)}</td>
        </tr>${
          it.note
            ? `<tr><td colspan="2" class="muted">  note: ${escapeHtml(it.note)}</td></tr>`
            : ''
        }`;
    })
    .join('');

  const logoTag = store.logo_url
    ? `<div class="center logo"><img src="${escapeHtml(store.logo_url)}" alt="" /></div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.order_number)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: 'DM Sans', ui-monospace, monospace; color: #000; font-size: 12px; margin: 0; padding: 0; }
  .wrap { width: 72mm; padding: 4mm 2mm; }
  h1 { font-size: 14px; margin: 0 0 2px; text-align: center; }
  .center { text-align: center; }
  .muted { color: #666; }
  .logo { margin: 0 0 4px; }
  .logo img { height: 36px; width: 36px; object-fit: cover; border-radius: 6px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  .total { font-weight: 700; font-size: 13px; }
  .paid { display: inline-block; padding: 1px 6px; border: 1px solid #000; border-radius: 3px; font-size: 10px; letter-spacing: 1px; }
  .thanks { margin-top: 4px; font-size: 11px; }
</style>
</head><body>
<div class="wrap">
  ${logoTag}
  <h1>${escapeHtml(store.name)}</h1>
  ${store.address ? `<div class="center muted">${escapeHtml(store.address)}</div>` : ''}
  ${store.receipt_header ? `<div class="center">${escapeHtml(store.receipt_header)}</div>` : ''}
  <div class="sep"></div>
  <div class="row"><span>${escapeHtml(order.order_number)}</span><span>${formatDateTime(order.created_at)}</span></div>
  ${customerName ? `<div class="row"><span>Customer</span><span>${escapeHtml(customerName)}</span></div>` : ''}
  <div class="row"><span>Type</span><span>${order.order_type === 'dine_in' ? 'Dine In' : 'Take Away'}${order.table_number ? ` · ${escapeHtml(order.table_number)}` : ''}</span></div>
  <div class="sep"></div>
  <table>${lines}</table>
  <div class="sep"></div>
  <div class="row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
  ${order.discount > 0 ? `<div class="row"><span>Diskon${order.promo_code ? ` (${escapeHtml(order.promo_code)})` : ''}</span><span>-${money(order.discount)}</span></div>` : ''}
  <div class="row"><span>Pajak</span><span>${money(order.tax)}</span></div>
  <div class="row total"><span>TOTAL</span><span>${money(order.total)}</span></div>
  <div class="row"><span>Bayar (${order.payment_method.toUpperCase()})</span><span>${money(order.received_amount ?? order.total)}</span></div>
  ${order.change_amount && order.change_amount > 0 ? `<div class="row"><span>Kembali</span><span>${money(order.change_amount)}</span></div>` : ''}
  ${order.points_earned > 0 ? `<div class="row"><span>Poin diperoleh</span><span>+${order.points_earned}</span></div>` : ''}
  <div class="center" style="margin-top:6px;"><span class="paid">${order.payment_status === 'paid' ? 'LUNAS' : 'BELUM LUNAS'}</span></div>
  <div class="sep"></div>
  <div class="center thanks">${store.receipt_footer ? escapeHtml(store.receipt_footer) : 'Terima kasih atas kunjungan Anda!'}</div>
</div>
<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 100); });</script>
</body></html>`;
}

export function printReceipt(input: ReceiptInput) {
  const html = buildReceiptHTML(input);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(html);
  idoc.close();
  // Cleanup after print dialog closes
  iframe.contentWindow?.addEventListener('afterprint', () => {
    setTimeout(() => document.body.removeChild(iframe), 500);
  });
}

export function buildReceiptText({ store, order, items, customerName }: ReceiptInput): string {
  const money = (n: number) => formatMoney(n, store.currency);
  const head = [
    `*${store.name}*`,
    store.address ?? '',
    store.receipt_header ?? '',
    '──────────────',
    `Order   : ${order.order_number}`,
    `Tanggal : ${formatDateTime(order.created_at)}`,
    customerName ? `Pelanggan: ${customerName}` : null,
    `Tipe    : ${order.order_type === 'dine_in' ? 'Dine In' : 'Take Away'}${order.table_number ? ` · Meja ${order.table_number}` : ''}`,
    '──────────────',
  ].filter(Boolean);

  const lines = items.flatMap((it) => {
    const desc = `${it.name}${it.size ? ` (${it.size})` : ''} × ${it.qty}`;
    const main = `${desc}   ${money(it.price * it.qty)}`;
    return it.note ? [main, `  ↳ ${it.note}`] : [main];
  });

  const status = order.payment_status === 'paid' ? '✅ LUNAS' : '⏳ BELUM LUNAS';

  const tail = [
    '──────────────',
    `Subtotal     ${money(order.subtotal)}`,
    order.discount > 0
      ? `Diskon${order.promo_code ? ` (${order.promo_code})` : ''}  -${money(order.discount)}`
      : null,
    `Pajak        ${money(order.tax)}`,
    `*TOTAL       ${money(order.total)}*`,
    `Bayar (${order.payment_method.toUpperCase()})  ${money(order.received_amount ?? order.total)}`,
    order.change_amount && order.change_amount > 0
      ? `Kembali      ${money(order.change_amount)}`
      : null,
    order.points_earned > 0 ? `Poin +${order.points_earned}` : null,
    status,
    '',
    store.receipt_footer ?? 'Terima kasih atas kunjungan Anda!',
  ].filter(Boolean);

  return [...head, ...lines, ...tail].join('\n');
}

export function whatsappLink(phone: string | null | undefined, body: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const target = digits || ''; // empty → wa.me/?text= opens picker
  return `https://wa.me/${target}?text=${encodeURIComponent(body)}`;
}

export function mailtoLink(email: string | null | undefined, subject: string, body: string): string {
  const to = email ?? '';
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
