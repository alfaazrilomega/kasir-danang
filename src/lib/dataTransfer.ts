// Impor & ekspor massal data master (kategori, produk, SKU platform).
//
// Dipakai untuk serah terima ke client: client mengisi satu berkas CSV berisi
// seluruh produknya, lalu diimpor sekali jalan menggantikan data contoh.
//
// Prinsip yang dipegang di sini:
//   1. VALIDASI DULU, tulis belakangan. Berkas diperiksa seluruhnya dan
//      dilaporkan per nomor baris sebelum satu baris pun masuk database.
//   2. Kategori dan SKU platform ikut dalam SATU berkas, karena client tidak
//      seharusnya mengurus tabel relasi.
//   3. Hasil ekspor bisa diimpor ulang apa adanya (round-trip).

import { db } from './db';
import { buildCsv } from './csvFormat';
import { getBackendClient } from './api';
import { uuid } from './format';
import type { Category, Product, ProductChannelMapping, ProductComponent } from '@/types';

/** Kolom berkas CSV produk, berurutan. Ini kontrak dengan client. */
export const PRODUCT_COLUMNS = [
  'sku',
  'barcode',
  'nama_produk',
  'kategori',
  'deskripsi',
  'url_foto',
  'harga_jual',
  'harga_modal',
  'stok',
  'stok_minimum',
  'lacak_stok',
  'aktif',
  'sku_shopee',
  'sku_tiktok',
  'sku_tokopedia',
  'sku_website',
  // Opsional: berkas lama tanpa kolom di bawah ini tetap bisa diimpor.
  'berat_gram',
  'panjang_cm',
  'lebar_cm',
  'tinggi_cm',
  // SKU isi set dipisah koma, akhiran " x2" untuk jumlah lebih dari satu.
  // Koma dipilih karena SKU set client sendiri memakai tanda "+".
  'isi_set',
  // Opsional: tampilan toko online (merek, label variasi, harga coret).
  'merek',
  'nama_variasi',
  'harga_coret',
] as const;

/** Channel yang punya kolom SKU sendiri di CSV. */
const CHANNEL_COLUMNS: { column: string; code: string }[] = [
  { column: 'sku_shopee', code: 'shopee' },
  { column: 'sku_tiktok', code: 'tiktok' },
  { column: 'sku_tokopedia', code: 'tokopedia' },
  { column: 'sku_website', code: 'website' },
];

export type ImportMode = 'replace' | 'merge';

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportPlan {
  mode: ImportMode;
  toCreate: number;
  toUpdate: number;
  categories: string[];
  channelSkus: number;
  issues: ImportIssue[];
  rows: ParsedProduct[];
  /** Jumlah produk yang akan dihapus bila mode replace dijalankan. */
  willDelete: number;
  /** Jumlah produk set (baris dengan isi_set). */
  sets: number;
}

export interface ParsedProduct {
  row: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  description: string | null;
  /** Alamat gambar produk; foto diambil dari web, bukan diunggah. */
  imageUrl: string | null;
  basePrice: number;
  costPrice: number;
  stockQty: number;
  minStock: number;
  trackStock: boolean;
  isActive: boolean;
  channelSkus: { code: string; sku: string }[];
  /** null = kolom kosong: nilai lama dipertahankan saat mode gabung. */
  weightGram: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** null = isi set tidak diubah. Terisi = isi set diganti utuh. */
  setItems: { sku: string; qty: number }[] | null;
  /** null = kolom kosong: nilai lama dipertahankan saat mode gabung. */
  brand: string | null;
  variantName: string | null;
  compareAtPrice: number | null;
}

// --- CSV primitif ----------------------------------------------------------

/**
 * Pembaca CSV yang menangani tanda kutip, koma di dalam nilai, baris baru di
 * dalam sel, BOM, dan akhir baris Windows. Sengaja tidak memakai split(',')
 * karena berkas dari Excel hampir selalu mengandung ketiganya.
 */
