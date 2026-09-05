// Impor penjualan massal.
//
// Client memasukkan penjualan lama (mis. Juli–Agustus) yang datanya berasal dari
// nomor pesanan marketplace. Ada tiga bentuk berkas yang diterima:
//
//   1. Susunan kita sendiri, sama persis dengan hasil ekspor Riwayat Transaksi.
//   2. Ekspor mentah TikTok Shop (.xlsx).
//   3. Ekspor mentah Shopee (.xlsx).
//
// Dua yang terakhir dibaca apa adanya, tanpa client perlu menyusun ulang
// kolomnya. Menyuruh mereka merapikan ratusan baris tiap bulan adalah pekerjaan
// yang justru ingin dihilangkan oleh fitur ini.
//
// Satu pesanan boleh punya banyak baris: nomor pesanan diulang di tiap baris,
// dan baris bernomor sama digabung menjadi satu pesanan.
//
// PENTING: impor ini TIDAK menyentuh stok. Datanya penjualan yang sudah lewat,
// sedangkan stok di aplikasi adalah angka hari ini. Mengurangi stok di sini
// justru membuatnya salah.

import { db } from './db';
import { getBackendClient } from './api';
import { uuid } from './format';
import type { Order, OrderItem, PaymentMethod, Product } from '@/types';

/** Kolom susunan kita sendiri, mengikuti judul kolom ekspor Riwayat Transaksi. */
export const SALES_COLUMNS = [
  'No. Pesanan',
  'No. Pesanan Platform',
  'Tanggal',
  'Channel',
  'SKU',
  'Barcode',
  'Nama Produk',
  'Qty',
  'Harga Satuan',
  'Subtotal',
  'Status Bayar',
  'Status Order',
  'Nama Pelanggan',
] as const;

const WAJIB = ['No. Pesanan', 'Tanggal', 'Qty', 'Harga Satuan'];

export type SalesLayout = 'kasir' | 'tiktok' | 'shopee';

/**
 * Peta kolom satu susunan berkas.
 *
 * Tiap medan berisi daftar nama kolom yang boleh dipakai, berurutan dari yang
 * paling tepat. Bentuk daftar dipilih karena marketplace kadang punya dua kolom
 * yang sama-sama masuk akal (Shopee: SKU varian dan SKU induk).
 */
interface LayoutMap {
  layout: SalesLayout;
  /** Ditampilkan ke pengguna supaya tebakan sistem bisa diperiksa mata. */
  label: string;
  channelCode: string | null;
  /**
   * Berkas menaruh satu baris keterangan kolom tepat di bawah judulnya.
   * TikTok mengisi keterangan itu di SEMUA kolom, termasuk kolom nomor
   * pesanan, jadi baris itu tidak bisa dikenali dari sel yang kosong.
   */
  hasDescriptionRow?: boolean;
  orderNumber: string[];
  externalOrderNo: string[];
  date: string[];
  paidTime: string[];
  channel: string[];
  sku: string[];
  barcode: string[];
  name: string[];
  qty: string[];
  /** Harga satuan langsung. */
  unitPrice: string[];
  /** Total satu baris; harga satuan dihitung dengan membaginya ke qty. */
  lineTotal: string[];
  paymentMethod: string[];
  orderStatus: string[];
  customerName: string[];
}

const LAYOUTS: LayoutMap[] = [
  {
    layout: 'kasir',
    label: 'susunan TokoKu',
    channelCode: null,
    orderNumber: ['No. Pesanan'],
    externalOrderNo: ['No. Pesanan Platform'],
    date: ['Tanggal'],
    paidTime: [],
    channel: ['Channel'],
    sku: ['SKU'],
    barcode: ['Barcode'],
    name: ['Nama Produk'],
    qty: ['Qty'],
    unitPrice: ['Harga Satuan'],
    lineTotal: [],
    paymentMethod: [],
    orderStatus: ['Status Order'],
    customerName: ['Nama Pelanggan'],
  },
  {
    layout: 'tiktok',
    label: 'ekspor TikTok Shop',
    channelCode: 'tiktok',
    hasDescriptionRow: true,
    orderNumber: ['Order ID'],
    externalOrderNo: ['Order ID'],
    date: ['Created Time'],
    paidTime: ['Paid Time'],
    channel: [],
    sku: ['Seller SKU', 'SKU ID'],
    barcode: [],
    name: ['Product Name'],
    qty: ['Quantity'],
    unitPrice: [],
    // Harga yang benar-benar dibayar pembeli, sesudah diskon. "SKU Unit
    // Original Price" adalah harga tayang dan hampir selalu lebih tinggi.
    lineTotal: ['SKU Subtotal After Discount'],
    paymentMethod: ['Payment Method'],
    orderStatus: ['Order Status'],
    customerName: ['Recipient', 'Buyer Username'],
  },
  {
    layout: 'shopee',
    label: 'ekspor Shopee',
    channelCode: 'shopee',
    orderNumber: ['No. Pesanan'],
    externalOrderNo: ['No. Pesanan'],
    date: ['Waktu Pesanan Dibuat'],
    paidTime: ['Waktu Pembayaran Dilakukan'],
    channel: [],
    sku: ['Nomor Referensi SKU', 'SKU Induk'],
    barcode: [],
    name: ['Nama Produk'],
    qty: ['Jumlah'],
    unitPrice: ['Harga Setelah Diskon'],
    lineTotal: ['Subtotal Pesanan'],
    paymentMethod: ['Metode Pembayaran'],
    orderStatus: ['Status Pesanan'],
    customerName: ['Nama Penerima', 'Username (Pembeli)'],
  },
];

