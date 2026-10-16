// Receipt printing & digital delivery helpers.
// Physical print: render an 80mm-wide HTML to a hidden iframe and call print().
// Digital: build text + WhatsApp (wa.me) or mailto: links.

import type { Customer, Order, OrderItem, Store } from '@/types';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
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
  // Nomor urut di kolom paling kiri: pesanan grosir bisa 20-30 baris SKU dan
  // client mencocokkan barang yang dikemas baris demi baris (butir 14b).
  // Baris pesanan tidak menyimpan urutan input (id-nya acak), jadi diurutkan
  // menurut SKU lalu nama supaya nomornya mengikuti urutan yang bisa ditebak.
  const kunciUrut = (it: OrderItem) => (it.product_id && skuByProductId?.[it.product_id]) || `~${it.name}`;
  const rows = [...items]
    .sort((a, b) => kunciUrut(a).localeCompare(kunciUrut(b), 'id', { numeric: true }))
    .map(
      (it, i) => `
        <tr>
          <td class="urut">${i + 1}</td>
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
  .urut { width: 28px; text-align: right; padding-right: 10px; color: #555; font-variant-numeric: tabular-nums; }
  /* Baris tidak terbelah di batas halaman, dan total + tanda tangan + kaki
     pindah halaman bersama. Tanpa ini, faktur 18 baris mencetak Subtotal dan
     Pajak di halaman 1 lalu TOTAL sendirian di halaman 2. */
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .penutup { break-inside: avoid; page-break-inside: avoid; }
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
    <thead><tr><th class="urut">No</th><th>SKU</th><th>Barang</th><th class="c">Qty</th><th class="r">Harga Satuan</th><th class="r">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="penutup">
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
  </div>
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

export interface ShippingTarget {
  name: string;
  phone: string | null;
  address: string;
  /** Kota dan provinsi, hanya yang belum tertulis di dalam teks alamatnya. */
  region: string | null;
}

/**
 * Tujuan kirim sebuah pesanan (butir 16 PERMINTAAN-CLIENT.md). Pesanan toko
 * online membawa alamatnya sendiri; pesanan kasir (misalnya dari WhatsApp)
 * memakai alamat utama pelanggannya. `null` berarti tidak ada alamat, jadi
 * tidak ada label yang bisa dicetak.
 */
export function shippingTarget(order: Order, customer?: Customer | null): ShippingTarget | null {
  const dariPesanan = order.delivery_address?.trim();
  const address = dariPesanan || customer?.address?.trim() || '';
  if (!address) return null;
  const wilayah = (dariPesanan
    ? [order.delivery_city, order.delivery_province]
    : [customer?.address_city, customer?.address_province]
  )
    .map((w) => w?.trim())
    .filter((w): w is string => !!w)
    // Checkout toko online sudah menulis kota dan provinsi di ujung alamat.
    .filter((w) => !address.toLowerCase().includes(w.toLowerCase()));
  // Nama dan telepon mengikuti sumber alamatnya. Di checkout toko online
  // pembeli mengetik "Nama Penerima" sendiri dan boleh mengirim ke orang lain,
  // jadi untuk alamat dari pesanan yang didahulukan isian pesanan itu, bukan
  // nama akunnya. Untuk alamat dari pelanggan, data pelanggannya.
  const dariOrder = [order.customer_name?.trim(), order.customer_phone?.trim()];
  const dariPelanggan = [customer?.name?.trim(), customer?.phone?.trim()];
  const [utama, cadangan] = dariPesanan ? [dariOrder, dariPelanggan] : [dariPelanggan, dariOrder];
  return {
    name: utama[0] || cadangan[0] || 'Penerima',
    phone: utama[1] || cadangan[1] || null,
    address,
    region: wilayah.join(', ') || null,
  };
}

interface ShippingLabelInput {
  store: Store;
  order: Order;
  items: OrderItem[];
  target: ShippingTarget;
  channelName?: string | null;
  skuByProductId?: Record<string, string>;
}

/**
 * Batas atas baris barang yang ditulis ke label. Berapa yang benar-benar muat
 * bergantung pada panjang alamat, jadi skrip di dalam label membuang baris
 * dari bawah sampai pas, dan jumlah yang dibuang disebut di bawah daftar.
 */
const MAKS_BARIS_LABEL = 20;

/**
 * Label kirim 100 x 150 mm, ukuran resi marketplace untuk printer label atau
 * thermal. Isinya penerima, pengirim, catatan, dan isi paket tanpa harga,
 * karena label ditempel di luar paket.
 */
export function buildShippingLabelHTML({ store, order, items, target, channelName, skuByProductId }: ShippingLabelInput): string {
  const kunci = (it: OrderItem) => (it.product_id && skuByProductId?.[it.product_id]) || `~${it.name}`;
  const urut = [...items].sort((a, b) => kunci(a).localeCompare(kunci(b), 'id', { numeric: true }));
  const pcs = (list: OrderItem[]) => list.reduce((sum, it) => sum + Number(it.qty), 0);
  const tampil = urut.slice(0, MAKS_BARIS_LABEL);
  const sisa = urut.slice(MAKS_BARIS_LABEL);
  const baris = tampil
    .map((it) => {
      const sku = it.product_id ? skuByProductId?.[it.product_id] : '';
      return `<tr data-qty="${Number(it.qty)}"><td class="q">${Number(it.qty)}×</td><td><div class="n">${sku ? `<span class="sku">${escapeHtml(sku)}</span> ` : ''}${escapeHtml(it.name)}${it.size ? ` (${escapeHtml(it.size)})` : ''}</div></td></tr>`;
    })
    .join('');
  const alamatToko = store.address?.trim() || store.shop_city?.trim() || '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<title>Label ${escapeHtml(order.order_number)}</title>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { width: 100mm; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 10pt; line-height: 1.3; }
  .label { width: 100mm; height: 150mm; padding: 4mm; display: flex; flex-direction: column; overflow: hidden; }
  .kepala { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm; border-bottom: 0.6mm solid #000; padding-bottom: 2mm; }
  .toko { max-width: 55%; font-size: 13pt; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
  .nomor { flex: 1; min-width: 0; text-align: right; font-size: 8pt; }
  .nomor b { display: block; font-size: 10pt; overflow-wrap: anywhere; }
  .bagian { padding: 2.5mm 0; border-bottom: 0.3mm solid #000; }
  .judul { font-size: 7pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .penerima .nama { font-size: 15pt; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
  .penerima .telp { font-size: 12pt; font-weight: 700; }
  .penerima .alamat { font-size: 12pt; margin-top: 1mm; overflow-wrap: anywhere; }
  .penerima .wilayah { font-size: 11pt; font-weight: 700; text-transform: uppercase; margin-top: 1mm; }
  .pengirim, .catatan { font-size: 9pt; overflow-wrap: anywhere; }
  .pengirim b { font-size: 10pt; }
  /* Catatan dibatasi tiga baris: alamat tidak pernah dipotong, jadi catatan
     yang sangat panjang tidak boleh menggusur isi paket keluar dari label. */
  .catatan .teks { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .isi { flex: 1; min-height: 0; overflow: hidden; border-bottom: 0; padding-bottom: 0; }
  .isi table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 8.5pt; margin-top: 1mm; }
  .isi td { padding: 0.4mm 0; vertical-align: top; }
  .isi td.q { width: 10mm; font-weight: 700; white-space: nowrap; }
  .isi .n { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .sku { font-family: 'Courier New', monospace; font-weight: 700; }
  .lain { font-size: 8.5pt; font-style: italic; margin-top: 0.5mm; }
</style>
</head><body>
  <div class="label">
    <div class="kepala">
      <div class="toko">${escapeHtml(store.name)}</div>
      <div class="nomor"><b>${escapeHtml(order.order_number)}</b>${formatDate(order.created_at)}${channelName ? ` · ${escapeHtml(channelName)}` : ''}</div>
    </div>
    <div class="bagian penerima">
      <div class="judul">Penerima</div>
      <div class="nama">${escapeHtml(target.name)}</div>
      ${target.phone ? `<div class="telp">${escapeHtml(target.phone)}</div>` : ''}
      <div class="alamat">${escapeHtml(target.address)}</div>
      ${target.region ? `<div class="wilayah">${escapeHtml(target.region)}</div>` : ''}
    </div>
    <div class="bagian pengirim">
      <div class="judul">Pengirim</div>
      <div><b>${escapeHtml(store.name)}</b>${store.shop_phone ? ` · ${escapeHtml(store.shop_phone)}` : ''}</div>
      ${alamatToko ? `<div>${escapeHtml(alamatToko)}</div>` : ''}
    </div>
    ${order.notes?.trim() ? `<div class="bagian catatan"><div class="judul">Catatan</div><div class="teks">${escapeHtml(order.notes.trim())}</div></div>` : ''}
    <div class="bagian isi">
      <div class="judul">Isi paket · ${items.length} barang · ${pcs(items)} pcs</div>
      <table><tbody>${baris}</tbody></table>
      <div class="lain" data-barang="${sisa.length}" data-pcs="${pcs(sisa)}"${sisa.length ? '' : ' hidden'}>+ ${sisa.length} barang lain (${pcs(sisa)} pcs), rinciannya di faktur.</div>
    </div>
  </div>
<script>
  window.addEventListener('load', function () {
    // Daftar barang dipangkas dari bawah sampai muat di sisa tinggi label.
    var isi = document.querySelector('.isi');
    var lain = isi.querySelector('.lain');
    var baris = Array.prototype.slice.call(isi.querySelectorAll('tr'));
    var barang = Number(lain.getAttribute('data-barang'));
    var pcs = Number(lain.getAttribute('data-pcs'));
    function meluap() { return isi.scrollHeight > isi.clientHeight + 1; }
    function pangkas(minimal) {
      while (meluap() && baris.length > minimal) {
        var tr = baris.pop();
        barang += 1;
        pcs += Number(tr.getAttribute('data-qty'));
        tr.parentNode.removeChild(tr);
        lain.setAttribute('data-barang', String(barang));
        lain.setAttribute('data-pcs', String(pcs));
        lain.hidden = false;
        lain.textContent = baris.length
          ? '+ ' + barang + ' barang lain (' + pcs + ' pcs), rinciannya di faktur.'
          : 'Rincian ' + barang + ' barang (' + pcs + ' pcs) ada di faktur.';
      }
    }
    pangkas(1);
    // Alamat sangat panjang: hurufnya dikecilkan bertahap, paling kecil 9pt,
    // supaya minimal satu barang tetap terbaca. Alamatnya sendiri tidak dipotong.
    var alamat = document.querySelector('.penerima .alamat');
    for (var pt = 11.5; meluap() && pt >= 9; pt -= 0.5) alamat.style.fontSize = pt + 'pt';
    // Masih tidak muat: semua barang diringkas, lebih baik tanpa rincian
    // daripada baris yang terpotong setengah.
    pangkas(0);
    setTimeout(function () { window.print(); }, 100);
  });
</script>
</body></html>`;
}

export function printShippingLabel(input: ShippingLabelInput) {
  printHtml(buildShippingLabelHTML(input), `Label ${input.order.order_number}`);
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
