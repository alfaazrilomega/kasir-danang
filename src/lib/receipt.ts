// Receipt printing & digital delivery helpers.
// Physical print: render an 80mm-wide HTML to a hidden iframe and call print().
// Digital: build text + WhatsApp (wa.me) or mailto: links.

import type { Order, OrderItem, Store } from '@/types';
import { formatDateTime, formatMoney } from '@/lib/format';
import { resolveFeatures } from '@/lib/industries';

interface ReceiptInput {
  store: Store;
  order: Order;
  items: OrderItem[];
  customerName?: string | null;
  /** SKU per product_id. order_items tidak menyimpan SKU, jadi dicari dari produk. */
  skuByProductId?: Record<string, string>;
  /** Orang yang mencetak; tampil di faktur A4. */
  printedBy?: string | null;
}

/** Toko online tidak memakai Dine In / Take Away, jadi barisnya tidak dicetak. */
function pakaiTipeOrder(store: Store): boolean {
  return resolveFeatures(store.industry, store.features as Parameters<typeof resolveFeatures>[1])
    .useOrderType;
}

/**
 * Persentase pajak dihitung dari angka pesanan itu sendiri, bukan tarif toko
 * saat ini: tarif bisa berubah, sedangkan cetak ulang pesanan lama harus sama
 * dengan saat transaksi.
 */
function labelPajak(order: Order): string {
  const dasar = order.tax_inclusive
    ? Number(order.subtotal) - Number(order.discount) - Number(order.tax)
    : Number(order.subtotal) - Number(order.discount);
  if (dasar <= 0) return order.tax_inclusive ? 'Termasuk pajak' : 'Pajak';
  const pct = Math.round((Number(order.tax) / dasar) * 1000) / 10;
  return order.tax_inclusive ? `Termasuk pajak ${pct}%` : `Pajak (${pct}%)`;
}

