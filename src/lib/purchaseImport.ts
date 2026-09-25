// Baca berkas templat item nota pembelian (PO): sku, nama, qty, harga_beli,
// catatan -- supaya nota yang berisi belasan item tidak perlu diketik satu
// per satu (permintaan client: "di proses pembuatan po bisa uplod templete").
//
// SKU di berkas dicocokkan ke katalog produk lewat findSkuConflict, yang
// secara internal sudah memakai normalizeSku untuk perbandingannya. SKU yang
// tidak ketemu TETAP masuk sebagai baris item -- persis seperti "item manual"
// yang sudah ada di form nota sekarang -- dan jumlahnya dilaporkan supaya
// tidak didiamkan begitu saja.
//
// Modul ini hanya MEMBACA berkas dan menyusun baris siap pakai. Yang menaruh
// hasilnya ke form.items (dan yang menyimpan ke database) adalah Purchases.tsx
// sendiri, supaya pengguna masih bisa mengoreksi tiap baris sebelum disimpan.

import { toCsv } from './dataTransfer';
import { readSpreadsheet } from './spreadsheet';
import { findSkuConflict, normalizeSku } from './skuLookup';
import type { Product } from '@/types';

/** Kolom berkas templat item PO, berurutan -- kontrak dengan pengguna. */
export const PURCHASE_ITEM_COLUMNS = ['sku', 'nama', 'qty', 'harga_beli', 'catatan'] as const;

export interface PurchaseImportRow {
  /** Nomor baris seperti terlihat di Excel (baris judul dihitung baris 1). */
  row: number;
  /** Terisi hanya kalau SKU di berkas cocok dengan produk yang sudah ada. */
  productId: string | null;
  name: string;
  sku: string;
  barcode: string;
  qty: number;
  costPrice: number;
  note: string;
}

export interface PurchaseImportReport {
  rows: PurchaseImportRow[];
  /** Baris berisi yang berhasil dibaca (baris kosong tidak dihitung). */
  totalRows: number;
  /** Baris yang SKU-nya cocok ke produk. */
  matchedCount: number;
  /** SKU di berkas yang tidak dikenal katalog, urut kemunculan, tanpa duplikat. */
  unknownSkus: string[];
  /** Baris tanpa qty (atau qty <= 0); tetap masuk dengan nilai 0 supaya bisa dibetulkan di form. */
  missingQty: number;
  /** Baris tanpa harga beli (atau <= 0); tetap masuk dengan nilai 0 supaya bisa dibetulkan di form. */
  missingPrice: number;
}

/** Berkas contoh untuk diunduh pengguna, satu baris contoh diisi. */
export function buildPurchaseTemplate(): string {
  const contoh = [['GD-WR155-13T', 'Gear Depan WR155 520 13T', '10', '120000', '']];
  return toCsv([...PURCHASE_ITEM_COLUMNS], contoh);
}

/** "175.000" / "175000" / "175,000.50" -> angka. Kosong atau tidak valid -> 0. */
function bacaAngka(value: string): number {
  const raw = value.trim();
  if (!raw) return 0;
  const bersih = raw
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = Number(bersih);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Baca tabel baris-kolom (hasil parseCsv maupun readXlsx lewat readSpreadsheet)
 * jadi daftar item nota plus laporan pencocokan SKU.
 *
 * Baris judul dikenali dari nama kolomnya; kalau tidak ketemu, kolom dibaca
 * berdasar urutan tetap (sku, nama, qty, harga_beli, catatan) supaya berkas
 * tanpa judul kolom tetap bisa dibaca.
 */
export function readPurchaseImportRows(table: string[][], products: Product[]): PurchaseImportReport {
  if (!table.length) {
    return { rows: [], totalRows: 0, matchedCount: 0, unknownSkus: [], missingQty: 0, missingPrice: 0 };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const adaJudul = PURCHASE_ITEM_COLUMNS.some((c) => header.includes(c));
  const badan = adaJudul ? table.slice(1) : table;
  const posisi: Record<(typeof PURCHASE_ITEM_COLUMNS)[number], number> = {
    sku: adaJudul ? header.indexOf('sku') : 0,
    nama: adaJudul ? header.indexOf('nama') : 1,
    qty: adaJudul ? header.indexOf('qty') : 2,
    harga_beli: adaJudul ? header.indexOf('harga_beli') : 3,
    catatan: adaJudul ? header.indexOf('catatan') : 4,
  };
  const ambil = (baris: string[], kolom: keyof typeof posisi) => {
    const i = posisi[kolom];
    return i >= 0 ? String(baris[i] ?? '').trim() : '';
  };

  const rows: PurchaseImportRow[] = [];
  const unknownSkus: string[] = [];
  const sudahDilaporkan = new Set<string>();
  let matchedCount = 0;
  let missingQty = 0;
  let missingPrice = 0;

  badan.forEach((baris, i) => {
    if (!baris.some((sel) => String(sel ?? '').trim() !== '')) return; // baris kosong dilewati
    const lineNo = adaJudul ? i + 2 : i + 1;

    const skuMentah = ambil(baris, 'sku');
    const nama = ambil(baris, 'nama');
    const qty = bacaAngka(ambil(baris, 'qty'));
    const costPrice = bacaAngka(ambil(baris, 'harga_beli'));
    const note = ambil(baris, 'catatan');

    if (qty <= 0) missingQty++;
    if (costPrice <= 0) missingPrice++;

    const produk = skuMentah ? findSkuConflict(skuMentah, products) : null;
    if (produk) {
      matchedCount++;
    } else if (skuMentah) {
      // Dedup pakai normalizeSku supaya SKU yang sama tidak dilaporkan
      // berkali-kali hanya karena beda kapitalisasi atau muncul di banyak baris.
      const kunci = normalizeSku(skuMentah);
      if (!sudahDilaporkan.has(kunci)) {
        sudahDilaporkan.add(kunci);
        unknownSkus.push(skuMentah);
      }
    }

    rows.push({
      row: lineNo,
      productId: produk?.id ?? null,
      name: nama || produk?.name || skuMentah || `Baris ${lineNo}`,
      sku: produk?.sku ?? skuMentah,
      barcode: produk?.barcode ?? '',
      qty,
      costPrice,
      note,
    });
  });

  return { rows, totalRows: rows.length, matchedCount, unknownSkus, missingQty, missingPrice };
}

/** Baca berkas unggahan (.csv atau .xlsx) langsung jadi laporan siap pakai. */
export async function readPurchaseImportFile(file: File, products: Product[]): Promise<PurchaseImportReport> {
  const table = await readSpreadsheet(file);
  return readPurchaseImportRows(table, products);
}
