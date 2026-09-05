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