/** Baris pajak hanya dicetak kalau ada pajaknya — "Pajak Rp 0" cuma mengganggu. */
function adaPajak(order: Order): boolean {
  return Number(order.tax) > 0;
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
  ${pakaiTipeOrder(store) ? `<div class="row"><span>Type</span><span>${order.order_type === 'dine_in' ? 'Dine In' : 'Take Away'}${order.table_number ? ` · ${escapeHtml(order.table_number)}` : ''}</span></div>` : ''}
  <div class="sep"></div>
  <table>${lines}</table>
  <div class="sep"></div>
  <div class="row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
  ${order.discount > 0 ? `<div class="row"><span>Diskon${order.promo_code ? ` (${escapeHtml(order.promo_code)})` : ''}</span><span>-${money(order.discount)}</span></div>` : ''}
  ${adaPajak(order) && !order.tax_inclusive ? `<div class="row"><span>${labelPajak(order)}</span><span>${money(order.tax)}</span></div>` : ''}
  ${Number(order.shipping_cost ?? 0) > 0 ? `<div class="row"><span>Ongkir</span><span>${money(Number(order.shipping_cost))}</span></div>` : ''}
  <div class="row total"><span>TOTAL</span><span>${money(order.total)}</span></div>
  ${adaPajak(order) && order.tax_inclusive ? `<div class="row muted"><span>${labelPajak(order)}</span><span>${money(order.tax)}</span></div>` : ''}
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

/**
 * Faktur satu halaman penuh, untuk dicetak ke printer biasa (A4) atau
 * disimpan sebagai PDF.
 *
 * Struk thermal di atas ditulis untuk kertas 80mm: `@page { size: 80mm auto }`
 * memaksa lebar halaman, tapi kalau tujuan cetaknya printer/PDF biasa, aturan
 * itu berbenturan dengan ukuran kertas sungguhan (A4) yang dipilih di kotak
 * dialog cetak. Hasilnya struk kecil nangkring di pojok kiri atas halaman
 * besar yang kosong — persis yang dikeluhkan client saat mencetak faktur
 * untuk pesanan toko/grosir. Templat ini dibuat terpisah, bukan menambah
 * ukuran font templat thermal, karena kerapatan tata letaknya memang berbeda:
 * thermal mengejar hemat kertas gulung, faktur ini mengejar mudah dibaca satu
 * halaman penuh dengan tabel barang yang jelas.
 */
export function buildInvoiceHTML({
  store,
  order,
  items,
  customerName,
  skuByProductId,
  printedBy,
}: ReceiptInput): string {
  const money = (n: number) => formatMoney(n, store.currency);
  const rows = items
    .map(
      (it) => `
        <tr>
          <td class="sku">${escapeHtml((it.product_id && skuByProductId?.[it.product_id]) || '-')}</td>
          <td>${escapeHtml(it.name)}${it.size ? ` <span class="muted">(${escapeHtml(it.size)})</span>` : ''}${it.note ? `<div class="note">Catatan: ${escapeHtml(it.note)}</div>` : ''}</td>
          <td class="c">${it.qty}</td>
          <td class="r">${money(it.price)}</td>
          <td class="r">${money(it.price * it.qty)}</td>
        </tr>`,
    )
    .join('');

  const logoTag = store.logo_url
    ? `<img class="logo" src="${escapeHtml(store.logo_url)}" alt="" />`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.order_number)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'DM Sans', Arial, sans-serif; color: #111; margin: 0; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 18px; }
  .store { display: flex; gap: 12px; align-items: center; }
  .logo { height: 52px; width: 52px; object-fit: cover; border-radius: 8px; }
  .store h1 { font-size: 20px; margin: 0; }
  .store .addr { color: #555; font-size: 12px; margin-top: 2px; max-width: 320px; }
  .meta { text-align: right; font-size: 12px; }
  .meta .no { font-size: 16px; font-weight: 700; }
  .meta .status { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: .5px; }
  .status.paid { background: #dcfce7; color: #166534; }
  .status.unpaid { background: #fee2e2; color: #991b1b; }
  .row2 { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #555; border-bottom: 2px solid #111; padding: 8px 4px; }
  td { padding: 10px 4px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .muted { color: #777; font-size: 12px; }
  .note { color: #777; font-size: 11px; margin-top: 2px; }
  .totals { width: 320px; margin-left: auto; margin-top: 14px; font-size: 13px; }
  .totals .line { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid #111; margin-top: 6px; padding-top: 8px; font-size: 17px; font-weight: 700; }
  .sku { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #333; white-space: nowrap; }
  .totals .incl { color: #666; font-size: 12px; }
  .sign { display: flex; justify-content: flex-end; margin-top: 36px; }
  .sign-box { text-align: center; min-width: 200px; font-size: 12px; }
  .sign-box img { display: block; height: 70px; max-width: 220px; object-fit: contain; margin: 6px auto; }
  .sign-space { height: 70px; }
  .sign-name { border-top: 1px solid #111; padding-top: 4px; font-weight: 700; }
  .footer { margin-top: 40px; text-align: center; color: #555; font-size: 12px; border-top: 1px solid #e5e5e5; padding-top: 14px; }
</style>
</head><body>
  <div class="head">
    <div class="store">
      ${logoTag}
      <div>
        <h1>${escapeHtml(store.name)}</h1>
        ${store.address ? `<div class="addr">${escapeHtml(store.address)}</div>` : ''}
      </div>
    </div>
    <div class="meta">
      <div class="no">${escapeHtml(order.order_number)}</div>
      <div>${formatDateTime(order.created_at)}</div>
      <span class="status ${order.payment_status === 'paid' ? 'paid' : 'unpaid'}">${order.payment_status === 'paid' ? 'LUNAS' : 'BELUM LUNAS'}</span>
    </div>
  </div>
  <div class="row2">
    <div>${customerName ? `<strong>Pelanggan:</strong> ${escapeHtml(customerName)}` : ''}</div>
    <div style="text-align:right">${pakaiTipeOrder(store) ? `<div><strong>Tipe:</strong> ${order.order_type === 'dine_in' ? 'Dine In' : 'Take Away'}${order.table_number ? ` · Meja ${escapeHtml(order.table_number)}` : ''}</div>` : ''}${printedBy ? `<div><strong>Kasir:</strong> ${escapeHtml(printedBy)}</div>` : ''}</div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Barang</th><th class="c">Qty</th><th class="r">Harga Satuan</th><th class="r">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="line"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
    ${order.discount > 0 ? `<div class="line"><span>Diskon${order.promo_code ? ` (${escapeHtml(order.promo_code)})` : ''}</span><span>-${money(order.discount)}</span></div>` : ''}
    ${adaPajak(order) && !order.tax_inclusive ? `<div class="line"><span>${labelPajak(order)}</span><span>${money(order.tax)}</span></div>` : ''}
    ${Number(order.shipping_cost ?? 0) > 0 ? `<div class="line"><span>Ongkir</span><span>${money(Number(order.shipping_cost))}</span></div>` : ''}
    <div class="line grand"><span>TOTAL</span><span>${money(order.total)}</span></div>
    ${adaPajak(order) && order.tax_inclusive ? `<div class="line incl"><span>${labelPajak(order)}</span><span>${money(order.tax)}</span></div>` : ''}
    <div class="line"><span>Bayar (${order.payment_method.toUpperCase()})</span><span>${money(order.received_amount ?? order.total)}</span></div>
    ${order.change_amount && order.change_amount > 0 ? `<div class="line"><span>Kembali</span><span>${money(order.change_amount)}</span></div>` : ''}
  </div>
  <div class="sign">
    <div class="sign-box">
      <div>Hormat kami,</div>
      ${store.invoice_signature_url ? `<img src="${escapeHtml(store.invoice_signature_url)}" alt="" />` : '<div class="sign-space"></div>'}
      <div class="sign-name">${escapeHtml(store.invoice_signer_name || printedBy || store.name)}</div>
    </div>
  </div>
  <div class="footer">${store.receipt_footer ? escapeHtml(store.receipt_footer) : 'Terima kasih atas kunjungan Anda!'}</div>
<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 100); });</script>
</body></html>`;
}

function printHtml(html: string, title: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.title = title;
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(html);
  idoc.close();
  iframe.contentWindow?.addEventListener('afterprint', () => {
    setTimeout(() => document.body.removeChild(iframe), 500);
  });
}

/** Cetak faktur A4, untuk printer biasa atau disimpan sebagai PDF satu halaman penuh. */
export function printInvoice(input: ReceiptInput) {
  printHtml(buildInvoiceHTML(input), input.order.order_number);
}

export function printReceipt(input: ReceiptInput) {
  printHtml(buildReceiptHTML(input), input.order.order_number);
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
    pakaiTipeOrder(store)
      ? `Tipe    : ${order.order_type === 'dine_in' ? 'Dine In' : 'Take Away'}${order.table_number ? ` · Meja ${order.table_number}` : ''}`
      : null,
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
    adaPajak(order) && !order.tax_inclusive ? `${labelPajak(order)}  ${money(order.tax)}` : null,
    Number(order.shipping_cost ?? 0) > 0 ? `Ongkir       ${money(Number(order.shipping_cost))}` : null,
    `*TOTAL       ${money(order.total)}*`,
    adaPajak(order) && order.tax_inclusive ? `(${labelPajak(order)}: ${money(order.tax)})` : null,
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
