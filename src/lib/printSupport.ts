// Data tambahan untuk cetak faktur yang tidak tersimpan di baris pesanan.
import { db } from '@/lib/db';
import type { OrderItem } from '@/types';

/**
 * SKU per product_id untuk faktur A4. order_items hanya menyimpan nama dan
 * harga saat transaksi, jadi SKU dibaca dari produknya.
 */
export async function skuMapFor(items: OrderItem[]): Promise<Record<string, string>> {
  const ids = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
  if (!ids.length) return {};
  const products = await db.products.bulkGet(ids);
  const out: Record<string, string> = {};
  for (const p of products) if (p?.sku) out[p.id] = p.sku;
  return out;
}
