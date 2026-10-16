// Resolusi SKU: dari kode apa pun (SKU internal, barcode, atau SKU platform)
// ke produk internal.
//
// Satu produk punya SATU SKU internal, tetapi tiap marketplace memakai kode
// barangnya sendiri (cth. SKU internal "WR155 520-13T" tayang di TikTok sebagai
// "GD-WR520-13T"). Pesanan yang masuk dari marketplace hanya menyebut SKU milik
// platform, jadi tabel pemetaan inilah yang menerjemahkannya jadi produk
// internal supaya stoknya bisa dikurangi.
//
// resolveProductByExternalSku() dan resolveProductsByExternalSkus() adalah
// titik sambung untuk adapter API Shopee/TikTok di fase berikutnya.
//
// Modul ini sengaja bebas React dan bebas jaringan (Dexie saja) supaya tetap
// jalan saat offline dan gampang diuji.

import { db } from './db';
import type { Product, ProductChannelMapping } from '@/types';

export type SkuMatchKind = 'sku' | 'barcode' | 'channel_sku';

export interface SkuResolution {
  product: Product;
  matchedBy: SkuMatchKind;
  /** Terisi hanya ketika kecocokan berasal dari SKU platform. */
  mapping: ProductChannelMapping | null;
}

/**
 * Normalisasi untuk perbandingan kode.
 * Indeks Dexie bersifat case-sensitive sedangkan unique index Postgres memakai
 * lower(), jadi normalizer inilah yang menjaga keduanya konsisten.
 */