/**
 * Tebak susunan berkas dari judul kolomnya.
 *
 * Penanda dipilih yang khas: "Seller SKU" hanya ada di TikTok, dan
 * "Nomor Referensi SKU" hanya ada di Shopee.
 */
export function detectLayout(header: string[]): LayoutMap {
  const ada = (name: string) => header.some((h) => h.trim() === name);
  if (ada('Order ID') && (ada('Seller SKU') || ada('SKU ID'))) return LAYOUTS[1];
  if (ada('No. Pesanan') && (ada('Nomor Referensi SKU') || ada('SKU Induk'))) return LAYOUTS[2];
  return LAYOUTS[0];
}

export interface SalesIssue {
  row: number;
  message: string;
}

export interface ParsedSalesLine {
  row: number;
  orderNumber: string;
  externalOrderNo: string | null;
  createdAt: string;
  channel: string;
  sku: string;
  barcode: string;
  name: string;
  qty: number;
  price: number;
  paymentStatus: 'paid' | 'unpaid';
  orderStatus: 'done' | 'canceled';
  paymentMethod: PaymentMethod;
  customerName: string | null;
  productId: string | null;
  costPrice: number;
}

export interface SalesImportPlan {
  /** Pesanan yang akan dibuat, sudah dikelompokkan per nomor pesanan. */
  orders: { orderNumber: string; lines: ParsedSalesLine[]; total: number }[];
  /** Nomor pesanan yang dilewati karena sudah ada di aplikasi. */
  duplicates: string[];
  issues: SalesIssue[];
  totalRows: number;
  layout: SalesLayout;
  layoutLabel: string;
  /** Baris yang SKU-nya tidak ketemu di katalog. */
  unmatched: number;
}

export interface SalesImportResult {
  orders: number;
  items: number;
  serverErrors: string[];
}

/**
 * Terima "1.250.000", "1250000", dan "1250,50".
 * Titik ribuan dibuang, koma desimal diubah jadi titik.
 */
function parseNumber(value: string): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s/g, '')
    .replace(/[Rp$]/gi, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Terima "dd/mm/yyyy HH:mm:ss" (TikTok), "yyyy-mm-dd HH:mm" (Shopee), ISO, dan
 * angka seri Excel.
 *
 * Angka seri ikut ditangani karena sel tanggal di .xlsx kadang tersimpan
 * sebagai angka, bukan teks, tergantung cara berkasnya dibuat.
 */
function parseDate(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const id = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (id) {
    const [, d, m, y, hh, mm, ss] = id;
    const dt = new Date(
      Number(y), Number(m) - 1, Number(d),
      Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0),
    );
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  // Angka seri Excel: hari sejak 30 Desember 1899. Dibatasi ke rentang yang
  // masuk akal supaya angka biasa tidak salah dikira tanggal.
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 40000 && serial < 60000) {
      const ms = Math.round((serial - 25569) * 86400000);
      const dt = new Date(ms);
      return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
    }
    return null;
  }

  const dt = new Date(raw.replace(' ', 'T'));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function normalizeStatusBayar(value: string): 'paid' | 'unpaid' {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 'paid';
  return ['belum bayar', 'unpaid', 'belum', 'tempo', 'piutang'].includes(v) ? 'unpaid' : 'paid';
}

function normalizeStatusOrder(value: string): 'done' | 'canceled' {
  const v = String(value ?? '').trim().toLowerCase();
  return ['dibatalkan', 'canceled', 'cancelled', 'batal', 'dibatalkan penjual'].includes(v)
    ? 'canceled'
    : 'done';
}

