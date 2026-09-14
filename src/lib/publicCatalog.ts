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

export function kelompokkanVarian(products: PublicCatalogProduct[]): KelompokProduk[] {
  const map = new Map<string, PublicCatalogProduct[]>();
  for (const p of products) {
    const k = p.name.trim().toLowerCase();
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

/**
 * Lokasi toko di kartu produk (seperti "Kota Jakarta Barat" di Lazada). Selama
 * belum diisi di Pengaturan > Toko Online, tampil contoh sementara.
 */
export const LOKASI_CONTOH = 'Kota Jakarta Barat';

export function lokasiToko(store: { shop_city?: string | null } | null | undefined): string {
  return store?.shop_city?.trim() || LOKASI_CONTOH;
}