/**
 * Tebak pemisah dari baris judul: yang paling sering muncul di luar tanda
 * kutip. Wajib satu pemisah saja — kalau ',' dan ';' sama-sama diterima,
 * nama produk seperti "Gear Depan, Racing" ikut terpotong jadi dua kolom.
 */
function sniffDelimiter(text: string): string {
  let quoted = false;
  let semi = 0;
  let comma = 0;
  for (const c of text) {
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '\n') break;
    if (c === ';') semi++;
    else if (c === ',') comma++;
  }
  return semi >= comma && semi > 0 ? ';' : ',';
}

export function parseCsv(text: string): string[][] {
  // Buang BOM, lalu lewati baris petunjuk `sep=;` yang kita tulis sendiri di
  // awal berkas ekspor (Excel memakainya untuk menentukan pemisah kolom).
  // Tanpa ini baris itu terbaca sebagai judul kolom dan berkas hasil ekspor
  // sendiri jadi tidak bisa diimpor ulang.
  const noBom = text.replace(/^﻿/, '');
  const hint = /^sep=(.)\r?\n/i.exec(noBom);
  const clean = hint ? noBom.slice(hint[0].length) : noBom;
  const delimiter = hint ? hint[1] : sniffDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        value += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(value); value = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(value); rows.push(row); row = []; value = ''; continue; }
    value += c;
  }
  if (value.length || row.length) { row.push(value); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // Delegasi ke format bersama supaya template & ekspor modal ini memakai
  // aturan yang sama dengan ekspor lain: pemisah titik koma + baris sep=
  // agar Excel Indonesia langsung memisah kolom dengan benar.
  return buildCsv(headers, rows);
}

/** BOM ditambahkan supaya Excel membuka UTF-8 dengan benar. */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Template --------------------------------------------------------------

/** Berkas contoh untuk diserahkan ke client, lengkap dengan 3 baris contoh. */
export function buildProductTemplate(): string {
  const examples = [
    ['GD-WR155-13T', '8991234567890', 'Gear Depan WR155 520 13T', 'Gear & Rantai',
      'Gear depan racing 13 mata', 'https://contoh.com/foto/gd-wr155.jpg',
      '175000', '120000', '25', '5', 'ya', 'ya',
      'SHP-GD-WR155-13T', 'TT-GD-WR155-13T', 'TKPD-GD-WR155-13T', 'WEB-GD-WR155-13T',
      '100', '', '', '', '', 'GNNK Racing', '13T', ''],
    ['SET-CRF-RED', '8991234567891', 'Gear Set Honda CRF150 520 Red', 'Gear & Rantai',
      '', 'https://contoh.com/foto/set-crf.jpg', '450000', '320000', '10', '2',
      'ya', 'ya', 'SET-CRF-RED', '', '', '', '', '', '', '', 'GD-WR155-13T', 'GNNK Racing', 'Red', '480000'],
    ['OLI-MPX-1L', '', 'Oli Mesin MPX 1 Liter', 'Pelumas', '', '', '55000', '42000',
      '100', '20', 'ya', 'ya', '', '', '', '', '', '', '', '', '', 'MPX', '', ''],
  ];
  return toCsv([...PRODUCT_COLUMNS], examples);
}

// --- Validasi & rencana impor ---------------------------------------------

/**
 * Terima alamat foto hanya bila benar-benar alamat web.
 *
 * Berkas dari Excel sering memuat sisa rumus atau teks seperti "-" di kolom
 * yang dikosongkan. Menyimpannya apa adanya membuat gambar produk gagal muat
 * tanpa sebab yang jelas, jadi yang bukan http/https diperlakukan kosong.
 */
function bacaUrlFoto(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : null;
}

function parseBoolean(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return ['ya', 'yes', 'true', '1', 'aktif', 'y'].includes(v);
}