/**
 * Petakan metode bayar marketplace ke metode yang dikenal aplikasi.
 *
 * Hanya yang benar-benar pasti yang dipetakan. Sisanya jadi 'other' — mengaku
 * tahu cara uang masuk padahal cuma menebak akan merusak rekap metode bayar.
 */
function mapPaymentMethod(value: string): PaymentMethod {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 'other';
  if (v.includes('cod') || v.includes('bayar di tempat') || v.includes('tunai') || v === 'cash') {
    return 'cash';
  }
  if (v.includes('qris')) return 'qris';
  return 'other';
}

/** Ubah label channel ("Shopee Official") jadi kodenya ("shopee"). */
function resolveChannelCode(label: string, byName: Map<string, string>): string {
  const raw = String(label ?? '').trim();
  if (!raw) return 'offline';
  const lower = raw.toLowerCase();
  return byName.get(lower) ?? lower.replace(/\s+/g, '-');
}

export interface PlanOptions {
  /** Memaksa channel tujuan, untuk kasus Shopee toko 1 vs toko 2. */
  channelCode?: string;
}

/**
 * Baca isi berkas dan susun rencana impor, tanpa menulis apa pun.
 *
 * Baris bermasalah dilaporkan beserta nomor barisnya dan TIDAK ikut masuk,
 * supaya satu sel yang salah tidak menggagalkan seluruh berkas.
 */
