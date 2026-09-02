// Retur Pesanan berbasis Nomor Pemesanan.
//
// Sesuai permintaan client, acuan utama retur adalah NOMOR PEMESANAN, bukan id
// internal. Kasir mengetik nomor yang tertera di struk atau di nota
// marketplace, lalu memilih barang mana yang dikembalikan.
//
// Satu retur menyentuh tiga hal sekaligus, dan ketiganya harus konsisten:
//   1. catatan retur beserta barisnya,
//   2. stok, untuk barang yang masih layak jual,
//   3. laporan, karena nilai refund memotong pendapatan.

import { db } from './db';
import { getBackendClient } from './api';
import { isUuid } from './format';
import type { Order, OrderItem, OrderReturn, OrderReturnItem, Product, StockMovement } from '@/types';

export interface ReturnDraftLine {
  order_item_id: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Qty yang dikembalikan. Nol berarti baris ini tidak diretur. */
  qty: number;
  /** Qty pada pesanan asli — batas atas yang boleh diretur. */
  max_qty: number;
  refund_price: number;
  /** Barang layak jual kembali ke stok; barang rusak tidak. */
  restock: boolean;
  note: string;
}

export interface OrderLookup {
  order: Order;
  items: OrderItem[];
  /** Qty yang sudah pernah diretur sebelumnya, per id item pesanan. */
  returnedByItem: Map<string, number>;
}

/** Samakan bentuk nomor pesanan supaya "#260812-..." dan "260812-..." cocok. */
export function normalizeOrderNumber(value: string): string {
  return value.trim().replace(/^#/, '').toUpperCase();
}

/**
 * Cari pesanan berdasarkan nomor pemesanan.
 *
 * Nomor pesanan platform (mis. nomor Shopee) ikut dicocokkan, karena barang
 * yang diretur pembeli marketplace biasanya dirujuk dengan nomor itu.
 */
export async function findOrderByNumber(
  storeId: string,
  rawNumber: string,
): Promise<OrderLookup | null> {
  const needle = normalizeOrderNumber(rawNumber);
  if (!needle) return null;

  const orders = await db.orders.where('store_id').equals(storeId).toArray();
  const order =
    orders.find((row) => normalizeOrderNumber(row.order_number ?? '') === needle) ??
    orders.find((row) => normalizeOrderNumber(row.external_order_no ?? '') === needle) ??
    null;
  if (!order) return null;

  const items = await db.order_items.where('order_id').equals(order.id).toArray();

  // Hitung yang sudah pernah diretur supaya satu barang tidak bisa diretur
  // melebihi yang dibeli.
  const previous = await db.order_returns.where('order_id').equals(order.id).toArray();
  const returnedByItem = new Map<string, number>();
  if (previous.length) {
    const lines = await db.order_return_items
      .where('return_id')
      .anyOf(previous.map((r) => r.id))
      .toArray();
    for (const line of lines) {
      const key = line.product_id ?? line.name;
      returnedByItem.set(key, (returnedByItem.get(key) ?? 0) + Number(line.qty || 0));
    }
  }

  return { order, items, returnedByItem };
}

/** Ubah pesanan yang ditemukan jadi baris draf retur, qty awal nol. */
export function buildDraftLines(found: OrderLookup): ReturnDraftLine[] {
  return found.items.map((item) => {
    const key = item.product_id ?? item.name;
    const sisa = Number(item.qty || 0) - (found.returnedByItem.get(key) ?? 0);
    return {
      order_item_id: item.id,
      product_id: item.product_id ?? null,
      name: item.name,
      sku: null,
      barcode: null,
      qty: 0,
      max_qty: Math.max(0, sisa),
      refund_price: Number(item.price || 0),
      restock: true,
      note: '',
    };
  });
}

export function refundTotal(lines: ReturnDraftLine[]): number {
  return lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.refund_price || 0), 0);
}

/** Pesan error draf, atau null bila sudah sah. */
export function validateDraft(lines: ReturnDraftLine[]): string | null {
  const dipilih = lines.filter((l) => Number(l.qty || 0) > 0);
  if (!dipilih.length) return 'Pilih minimal satu barang dengan qty lebih dari nol.';
  for (const l of dipilih) {
    if (Number(l.qty) > l.max_qty) {
      return `${l.name}: qty retur ${l.qty} melebihi sisa yang bisa diretur (${l.max_qty}).`;
    }
    if (Number(l.refund_price) < 0) return `${l.name}: nilai refund tidak boleh negatif.`;
  }
  return null;
}

export interface SaveReturnArgs {
  storeId: string;
  order: Order;
  lines: ReturnDraftLine[];
  reason: string;
  actorId?: string | null;
}

/**
 * Simpan retur: catatan retur, barisnya, lalu stok untuk barang yang layak jual.
 *
 * Server ditulis lebih dulu saat online. Kalau server menolak, tidak ada apa pun
 * yang tersimpan di lokal — supaya layar tidak menampilkan retur yang sebenarnya
 * tidak pernah tercatat.
 */
export async function saveOrderReturn(args: SaveReturnArgs): Promise<OrderReturn> {
  const dipilih = args.lines.filter((l) => Number(l.qty || 0) > 0);
  const now = new Date().toISOString();
  const returnId = crypto.randomUUID();

  const header: OrderReturn = {
    id: returnId,
    store_id: args.storeId,
    order_id: args.order.id,
    order_number: args.order.order_number,
    refund_amount: refundTotal(dipilih),
    reason: args.reason.trim() || null,
    // Kolom ini punya foreign key ke profiles; id demo yang bukan UUID ditolak
    // Postgres, jadi disaring lebih dulu.
    created_by: isUuid(args.actorId) ? (args.actorId as string) : null,
    created_at: now,
  };

  const rows: OrderReturnItem[] = dipilih.map((l) => ({
    id: crypto.randomUUID(),
    return_id: returnId,
    product_id: l.product_id,
    name: l.name,
    sku: l.sku,
    barcode: l.barcode,
    qty: Number(l.qty),
    refund_price: Number(l.refund_price),
    restock: Boolean(l.restock),
    note: l.note.trim() || null,
  }));

  const online = navigator.onLine;
  const api = getBackendClient();

  if (online) {
    const { error: headErr } = await api.from('order_returns').insert(header);
    if (headErr) throw headErr;
    const { error: itemErr } = await api.from('order_return_items').insert(rows);
    if (itemErr) throw itemErr;
  }

  await db.order_returns.put(header);
  await db.order_return_items.bulkPut(rows);

  // Kembalikan stok hanya untuk barang yang ditandai layak jual.
  const movements: StockMovement[] = [];
  for (const row of rows) {
    if (!row.restock || !row.product_id) continue;
    const product = await db.products.get(row.product_id);
    if (!product) continue;
    const newQty = Number(product.stock_qty ?? 0) + Number(row.qty);
    const movement: StockMovement = {
      id: crypto.randomUUID(),
      store_id: args.storeId,
      product_id: row.product_id,
      type: 'refund',
      qty_delta: Number(row.qty),
      reason: `Retur pesanan ${header.order_number}`,
      ref_order_id: args.order.id,
      created_at: now,
    };
    movements.push(movement);
    await db.products.put({ ...(product as Product), stock_qty: newQty });
    if (online) {
      await api.from('products').update({ stock_qty: newQty }).eq('id', row.product_id);
    }
  }
  if (movements.length) {
    await db.stock_movements.bulkPut(movements);
    if (online) await api.from('stock_movements').insert(movements);
  }

  return header;
}