function parseNumber(value: string): number | null {
  const raw = value.trim();
  if (!raw) return 0;
  // Terima "175.000", "175000", "175,000.50" — buang pemisah ribuan.
  const normalized = raw.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Periksa seluruh berkas dan susun rencana impor.
 * Tidak menulis apa pun — hasilnya ditampilkan ke pengguna untuk dikonfirmasi.
 */
export async function planProductImport(
  csvText: string,
  storeId: string,
  mode: ImportMode,
): Promise<ImportPlan> {
  const table = parseCsv(csvText);
  const issues: ImportIssue[] = [];
  const rows: ParsedProduct[] = [];

  if (!table.length) {
    return { mode, toCreate: 0, toUpdate: 0, categories: [], channelSkus: 0, willDelete: 0, sets: 0,
      issues: [{ row: 0, message: 'Berkas kosong.' }], rows: [] };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = ['sku', 'nama_produk', 'harga_jual'].filter((c) => !header.includes(c));
  if (missing.length) {
    return { mode, toCreate: 0, toUpdate: 0, categories: [], channelSkus: 0, willDelete: 0, sets: 0,
      issues: [{ row: 1, message: `Kolom wajib tidak ada: ${missing.join(', ')}. Gunakan berkas template.` }],
      rows: [] };
  }
  const col = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };

  const seenSku = new Map<string, number>();
  const categories = new Set<string>();
  let channelSkus = 0;

  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const lineNo = i + 1; // nomor baris seperti terlihat di Excel
    const sku = get(r, 'sku');
    const name = get(r, 'nama_produk');

    if (!sku) { issues.push({ row: lineNo, message: 'SKU kosong.' }); continue; }
    if (!name) { issues.push({ row: lineNo, message: `SKU ${sku}: nama produk kosong.` }); continue; }

    const dupAt = seenSku.get(sku.toUpperCase());
    if (dupAt) {
      issues.push({ row: lineNo, message: `SKU ${sku} kembar dengan baris ${dupAt}.` });
      continue;
    }
    seenSku.set(sku.toUpperCase(), lineNo);

    const basePrice = parseNumber(get(r, 'harga_jual'));
    const costPrice = parseNumber(get(r, 'harga_modal'));
    const stockQty = parseNumber(get(r, 'stok'));
    const minStock = parseNumber(get(r, 'stok_minimum'));
    if (basePrice === null) { issues.push({ row: lineNo, message: `SKU ${sku}: harga jual bukan angka.` }); continue; }
    if (costPrice === null) { issues.push({ row: lineNo, message: `SKU ${sku}: harga modal bukan angka.` }); continue; }
    if (stockQty === null) { issues.push({ row: lineNo, message: `SKU ${sku}: stok bukan angka.` }); continue; }
    if (minStock === null) { issues.push({ row: lineNo, message: `SKU ${sku}: stok minimum bukan angka.` }); continue; }
    if (basePrice < 0 || costPrice < 0) { issues.push({ row: lineNo, message: `SKU ${sku}: harga tidak boleh negatif.` }); continue; }

    const category = get(r, 'kategori') || 'Tanpa Kategori';
    categories.add(category);

    const channelList: { code: string; sku: string }[] = [];
    for (const c of CHANNEL_COLUMNS) {
      const v = get(r, c.column);
      if (v) { channelList.push({ code: c.code, sku: v }); channelSkus++; }
    }

    const ukuran: Record<'berat_gram' | 'panjang_cm' | 'lebar_cm' | 'tinggi_cm', number | null> = {
      berat_gram: null,
      panjang_cm: null,
      lebar_cm: null,
      tinggi_cm: null,
    };
    let ukuranSalah = false;
    for (const [kolom, label] of [
      ['berat_gram', 'berat'],
      ['panjang_cm', 'panjang'],
      ['lebar_cm', 'lebar'],
      ['tinggi_cm', 'tinggi'],
    ] as const) {
      const v = get(r, kolom);
      if (!v) continue;
      const n = parseNumber(v);
      if (n === null || n < 0) {
        issues.push({ row: lineNo, message: `SKU ${sku}: ${label} bukan angka.` });
        ukuranSalah = true;
      } else {
        ukuran[kolom] = Math.round(n);
      }
    }
    if (ukuranSalah) continue;

    const isiText = get(r, 'isi_set');
    let setItems: { sku: string; qty: number }[] | null = null;
    if (isiText) {
      setItems = [];
      let isiSalah = false;
      for (const bagian of isiText.split(',').map((x) => x.trim()).filter(Boolean)) {
        const m = /^(.+?)\s+[x×]\s*(\d+(?:[.,]\d+)?)$/i.exec(bagian);
        const qty = m ? Number(m[2].replace(',', '.')) : 1;
        if (!(qty > 0)) {
          issues.push({ row: lineNo, message: `SKU ${sku}: jumlah isi set "${bagian}" tidak valid.` });
          isiSalah = true;
          break;
        }
        setItems.push({ sku: (m ? m[1] : bagian).trim(), qty });
      }
      if (isiSalah) continue;
    }

    const coretText = get(r, 'harga_coret');
    const hargaCoret = coretText ? parseNumber(coretText) : null;
    if (coretText && (hargaCoret === null || hargaCoret < 0)) {
      issues.push({ row: lineNo, message: `SKU ${sku}: harga coret bukan angka.` });
      continue;
    }

    rows.push({
      row: lineNo,
      sku,
      barcode: get(r, 'barcode') || null,
      name,
      category,
      description: get(r, 'deskripsi') || null,
      imageUrl: bacaUrlFoto(get(r, 'url_foto')),
      basePrice,
      costPrice,
      stockQty,
      minStock,
      trackStock: parseBoolean(get(r, 'lacak_stok'), true),
      isActive: parseBoolean(get(r, 'aktif'), true),
      channelSkus: channelList,
      weightGram: ukuran.berat_gram,
      lengthCm: ukuran.panjang_cm,
      widthCm: ukuran.lebar_cm,
      heightCm: ukuran.tinggi_cm,
      setItems,
      brand: get(r, 'merek') || null,
      variantName: get(r, 'nama_variasi') || null,
      compareAtPrice: hargaCoret,
    });
  }

  // Bandingkan dengan isi sekarang untuk menghitung tambah vs perbarui.
  const existing = await db.products.where('store_id').equals(storeId).toArray();
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku!.toUpperCase(), p]));

  // Isi set dicek terhadap produk di berkas dan produk yang sudah ada, dengan
  // aturan yang sama seperti database (migrasi 019): isinya harus ada, bukan
  // dirinya sendiri, dan hanya satu tingkat (set tidak berisi set).
  const komponenLama = await db.product_components.where('store_id').equals(storeId).toArray();
  const idSetLama = new Set(komponenLama.map((c) => c.parent_product_id));
  const idIsiLama = new Set(komponenLama.map((c) => c.component_product_id));
  const diBerkas = new Map(rows.map((r) => [r.sku.toUpperCase(), r]));
  const setDiBerkas = new Set(rows.filter((r) => r.setItems?.length).map((r) => r.sku.toUpperCase()));
  const sah: ParsedProduct[] = [];
  for (const r of rows) {
    if (r.setItems?.length) {
      const salah: string[] = [];
      const lamaInduk = bySku.get(r.sku.toUpperCase());
      if (lamaInduk && idIsiLama.has(lamaInduk.id)) salah.push('produk ini sudah dipakai sebagai isi set lain');
      for (const it of r.setItems) {
        const key = it.sku.toUpperCase();
        const lama = bySku.get(key);
        if (key === r.sku.toUpperCase()) salah.push(`${it.sku} adalah produk ini sendiri`);
        else if (!diBerkas.has(key) && !lama) salah.push(`${it.sku} tidak ada di katalog maupun di berkas`);
        else if (setDiBerkas.has(key) || (lama && idSetLama.has(lama.id))) salah.push(`${it.sku} adalah produk set`);
      }
      if (salah.length) {
        issues.push({ row: r.row, message: `SKU ${r.sku}: isi set tidak valid (${salah.join('; ')}).` });
        continue;
      }
    }
    sah.push(r);
  }
  rows.length = 0;
  rows.push(...sah);

  let toUpdate = 0;
  for (const r of rows) if (bySku.has(r.sku.toUpperCase())) toUpdate++;

  return {
    mode,
    toCreate: rows.length - toUpdate,
    toUpdate,
    categories: [...categories],
    channelSkus,
    issues,
    rows,
    willDelete: mode === 'replace' ? existing.length : 0,
    sets: rows.filter((r) => r.setItems?.length).length,
  };
}

