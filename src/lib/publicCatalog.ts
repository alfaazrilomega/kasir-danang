// Katalog untuk storefront publik (tanpa login). Sengaja TIDAK lewat
// pullCustomerCatalog/KasirApiClient — itu lewat /api/query yang menolak
// permintaan tanpa token sesi. Endpoint ini (GET /api/public/catalog) tidak
// butuh sesi sama sekali, jadi hasilnya disimpan di state komponen biasa,
// bukan ditulis ke Dexie bersama (menghindari data publik bercampur dengan
// cache lokal milik staff yang mungkin login di browser yang sama).

import { loadConfig } from './config';

export interface PublicCatalogProduct {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: number;
  category_id: string | null;
  track_stock: boolean;
  stock_qty: number;
  weight_gram?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  /** Jumlah terjual dari pesanan yang selesai. */
  sold_qty?: number;
  brand?: string | null;
  variant_name?: string | null;
  parent_sku?: string | null;
  compare_at_price?: number;
  rating_avg?: number;
  rating_count?: number;
}

export interface PublicCatalogCategory {
  id: string;
  name: string;
}

export interface PublicCatalogStore {
  id: string;
  name: string;
  currency: string;
  logo_url: string | null;
  shop_phone?: string | null;
  pdp_banner_url?: string | null;
  shop_city?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  qris_image_url?: string | null;
}

export interface PublicCatalogData {
  store: PublicCatalogStore | null;
  categories: PublicCatalogCategory[];
  products: PublicCatalogProduct[];
}

const EMPTY: PublicCatalogData = { store: null, categories: [], products: [] };

let cached: { storeId: string; promise: Promise<PublicCatalogData> } | null = null;

/** Dipanggil dari beberapa komponen (shell + halaman); permintaan dibagi lewat cache modul sederhana. */
export function fetchPublicCatalog(storeId: string): Promise<PublicCatalogData> {
  if (cached && cached.storeId === storeId) return cached.promise;
  const { apiBaseUrl } = loadConfig();
  const promise = fetch(`${apiBaseUrl}/api/public/catalog?store_id=${encodeURIComponent(storeId)}`)
    .then(async (response) => {
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as { data?: PublicCatalogData; error?: string }) : null;
      if (!response.ok) throw new Error(payload?.error || 'Gagal memuat katalog.');
      return payload?.data ?? EMPTY;
    })
    .catch((err) => {
      cached = null;
      throw err;
    });
  cached = { storeId, promise };
  return promise;
}

/**
 * Produk aktif bernama sama dianggap satu produk dengan beberapa variasi,
 * seperti satu listing di marketplace. Kartu katalog memakai wakilnya (yang
 * masih ada stok dan termurah) dengan rentang harga seluruh variasi.
 */
export interface KelompokProduk {
  key: string;
  wakil: PublicCatalogProduct;
  anggota: PublicCatalogProduct[];
  hargaMin: number;
  hargaMax: number;
  terjual: number;
  ratingAvg: number;
  ratingCount: number;
  habis: boolean;
}

/**
 * Kunci yang menyatukan varian satu produk.
 *
 * SKU Induk dipakai lebih dulu karena nama produk tidak cukup: di katalog
 * client ada dua produk bernama sama persis dengan SKU Induk berbeda
 * (GEAR-BLKNG-FIZR dan GEAR-BLKNG-FIZR-BLAC), dan menyamakan keduanya
 * menghasilkan satu produk berisi 17 varian campur warna. Produk lama yang
 * SKU Induknya belum diisi tetap dikelompokkan lewat nama seperti sebelumnya.
 */
export function kunciKelompok(p: { name: string; parent_sku?: string | null }): string {
  const induk = (p.parent_sku ?? '').trim();
  return induk ? 'induk:' + induk.toLowerCase() : 'nama:' + p.name.trim().toLowerCase();
}

/**
 * Produk yang ditawarkan sebagai tambahan di keranjang dan checkout.
 *
 * Dipilih dari kategori yang sama dengan isi keranjang lebih dulu, karena yang
 * paling sering dibeli bersamaan di toko ini adalah barang serumpun (gear depan
 * dengan rantai, misalnya). Kalau belum cukup, dilengkapi produk terlaris toko.
 *
 * Yang sudah ada di keranjang dan yang stoknya habis tidak pernah ditawarkan —
 * menawarkan barang habis membuat pembeli menekan tombol yang langsung gagal.
 */
