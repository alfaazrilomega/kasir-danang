// Impor penjualan massal.
//
// Client memasukkan penjualan lama (mis. Juli–Agustus) yang datanya berasal dari
// nomor pesanan marketplace. Kolomnya dibuat SAMA PERSIS dengan hasil ekspor
// Riwayat Transaksi, jadi client cukup mengekspor sekali untuk melihat
// bentuknya, mengisi, lalu mengunggah balik — tidak perlu belajar format baru.
//
// Satu pesanan boleh punya banyak baris: nomor pesanan diulang di tiap baris,
// dan baris bernomor sama digabung menjadi satu pesanan.
//
// PENTING: impor ini TIDAK menyentuh stok. Datanya penjualan yang sudah lewat,
// sedangkan stok di aplikasi adalah angka hari ini. Mengurangi stok di sini
// justru membuatnya salah.

import { db } from './db';
import { getBackendClient } from './api';
import { parseCsv } from './dataTransfer';
import { uuid } from './format';
import type { Order, OrderItem, PaymentMethod, Product } from '@/types';

/** Kolom yang dikenali, mengikuti judul kolom ekspor Riwayat Transaksi. */
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
] as const;

const WAJIB = ['No. Pesanan', 'Tanggal', 'Qty', 'Harga Satuan'];

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
 * Terima "dd/mm/yyyy", "dd/mm/yyyy HH:mm", dan ISO.
 * Format pertama yang dipakai ekspor kita.
 */
function parseDate(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const id = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(raw);
  if (id) {
    const [, d, m, y, hh, mm] = id;
    const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function normalizeStatusBayar(value: string): 'paid' | 'unpaid' {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 'paid';
  return ['belum bayar', 'unpaid', 'belum', 'tempo', 'piutang'].includes(v) ? 'unpaid' : 'paid';
}

function normalizeStatusOrder(value: string): 'done' | 'canceled' {
  const v = String(value ?? '').trim().toLowerCase();
  return ['dibatalkan', 'canceled', 'cancelled', 'batal'].includes(v) ? 'canceled' : 'done';
}

/** Ubah label channel ("Shopee Official") jadi kodenya ("shopee"). */
function resolveChannelCode(label: string, byName: Map<string, string>): string {
  const raw = String(label ?? '').trim();
  if (!raw) return 'offline';
  const lower = raw.toLowerCase();
  return byName.get(lower) ?? lower.replace(/\s+/g, '-');
}

/**
 * Baca berkas dan susun rencana impor, tanpa menulis apa pun.
 *
 * Baris bermasalah dilaporkan beserta nomor barisnya dan TIDAK ikut masuk,
 * supaya satu sel yang salah tidak menggagalkan seluruh berkas.
 */
export async function planSalesImport(text: string, storeId: string): Promise<SalesImportPlan> {
  const rows = parseCsv(text);
  const issues: SalesIssue[] = [];
  if (rows.length < 2) {
    return { orders: [], duplicates: [], issues: [{ row: 0, message: 'Berkas kosong.' }], totalRows: 0 };
  }

  const header = rows[0].map((h) => h.trim());
  const kurang = WAJIB.filter((k) => !header.includes(k));
  if (kurang.length) {
    return {
      orders: [],
      duplicates: [],
      issues: [{ row: 1, message: `Kolom wajib tidak ada: ${kurang.join(', ')}.` }],
      totalRows: 0,
    };
  }
  const idx = (name: string) => header.indexOf(name);

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

  const grouped = new Map<string, ParsedSalesLine[]>();
  const duplicates = new Set<string>();
  let totalRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const nomorBaris = i + 1; // baris 1 adalah judul kolom
    const cell = (name: string) => (idx(name) >= 0 ? (rows[i][idx(name)] ?? '').trim() : '');
    const orderNumber = cell('No. Pesanan');
    if (!orderNumber) {
      issues.push({ row: nomorBaris, message: 'No. Pesanan kosong, baris dilewati.' });
      continue;
    }
    totalRows++;

    if (nomorAda.has(orderNumber.toUpperCase())) {
      duplicates.add(orderNumber);
      continue;
    }

    const createdAt = parseDate(cell('Tanggal'));
    if (!createdAt) {
      issues.push({ row: nomorBaris, message: `Tanggal "${cell('Tanggal')}" tidak dikenali.` });
      continue;
    }

    const qty = parseNumber(cell('Qty'));
    if (qty === null || qty <= 0) {
      issues.push({ row: nomorBaris, message: `Qty "${cell('Qty')}" bukan angka lebih dari nol.` });
      continue;
    }

    const price = parseNumber(cell('Harga Satuan'));
    if (price === null || price < 0) {
      issues.push({ row: nomorBaris, message: `Harga Satuan "${cell('Harga Satuan')}" bukan angka.` });
      continue;
    }

    const sku = cell('SKU');
    const barcode = cell('Barcode');
    const nama = cell('Nama Produk');
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
      issues.push({
        row: nomorBaris,
        message: `Produk "${sku || nama}" tidak ada di katalog — baris tetap dicatat tanpa tautan produk.`,
      });
    }

    const line: ParsedSalesLine = {
      row: nomorBaris,
      orderNumber,
      externalOrderNo: cell('No. Pesanan Platform') || null,
      createdAt,
      channel: resolveChannelCode(cell('Channel'), channelByName),
      sku,
      barcode,
      name: nama || produk?.name || sku,
      qty,
      price,
      paymentStatus: normalizeStatusBayar(cell('Status Bayar')),
      orderStatus: normalizeStatusOrder(cell('Status Order')),
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

  return { orders, duplicates: [...duplicates], issues, totalRows };
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
      cashier_id: null,
      order_number: grup.orderNumber,
      subtotal,
      tax: 0,
      discount: 0,
      total: subtotal,
      // Penjualan lama tidak menyimpan metode bayarnya; dicatat 'other' supaya
      // tidak mengaku-ngaku tunai dan mengacaukan rekap metode pembayaran.
      payment_method: 'other' as PaymentMethod,
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