export interface ImportResult {
  products: number;
  categories: number;
  channelSkus: number;
  deleted: number;
  /** Produk lama yang masih dirujuk riwayat: dinonaktifkan, bukan dihapus. */
  archived: number;
  /** Produk set yang isinya ditulis dari kolom isi_set. */
  sets: number;
  serverErrors: string[];
}

/**
 * Jalankan impor sesuai rencana.
 * Mode 'replace' menghapus seluruh produk & mapping toko ini lebih dulu;
 * mode 'merge' mencocokkan berdasarkan SKU.
 */
export async function runProductImport(
  plan: ImportPlan,
  storeId: string,
): Promise<ImportResult> {
  const api = getBackendClient();
  const online = navigator.onLine;
  const serverErrors: string[] = [];
  let deleted = 0;
  let archived = 0;

  const existingProducts = await db.products.where('store_id').equals(storeId).toArray();
  const existingCategories = await db.categories.where('store_id').equals(storeId).toArray();
  const existingMappings = await db.product_channel_mappings.where('store_id').equals(storeId).toArray();

  // --- kategori: pakai yang sudah ada, buat yang belum ---
  const catByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]));
  const newCategories: Category[] = [];
  for (const name of plan.categories) {
    if (catByName.has(name.toLowerCase())) continue;
    const cat: Category = {
      id: uuid(),
      store_id: storeId,
      name,
      icon: null,
      sort_order: catByName.size + newCategories.length + 1,
    };
    newCategories.push(cat);
    catByName.set(name.toLowerCase(), cat);
  }

  // --- produk ---
  const bySku = new Map(existingProducts.filter((p) => p.sku).map((p) => [p.sku!.toUpperCase(), p]));
  const products: Product[] = plan.rows.map((r) => {
    const prev = bySku.get(r.sku.toUpperCase());
    return {
      // Id dipakai ulang saat SKU-nya sama, termasuk pada mode replace:
      // mengganti id memutus tautan penjualan lama ke produknya.
      id: prev?.id ?? uuid(),
      store_id: storeId,
      category_id: catByName.get(r.category.toLowerCase())?.id ?? null,
      name: r.name,
      description: r.description,
      // Foto dari berkas menang; kalau kosong, foto lama dipertahankan pada
      // mode gabung supaya impor harga tidak menghapus gambar yang sudah ada.
      image_url: r.imageUrl ?? (plan.mode === 'merge' ? prev?.image_url ?? null : null),
      base_price: r.basePrice,
      sizes: plan.mode === 'merge' ? prev?.sizes ?? [] : [],
      is_active: r.isActive,
      sku: r.sku,
      barcode: r.barcode,
      cost_price: r.costPrice,
      stock_qty: r.stockQty,
      min_stock: r.minStock,
      track_stock: r.trackStock,
      weight_gram: r.weightGram ?? prev?.weight_gram ?? 0,
      length_cm: r.lengthCm ?? prev?.length_cm ?? 0,
      width_cm: r.widthCm ?? prev?.width_cm ?? 0,
      height_cm: r.heightCm ?? prev?.height_cm ?? 0,
      brand: r.brand ?? prev?.brand ?? null,
      variant_name: r.variantName ?? prev?.variant_name ?? null,
      compare_at_price: r.compareAtPrice ?? prev?.compare_at_price ?? 0,
      images: prev?.images ?? [],
    };
  });

  const productBySku = new Map(products.map((p) => [p.sku!.toUpperCase(), p]));
  const mappings: ProductChannelMapping[] = [];
  for (const r of plan.rows) {
    const product = productBySku.get(r.sku.toUpperCase());
    if (!product) continue;
    for (const c of r.channelSkus) {
      mappings.push({
        id: uuid(),
        store_id: storeId,
        product_id: product.id,
        channel_code: c.code,
        external_sku: c.sku,
        external_url: null,
        is_synced: false,
        last_synced_at: null,
      });
    }
  }

  // --- mode replace: hapus yang aman, arsipkan yang masih dipakai ---
  //
  // products.id dirujuk order_items dan purchase_items dengan
  // 'on delete set null'. Menghapus produk yang pernah terjual membuat
  // penjualan lamanya kehilangan tautan produk secara permanen, dan laporan
  // per-SKU jadi kosong. Jadi produk yang masih dirujuk riwayat tidak dihapus,
  // melainkan dinonaktifkan supaya hilang dari kasir tapi riwayatnya utuh.
  if (plan.mode === 'replace') {
    const orderItems = await db.order_items.toArray();
    const purchaseItems = await db.purchase_items.toArray();
    const referenced = new Set<string>();
    for (const it of orderItems) if (it.product_id) referenced.add(it.product_id);
    for (const it of purchaseItems) if (it.product_id) referenced.add(it.product_id);
    // Barang yang dipakai sebagai isi set dijaga 'on delete restrict' oleh
    // database, jadi harus diarsipkan, bukan dihapus.
    const komponenSet = await db.product_components.where('store_id').equals(storeId).toArray();
    for (const c of komponenSet) referenced.add(c.component_product_id);

    const keptIds = new Set(products.map((p) => p.id));
    const obsolete = existingProducts.filter((p) => !keptIds.has(p.id));

    // Cache perangkat hanya memuat pesanan terbaru, jadi produk yang hanya
    // terjual di pesanan lama tidak terlihat dipakai dan akan ikut terhapus.
    // Saat online rujukan dicek ke server. Kalau pengecekan gagal, produknya
    // dianggap masih dipakai (diarsipkan, bukan dihapus) supaya riwayat
    // penjualan tidak pernah putus.
    if (online && obsolete.length) {
      const ids = obsolete.map((p) => p.id);
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        for (const table of ['order_items', 'purchase_items']) {
          const { data, error } = await api.from(table).select('product_id').in('product_id', chunk);
          if (error) {
            for (const id of chunk) referenced.add(id);
            continue;
          }
          for (const r of (data ?? []) as { product_id: string | null }[]) {
            if (r.product_id) referenced.add(r.product_id);
          }
        }
        const { data: isi, error: errIsi } = await api
          .from('product_components')
          .select('component_product_id')
          .in('component_product_id', chunk);
        if (errIsi) for (const id of chunk) referenced.add(id);
        else for (const r of (isi ?? []) as { component_product_id: string }[]) referenced.add(r.component_product_id);
      }
    }


    for (const p of obsolete) {
      if (referenced.has(p.id)) {
        const arsip = { ...p, is_active: false };
        if (online) {
          const { error } = await api.from('products').update({ is_active: false }).eq('id', p.id);
          if (error) serverErrors.push(`arsipkan produk ${p.sku ?? p.id}: ${error.message}`);
        }
        await db.products.put(arsip);
        archived++;
      } else {
        // Produk ini benar-benar dibuang, jadi SKU platformnya ikut dibuang.
        for (const m of existingMappings.filter((x) => x.product_id === p.id)) {
          if (online) {
            const { error } = await api.from('product_channel_mappings').delete().eq('id', m.id);
            if (error) serverErrors.push(`hapus mapping: ${error.message}`);
          }
          await db.product_channel_mappings.delete(m.id);
        }
        if (online) {
          const { error } = await api.from('products').delete().eq('id', p.id);
          if (error) serverErrors.push(`hapus produk ${p.sku ?? p.id}: ${error.message}`);
        }
        await db.products.delete(p.id);
        deleted++;
      }
    }
  } else {
    // merge: buang mapping lama milik produk yang diperbarui saja
    const touched = new Set(products.map((p) => p.id));
    for (const m of existingMappings.filter((x) => touched.has(x.product_id))) {
      if (online) await api.from('product_channel_mappings').delete().eq('id', m.id);
      await db.product_channel_mappings.delete(m.id);
    }
  }

  // --- tulis, urutan aman terhadap foreign key ---
  const push = async (tableName: string, rows: unknown[]) => {
    if (!rows.length || !online) return;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await api.from(tableName).upsert(rows.slice(i, i + CHUNK));
      if (error) { serverErrors.push(`${tableName}: ${error.message}`); break; }
    }
  };

  await push('categories', newCategories);
  await db.categories.bulkPut(newCategories);

  await push('products', products);
  await db.products.bulkPut(products);

  await push('product_channel_mappings', mappings);
  await db.product_channel_mappings.bulkPut(mappings);

  // --- isi set: diganti utuh untuk tiap baris yang kolom isi_set-nya diisi ---
  const semuaBySku = new Map(bySku);
  for (const p of products) semuaBySku.set(p.sku!.toUpperCase(), p);
  const komponenLama = await db.product_components.where('store_id').equals(storeId).toArray();
  const komponenBaru: ProductComponent[] = [];
  let sets = 0;
  for (const r of plan.rows) {
    if (!r.setItems?.length) continue;
    const induk = productBySku.get(r.sku.toUpperCase());
    if (!induk) continue;
    for (const lama of komponenLama.filter((c) => c.parent_product_id === induk.id)) {
      if (online) {
        const { error } = await api.from('product_components').delete().eq('id', lama.id);
        if (error) serverErrors.push(`hapus isi set ${r.sku}: ${error.message}`);
      }
      await db.product_components.delete(lama.id);
    }
    for (const it of r.setItems) {
      const isi = semuaBySku.get(it.sku.toUpperCase());
      if (!isi) continue;
      komponenBaru.push({
        id: uuid(),
        store_id: storeId,
        parent_product_id: induk.id,
        component_product_id: isi.id,
        qty: it.qty,
      });
    }
    sets++;
  }
  if (online) {
    for (let i = 0; i < komponenBaru.length; i += 200) {
      const { error } = await api.from('product_components').insert(komponenBaru.slice(i, i + 200));
      if (error) {
        serverErrors.push(`isi set: ${error.message}`);
        break;
      }
    }
  }
  await db.product_components.bulkPut(komponenBaru);

  return {
    products: products.length,
    categories: newCategories.length,
    channelSkus: mappings.length,
    deleted,
    archived,
    sets,
    serverErrors,
  };
}