export async function planSalesImport(
  rows: string[][],
  storeId: string,
  options: PlanOptions = {},
): Promise<SalesImportPlan> {
  const issues: SalesIssue[] = [];
  const kosong = (pesan: string): SalesImportPlan => ({
    orders: [],
    duplicates: [],
    issues: [{ row: 0, message: pesan }],
    totalRows: 0,
    layout: 'kasir',
    layoutLabel: LAYOUTS[0].label,
    unmatched: 0,
  });

  if (rows.length < 2) return kosong('Berkas kosong.');

  const header = rows[0].map((h) => h.trim());
  const map = detectLayout(header);

  if (map.layout === 'kasir') {
    const kurang = WAJIB.filter((k) => !header.includes(k));
    if (kurang.length) {
      return {
        ...kosong(`Kolom wajib tidak ada: ${kurang.join(', ')}.`),
        issues: [{ row: 1, message: `Kolom wajib tidak ada: ${kurang.join(', ')}.` }],
      };
    }
  }

  /** Ambil isi sel untuk medan tertentu, mencoba tiap nama kolom berurutan. */
  const cellOf = (row: string[], names: string[]): string => {
    for (const name of names) {
      const at = header.indexOf(name);
      if (at >= 0) {
        const v = (row[at] ?? '').trim();
        if (v) return v;
      }
    }
    return '';
  };

  const products = await db.products.where('store_id').equals(storeId).toArray();
  const bySku = new Map<string, Product>();
  const byBarcode = new Map<string, Product>();
  const byName = new Map<string, Product>();
  for (const p of products) {
    if (p.sku) bySku.set(p.sku.trim().toUpperCase(), p);
    if (p.barcode) byBarcode.set(p.barcode.trim(), p);
    byName.set(p.name.trim().toLowerCase(), p);
  }

  const channels = await db.sales_channels.where('store_id').equals(storeId).toArray();
  const channelByName = new Map(channels.map((c) => [c.name.toLowerCase(), c.code]));

  const existing = await db.orders.where('store_id').equals(storeId).toArray();
  const nomorAda = new Set(existing.map((o) => (o.order_number ?? '').trim().toUpperCase()));
  const platformAda = new Set(
    existing.map((o) => (o.external_order_no ?? '').trim().toUpperCase()).filter(Boolean),
  );

  const grouped = new Map<string, ParsedSalesLine[]>();
  const duplicates = new Set<string>();
  let totalRows = 0;
  let unmatched = 0;

  for (let i = 1; i < rows.length; i++) {
    const nomorBaris = i + 1; // baris 1 adalah judul kolom
    const row = rows[i];
    const cell = (names: string[]) => cellOf(row, names);

    // Baris keterangan kolom bukan data. TikTok mengisinya di semua kolom
    // ("Platform unique order ID." di kolom nomor pesanan), jadi tidak bisa
    // dikenali dari sel kosong. Dikenali dari posisinya, tepat di bawah judul,
    // ditambah syarat qty-nya bukan angka — supaya baris data asli tidak ikut
    // terbuang kalau kelak bentuk berkasnya berubah.
    if (map.hasDescriptionRow && i === 1) {
      const qtyKeterangan = Number(String(cell(map.qty)).replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(qtyKeterangan) || qtyKeterangan <= 0) continue;
    }

    const orderNumber = cell(map.orderNumber);
    if (!orderNumber) {
      // Baris kosong di akhir berkas juga bukan masalah yang perlu dilaporkan.
      if (!cell(map.qty)) continue;
      issues.push({ row: nomorBaris, message: 'Nomor pesanan kosong, baris dilewati.' });
      continue;
    }
    totalRows++;

    const externalOrderNo = cell(map.externalOrderNo) || null;
    if (
      nomorAda.has(orderNumber.toUpperCase()) ||
      (externalOrderNo && platformAda.has(externalOrderNo.toUpperCase()))
    ) {
      duplicates.add(orderNumber);
      continue;
    }

    const createdAt = parseDate(cell(map.date));
    if (!createdAt) {
      issues.push({ row: nomorBaris, message: `Tanggal "${cell(map.date)}" tidak dikenali.` });
      continue;
    }

    const qty = parseNumber(cell(map.qty));
    if (qty === null || qty <= 0) {
      issues.push({ row: nomorBaris, message: `Qty "${cell(map.qty)}" bukan angka lebih dari nol.` });
      continue;
    }

    // Harga satuan bisa datang langsung, atau dihitung dari total baris.
    const rawUnit = cell(map.unitPrice);
    const rawTotal = cell(map.lineTotal);
    let price: number | null = null;
    if (rawUnit) {
      price = parseNumber(rawUnit);
    } else if (rawTotal) {
      const total = parseNumber(rawTotal);
      price = total === null ? null : total / qty;
    }
    if (price === null || price < 0) {
      issues.push({
        row: nomorBaris,
        message: `Harga "${rawUnit || rawTotal}" bukan angka.`,
      });
      continue;
    }

    const sku = cell(map.sku);
    const barcode = cell(map.barcode);
    const nama = cell(map.name);
    const produk =
      (sku && bySku.get(sku.toUpperCase())) ||
      (barcode && byBarcode.get(barcode)) ||
      (nama && byName.get(nama.toLowerCase())) ||
      null;

    if (!produk && !nama) {
      issues.push({ row: nomorBaris, message: 'Barang tidak dikenali: SKU, barcode, dan nama kosong.' });
      continue;
    }
    if (!produk) {
      // Bukan penghalang: penjualan lama boleh memuat barang yang sudah tidak
      // ada di katalog. Baris tetap masuk, hanya tidak tertaut ke produk.
      unmatched++;
      issues.push({
        row: nomorBaris,
        message: `Produk "${sku || nama}" tidak ada di katalog — baris tetap dicatat tanpa tautan produk.`,
      });
    }

    // Status bayar marketplace dibaca dari ada tidaknya waktu pembayaran,
    // bukan ditebak dari status pesanan.
    const paymentStatus = map.paidTime.length
      ? cell(map.paidTime)
        ? 'paid'
        : 'unpaid'
      : normalizeStatusBayar(cellOf(row, ['Status Bayar']));

    const line: ParsedSalesLine = {
      row: nomorBaris,
      orderNumber,
      externalOrderNo,
      createdAt,
      channel:
        options.channelCode ||
        map.channelCode ||
        resolveChannelCode(cell(map.channel), channelByName),
      sku,
      barcode,
      name: nama || produk?.name || sku,
      qty,
      price,
      paymentStatus,
      orderStatus: normalizeStatusOrder(cell(map.orderStatus)),
      paymentMethod: map.paymentMethod.length ? mapPaymentMethod(cell(map.paymentMethod)) : 'other',
      customerName: cell(map.customerName) || null,
      productId: produk?.id ?? null,
      costPrice: Number(produk?.cost_price ?? 0),
    };

    const list = grouped.get(orderNumber) ?? [];
    list.push(line);
    grouped.set(orderNumber, list);
  }

  const orders = [...grouped.entries()].map(([orderNumber, lines]) => ({
    orderNumber,
    lines,
    total: lines.reduce((sum, l) => sum + l.qty * l.price, 0),
  }));

  return {
    orders,
    duplicates: [...duplicates],
    issues,
    totalRows,
    layout: map.layout,
    layoutLabel: map.label,
    unmatched,
  };
}