export function normalizeSku(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Kunci gabungan channel + SKU platform. */
function channelKey(channelCode: string, externalSku: string): string {
  return `${normalizeSku(channelCode)}|${normalizeSku(externalSku)}`;
}

export interface ChannelSkuIndex {
  /** "SHOPEE|SHP-ABC-0001" -> mapping */
  byCode: Map<string, ProductChannelMapping>;
  /** "SHP-ABC-0001" -> mapping (channel apa pun, untuk scanner) */
  byAnyCode: Map<string, ProductChannelMapping>;
  /** product_id -> semua mapping-nya */
  byProduct: Map<string, ProductChannelMapping[]>;
}

/**
 * Indeks in-memory supaya komponen React tidak perlu await ke Dexie tiap
 * ketikan atau tiap render.
 */
export function buildChannelSkuIndex(rows: ProductChannelMapping[]): ChannelSkuIndex {
  const byCode = new Map<string, ProductChannelMapping>();
  const byAnyCode = new Map<string, ProductChannelMapping>();
  const byProduct = new Map<string, ProductChannelMapping[]>();

  for (const row of rows) {
    const sku = normalizeSku(row.external_sku);
    if (!sku) continue;
    byCode.set(channelKey(row.channel_code, sku), row);
    // Yang pertama menang: scanner tidak boleh berubah hasil hanya karena
    // urutan baris berbeda antar-sync.
    if (!byAnyCode.has(sku)) byAnyCode.set(sku, row);
    const list = byProduct.get(row.product_id);
    if (list) list.push(row);
    else byProduct.set(row.product_id, [row]);
  }

  return { byCode, byAnyCode, byProduct };
}

/** Semua mapping milik satu toko. */
async function mappingsForStore(storeId: string): Promise<ProductChannelMapping[]> {
  return db.product_channel_mappings.where('store_id').equals(storeId).toArray();
}

/**
 * Cari produk internal dari (channel, SKU platform).
 * Ini seam untuk adapter API marketplace.
 */
export async function resolveProductByExternalSku(
  storeId: string,
  channelCode: string,
  externalSku: string,
): Promise<SkuResolution | null> {
  const target = normalizeSku(externalSku);
  if (!target) return null;

  const rows = await db.product_channel_mappings
    .where('[store_id+channel_code]')
    .equals([storeId, channelCode])
    .toArray();

  const mapping = rows.find((row) => normalizeSku(row.external_sku) === target);
  if (!mapping) return null;

  const product = await db.products.get(mapping.product_id);
  if (!product) return null;

  return { product, matchedBy: 'channel_sku', mapping };
}

/**
 * Versi batch: satu pesanan marketplace berisi banyak baris item, jadi adapter
 * API sebaiknya memanggil ini sekali daripada resolveProductByExternalSku
 * berkali-kali.
 * Key hasil adalah SKU platform yang sudah dinormalisasi.
 */
export async function resolveProductsByExternalSkus(
  storeId: string,
  channelCode: string,
  externalSkus: string[],
): Promise<Map<string, SkuResolution>> {
  const out = new Map<string, SkuResolution>();
  const wanted = new Set(externalSkus.map(normalizeSku).filter(Boolean));
  if (!wanted.size) return out;

  const rows = await db.product_channel_mappings
    .where('[store_id+channel_code]')
    .equals([storeId, channelCode])
    .toArray();

  const matched = rows.filter((row) => wanted.has(normalizeSku(row.external_sku)));
  if (!matched.length) return out;

  const products = await db.products.bulkGet(matched.map((row) => row.product_id));
  matched.forEach((mapping, i) => {
    const product = products[i];
    if (!product) return;
    out.set(normalizeSku(mapping.external_sku), { product, matchedBy: 'channel_sku', mapping });
  });

  return out;
}

/**
 * Lookup gabungan untuk POS / scanner.
 * Urutan: SKU internal -> barcode -> SKU platform (channel apa pun).
 * Urutan ini disengaja supaya hasil scan barang fisik selalu deterministik:
 * kode yang tercetak di barang selalu menang atas kode milik marketplace.
 */
export async function resolveProductByAnyCode(
  storeId: string,
  code: string,
): Promise<SkuResolution | null> {
  const target = normalizeSku(code);
  if (!target) return null;

  const products = await db.products.where('store_id').equals(storeId).toArray();

  const bySku = products.find((p) => normalizeSku(p.sku) === target);
  if (bySku) return { product: bySku, matchedBy: 'sku', mapping: null };

  const byBarcode = products.find((p) => normalizeSku(p.barcode) === target);
  if (byBarcode) return { product: byBarcode, matchedBy: 'barcode', mapping: null };

  const index = buildChannelSkuIndex(await mappingsForStore(storeId));
  const mapping = index.byAnyCode.get(target);
  if (!mapping) return null;

  const product = products.find((p) => p.id === mapping.product_id);
  if (!product) return null;

  return { product, matchedBy: 'channel_sku', mapping };
}

// --- Validasi keunikan (dipakai form produk) --------------------------------
// Wajib dijalankan di sisi klien: /api/query menelan error database, jadi
// pelanggaran unique index Postgres TIDAK akan muncul sebagai error.

/** Produk lain yang sudah memakai SKU internal ini, kalau ada. */
export function findSkuConflict(
  sku: string,
  products: Product[],
  selfId?: string,
): Product | null {
  const target = normalizeSku(sku);
  if (!target) return null;
  return products.find((p) => p.id !== selfId && normalizeSku(p.sku) === target) ?? null;
}

/** Mapping lain yang sudah memakai SKU platform ini di channel yang sama. */
export function findExternalSkuConflict(
  channelCode: string,
  externalSku: string,
  mappings: Pick<ProductChannelMapping, 'id' | 'channel_code' | 'external_sku'>[],
  selfMappingId?: string,
): Pick<ProductChannelMapping, 'id' | 'channel_code' | 'external_sku'> | null {
  const targetSku = normalizeSku(externalSku);
  const targetChannel = normalizeSku(channelCode);
  if (!targetSku || !targetChannel) return null;
  return (
    mappings.find(
      (m) =>
        m.id !== selfMappingId &&
        normalizeSku(m.channel_code) === targetChannel &&
        normalizeSku(m.external_sku) === targetSku,
    ) ?? null
  );
}