// --- Ekspor ----------------------------------------------------------------

/** Ekspor produk ke CSV dengan bentuk yang sama persis dengan template. */
export async function exportProductsCsv(storeId: string): Promise<number> {
  const products = await db.products.where('store_id').equals(storeId).toArray();
  const categories = await db.categories.where('store_id').equals(storeId).toArray();
  const mappings = await db.product_channel_mappings.where('store_id').equals(storeId).toArray();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const komponen = await db.product_components.where('store_id').equals(storeId).toArray();
  const skuById = new Map(products.map((p) => [p.id, p.sku ?? '']));
  const isiSetText = (productId: string) =>
    komponen
      .filter((c) => c.parent_product_id === productId)
      .map((c) => `${skuById.get(c.component_product_id) ?? ''}${Number(c.qty) !== 1 ? ` x${Number(c.qty)}` : ''}`)
      .join(', ');

  const mapFor = (productId: string, code: string) =>
    mappings.find((m) => m.product_id === productId && m.channel_code === code)?.external_sku ?? '';

  const rows = products
    .slice()
    .sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? ''))
    .map((p) => [
      p.sku ?? '',
      p.barcode ?? '',
      p.name,
      catName.get(p.category_id ?? '') ?? '',
      p.description ?? '',
      p.image_url ?? '',
      p.base_price,
      p.cost_price,
      p.stock_qty,
      p.min_stock,
      p.track_stock ? 'ya' : 'tidak',
      p.is_active ? 'ya' : 'tidak',
      mapFor(p.id, 'shopee'),
      mapFor(p.id, 'tiktok'),
      mapFor(p.id, 'tokopedia'),
      mapFor(p.id, 'website'),
      p.weight_gram ?? 0,
      p.length_cm ?? 0,
      p.width_cm ?? 0,
      p.height_cm ?? 0,
      isiSetText(p.id),
      p.brand ?? '',
      p.variant_name ?? '',
      p.compare_at_price ?? 0,
    ]);

  downloadFile(
    `produk-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv([...PRODUCT_COLUMNS], rows),
    'text/csv',
  );
  return rows.length;
}

function sqlText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Ekspor SQL untuk serah terima teknis / pindah server.
 * Memakai ON CONFLICT DO UPDATE supaya aman dijalankan ulang.
 */
export async function exportProductsSql(storeId: string): Promise<number> {
  const products = await db.products.where('store_id').equals(storeId).toArray();
  const categories = await db.categories.where('store_id').equals(storeId).toArray();
  const mappings = await db.product_channel_mappings.where('store_id').equals(storeId).toArray();

  const lines: string[] = [
    '-- Ekspor data master TokoKu',
    `-- Dibuat: ${new Date().toISOString()}`,
    `-- Toko  : ${storeId}`,
    '--',
    '-- Jalankan dengan: psql -U kasir_user -d kasir -f berkas-ini.sql',
    '-- Aman dijalankan ulang (ON CONFLICT DO UPDATE).',
    'begin;',
    '',
  ];

  for (const c of categories) {
    lines.push(
      `insert into public.categories(id,store_id,name,icon,sort_order) values ` +
      `(${sqlText(c.id)},${sqlText(c.store_id)},${sqlText(c.name)},${sqlText(c.icon)},${c.sort_order}) ` +
      `on conflict (id) do update set name=excluded.name, icon=excluded.icon, sort_order=excluded.sort_order;`,
    );
  }
  lines.push('');
  for (const p of products) {
    lines.push(
      `insert into public.products(id,store_id,category_id,name,description,image_url,base_price,sizes,is_active,sku,barcode,cost_price,stock_qty,min_stock,track_stock) values ` +
      `(${sqlText(p.id)},${sqlText(p.store_id)},${sqlText(p.category_id)},${sqlText(p.name)},${sqlText(p.description)},${sqlText(p.image_url)},${p.base_price},${sqlText(JSON.stringify(p.sizes ?? []))}::jsonb,${p.is_active},${sqlText(p.sku)},${sqlText(p.barcode)},${p.cost_price},${p.stock_qty},${p.min_stock},${p.track_stock}) ` +
      `on conflict (id) do update set name=excluded.name, base_price=excluded.base_price, cost_price=excluded.cost_price, stock_qty=excluded.stock_qty, min_stock=excluded.min_stock, is_active=excluded.is_active, sku=excluded.sku, barcode=excluded.barcode, category_id=excluded.category_id;`,
    );
  }
  lines.push('');
  for (const m of mappings) {
    lines.push(
      `insert into public.product_channel_mappings(id,store_id,product_id,channel_code,external_sku,external_url,is_synced) values ` +
      `(${sqlText(m.id)},${sqlText(m.store_id)},${sqlText(m.product_id)},${sqlText(m.channel_code)},${sqlText(m.external_sku)},${sqlText(m.external_url)},${m.is_synced}) ` +
      `on conflict (id) do update set external_sku=excluded.external_sku, external_url=excluded.external_url;`,
    );
  }
  lines.push('', 'commit;', '');

  downloadFile(
    `data-master-${new Date().toISOString().slice(0, 10)}.sql`,
    lines.join('\n'),
    'application/sql',
  );
  return products.length + categories.length + mappings.length;
}