export function tawaranTambahan(
  products: PublicCatalogProduct[],
  idDiKeranjang: string[],
  maks = 4,
): PublicCatalogProduct[] {
  const dipakai = new Set(idDiKeranjang);
  const tersedia = products.filter(
    (p) => !dipakai.has(p.id) && !(p.track_stock && Number(p.stock_qty ?? 0) <= 0),
  );
  const kategoriKeranjang = new Set(
    products.filter((p) => dipakai.has(p.id)).map((p) => p.category_id ?? ''),
  );
  const laris = (a: PublicCatalogProduct, b: PublicCatalogProduct) =>
    Number(b.sold_qty ?? 0) - Number(a.sold_qty ?? 0);

  const serumpun = tersedia
    .filter((p) => kategoriKeranjang.has(p.category_id ?? ''))
    .sort(laris);
  const sisanya = tersedia
    .filter((p) => !kategoriKeranjang.has(p.category_id ?? ''))
    .sort(laris);

  // Satu varian per kelompok: menawarkan 14 ukuran gear yang sama bukan tawaran,
  // itu daftar.
  const hasil: PublicCatalogProduct[] = [];
  const kelompokDipakai = new Set<string>();
  for (const p of [...serumpun, ...sisanya]) {
    const k = kunciKelompok(p);
    if (kelompokDipakai.has(k)) continue;
    kelompokDipakai.add(k);
    hasil.push(p);
    if (hasil.length >= maks) break;
  }
  return hasil;
}

export function kelompokkanVarian(products: PublicCatalogProduct[]): KelompokProduk[] {
  const map = new Map<string, PublicCatalogProduct[]>();
  for (const p of products) {
    const k = kunciKelompok(p);
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  return [...map.entries()].map(([key, anggota]) => {
    const tersedia = anggota.filter((p) => !(p.track_stock && Number(p.stock_qty ?? 0) <= 0));
    const wakil = [...(tersedia.length ? tersedia : anggota)].sort(
      (a, b) => Number(a.base_price) - Number(b.base_price),
    )[0];
    const harga = anggota.map((p) => Number(p.base_price));
    const ratingCount = anggota.reduce((sum, p) => sum + Number(p.rating_count ?? 0), 0);
    const ratingSum = anggota.reduce((sum, p) => sum + Number(p.rating_avg ?? 0) * Number(p.rating_count ?? 0), 0);
    return {
      key,
      wakil,
      anggota,
      hargaMin: Math.min(...harga),
      hargaMax: Math.max(...harga),
      terjual: anggota.reduce((sum, p) => sum + Number(p.sold_qty ?? 0), 0),
      ratingAvg: ratingCount ? ratingSum / ratingCount : 0,
      ratingCount,
      habis: tersedia.length === 0,
    };
  });
}

export interface PublicVariant {
  id: string;
  sku: string | null;
  variant_name: string | null;
  base_price: number;
  compare_at_price: number;
  track_stock: boolean;
  stock_qty: number;
  image_url: string | null;
}

export interface PublicReview {
  id: string;
  product_id: string;
  reviewer_name: string;
  rating: number;
  body: string | null;
  images: string[];
  variant_label: string | null;
  seller_reply: string | null;
  replied_at: string | null;
  created_at: string;
  tags: string[];
  helpful_count: number;
  /** Pengulas dengan 2 pesanan selesai atau lebih di toko ini. */
  pelanggan_berulang: boolean;
}

export interface PublicProductDetailData {
  store: PublicCatalogStore & {
    shop_phone: string | null;
    return_policy: string | null;
    warranty_info: string | null;
    created_at: string;
    pdp_banner_url: string | null;
    product_count: number;
    rating_count: number;
    positive_count: number;
    total_sold: number;
    repeat_customers: number;
  };
  product: PublicCatalogProduct & {
    sku: string | null;
    images: string[];
    brand: string | null;
    variant_name: string | null;
    compare_at_price: number;
    sold_qty: number;
    spec: { label: string; value: string }[];
    variant_label: string | null;
    warranty_type: string | null;
    warranty_period: string | null;
    box_contents: string | null;
    highlights: string | null;
    license_type: string | null;
    license_code: string | null;
    video_url: string | null;
  };
  variants: PublicVariant[];
  /** Isi paket untuk produk set. */
  components: { name: string; sku: string | null; qty: number }[];
  reviews: PublicReview[];
}

export async function fetchPublicProduct(storeId: string, id: string): Promise<PublicProductDetailData> {
  const { apiBaseUrl } = loadConfig();
  const response = await fetch(
    `${apiBaseUrl}/api/public/product?store_id=${encodeURIComponent(storeId)}&id=${encodeURIComponent(id)}`,
  );
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { data?: PublicProductDetailData; error?: string }) : null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error || 'Gagal memuat produk.');
  return payload.data;
}