/**
 * Berkas contoh: judul kolom dan dua baris isian.
 *
 * Baris keduanya sengaja memakai nomor pesanan yang sama dengan baris pertama,
 * karena begitulah cara menulis satu pesanan berisi dua barang — hal yang
 * paling sering ditanyakan dan tidak terlihat kalau contohnya hanya satu baris.
 */
export function buildSalesTemplateRows(): string[][] {
  return [
    [...SALES_COLUMNS],
    // Nomornya sengaja dibuat jelas-jelas contoh. Memakai nomor pesanan yang
    // menyerupai aslinya membuat baris contoh ini bentrok dengan pesanan
    // sungguhan dan ditolak sebagai duplikat saat template diunggah balik.
    [
      '#CONTOH-001', 'CONTOH-PLATFORM-001', '02/09/2026 19:34', 'Shopee',
      'GB-415-41F-BLACK', '', 'Gear Belakang Yamaha Fizr', '1', '195000', '195000',
      'Lunas', 'Selesai', 'Budi Santoso',
    ],
    [
      '#CONTOH-001', 'CONTOH-PLATFORM-001', '02/09/2026 19:34', 'Shopee',
      'RANTAI-415-130', '', 'Rantai 415-130 L', '1', '125000', '125000',
      'Lunas', 'Selesai', 'Budi Santoso',
    ],
  ];
}

/** Bentuk CSV dari template, dengan penanda pemisah untuk Excel Indonesia. */
export function buildSalesTemplate(): string {
  const baris = buildSalesTemplateRows().map((r) => r.join(';'));
  return `sep=;\r\n${baris.join('\r\n')}\r\n`;
}

/**
 * Tulis rencana impor ke aplikasi.
 *
 * Stok sengaja tidak disentuh, dan tidak ada mutasi stok yang dibuat: ini
 * pencatatan riwayat penjualan, bukan transaksi baru.
 */
export async function runSalesImport(
  plan: SalesImportPlan,
  storeId: string,
): Promise<SalesImportResult> {
  const api = getBackendClient();
  const online = navigator.onLine;
  const serverErrors: string[] = [];

  const orders: Order[] = [];
  const items: OrderItem[] = [];

  for (const grup of plan.orders) {
    const orderId = uuid();
    const pertama = grup.lines[0];
    const subtotal = grup.total;
    const lunas = pertama.paymentStatus === 'paid';

    orders.push({
      id: orderId,
      store_id: storeId,
      customer_id: null,
      customer_name: pertama.customerName,
      cashier_id: null,
      order_number: grup.orderNumber,
      subtotal,
      tax: 0,
      discount: 0,
      total: subtotal,
      payment_method: pertama.paymentMethod,
      payment_status: pertama.paymentStatus,
      order_status: pertama.orderStatus,
      order_type: 'take_away',
      table_number: null,
      notes: 'Impor penjualan massal',
      created_at: pertama.createdAt,
      promo_code: null,
      received_amount: lunas ? subtotal : 0,
      change_amount: 0,
      points_earned: 0,
      shift_id: null,
      sales_channel: pertama.channel,
      payment_term: lunas ? 'cash' : 'tempo',
      due_date: null,
      paid_amount: lunas ? subtotal : 0,
      settled_at: lunas ? pertama.createdAt : null,
      original_total: null,
      adjustment_amount: 0,
      adjustment_note: null,
      adjusted_at: null,
      adjusted_by: null,
      external_order_no: pertama.externalOrderNo,
    });

    for (const l of grup.lines) {
      items.push({
        id: uuid(),
        order_id: orderId,
        product_id: l.productId,
        name: l.name,
        size: null,
        qty: l.qty,
        price: l.price,
        cost_price: l.costPrice,
        note: null,
      });
    }
  }

  // Server dulu, baru lokal. Kalau server menolak, layar tidak menampilkan
  // pesanan yang sebenarnya tidak pernah tersimpan.
  if (online && orders.length) {
    const CHUNK = 200;
    for (let i = 0; i < orders.length; i += CHUNK) {
      const { error } = await api.from('orders').insert(orders.slice(i, i + CHUNK));
      if (error) {
        serverErrors.push(`orders: ${error.message}`);
        return { orders: 0, items: 0, serverErrors };
      }
    }
    for (let i = 0; i < items.length; i += CHUNK) {
      const { error } = await api.from('order_items').insert(items.slice(i, i + CHUNK));
      if (error) {
        serverErrors.push(`order_items: ${error.message}`);
        break;
      }
    }
  }

  await db.orders.bulkPut(orders);
  await db.order_items.bulkPut(items);

  return { orders: orders.length, items: items.length, serverErrors };
}