/** Tambah satu "Helpful" pada ulasan (satu kali per perangkat dijaga pemanggil). */
export async function tandaiHelpful(reviewId: string): Promise<number | null> {
  const { apiBaseUrl } = loadConfig();
  const response = await fetch(`${apiBaseUrl}/api/public/reviews/${encodeURIComponent(reviewId)}/helpful`, {
    method: 'POST',
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: { helpful_count: number } };
  return payload.data?.helpful_count ?? null;
}

/* =========================================================================
 * Flash sale storefront
 * ========================================================================= */

export interface PublicFlashSale {
  id: string;
  store_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
}

export interface PublicFlashSaleItem {
  product_id: string;
  flash_price: number;
  quota_qty: number | null;
  sold_qty: number;
  name: string;
  image_url: string | null;
  base_price: number;
  stock_qty: number;
}

export interface PublicFlashSaleData {
  flash_sale: PublicFlashSale | null;
  items: PublicFlashSaleItem[];
}

const FLASH_SALE_KOSONG: PublicFlashSaleData = { flash_sale: null, items: [] };

/**
 * Sesi flash sale yang sedang berjalan. Sengaja TIDAK memakai cache modul
 * seperti fetchPublicCatalog: sesinya berubah karena waktu (jendela
 * starts_at/ends_at), jadi tiap kali halaman dibuka datanya harus diambil
 * ulang, bukan dipakai bersama dari permintaan sebelumnya.
 */
export async function fetchPublicFlashSale(storeId: string): Promise<PublicFlashSaleData> {
  const { apiBaseUrl } = loadConfig();
  const response = await fetch(`${apiBaseUrl}/api/public/flash-sale?store_id=${encodeURIComponent(storeId)}`);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { data?: PublicFlashSaleData; error?: string }) : null;
  if (!response.ok) throw new Error(payload?.error || 'Gagal memuat flash sale.');
  return payload?.data ?? FLASH_SALE_KOSONG;
}

/**
 * Server tetap mengirim item yang kuotanya sudah habis (supaya pembeli yang
 * terlanjur melihatnya tidak kehilangan produk dari daftar); klien yang
 * menentukan mana yang masih boleh dianggap flash aktif.
 */
export function itemFlashAktif(item: Pick<PublicFlashSaleItem, 'quota_qty' | 'sold_qty'>): boolean {
  return item.quota_qty === null || Number(item.sold_qty) < Number(item.quota_qty);
}

/** Peta product_id -> item flash aktif, supaya tiap kelompok/produk gampang dicek. */
export function petaFlashAktif(items: PublicFlashSaleItem[]): Map<string, PublicFlashSaleItem> {
  const peta = new Map<string, PublicFlashSaleItem>();
  for (const item of items) {
    if (itemFlashAktif(item)) peta.set(item.product_id, item);
  }
  return peta;
}

export interface FlashKartuInfo {
  hargaFlash: number;
  hargaCoret: number;
}

/**
 * Satu kelompok varian dianggap flash bila ADA anggotanya yang sedang flash
 * aktif. Harga yang dipakai di kartu adalah flash_price TERENDAH di antara
 * anggota aktif itu, dan harga coretnya base_price anggota tersebut (bukan
 * compare_at_price produk) — mengikuti keputusan Task 4.
 */
export function flashUntukKelompok(
  kelompok: KelompokProduk,
  petaFlash: Map<string, PublicFlashSaleItem>,
): FlashKartuInfo | null {
  let terpilih: PublicFlashSaleItem | null = null;
  for (const p of kelompok.anggota) {
    const item = petaFlash.get(p.id);
    if (item && (!terpilih || Number(item.flash_price) < Number(terpilih.flash_price))) terpilih = item;
  }
  return terpilih ? { hargaFlash: Number(terpilih.flash_price), hargaCoret: Number(terpilih.base_price) } : null;
}

/**
 * Lokasi toko di kartu produk (seperti "Kota Jakarta Barat" di Lazada). Selama
 * belum diisi di Pengaturan > Toko Online, tampil contoh sementara.
 */
export const LOKASI_CONTOH = 'Kota Jakarta Barat';

export function lokasiToko(store: { shop_city?: string | null } | null | undefined): string {
  return store?.shop_city?.trim() || LOKASI_CONTOH;
}
