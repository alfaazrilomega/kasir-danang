// Impor hasil hitung fisik ke sesi Stock Opname.
//
// Client menghitung stok fisik di gudang lalu mencatatnya di kertas atau
// spreadsheet sendiri — mengetik ulang satu per satu ke 50+ baris di layar
// adalah pekerjaan berulang yang gampang salah. Berkas hasil hitung itu
// diunggah langsung, dan kolomnya dibuat sama dengan hasil Export CSV di
// halaman ini, jadi client bisa mengunduh, mengisi kolom Hitung Fisik, lalu
// mengunggah baliknya.

import { db } from './db';
import { readSpreadsheet } from './spreadsheet';
import type { Product, StockOpnameItem } from '@/types';

/** Kolom yang dikenali; sama dengan hasil Export CSV halaman ini. */
export const OPNAME_IMPORT_COLUMNS = ['SKU', 'Barcode', 'Nama Produk', 'Hitung Fisik'] as const;

export interface OpnameImportRow {
  row: number;
  productId: string;
  productName: string;
  sku: string;
  systemQty: number;
  countedQty: number;
}

export interface OpnameImportIssue {
  row: number;
  message: string;
}

export interface OpnameImportPlan {
  rows: OpnameImportRow[];
  issues: OpnameImportIssue[];
  totalRows: number;
}

function parseNumber(value: string): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Susun rencana impor dari isi berkas dan item sesi yang sedang dibuka.
 *
 * Pencocokan lewat SKU, bukan nama produk — nama bisa mengandung koma atau
 * berubah, sedangkan SKU adalah kunci yang sudah dipakai di seluruh aplikasi
 * untuk mencocokkan barang.
 */
export function planOpnameImport(
  fileRows: string[][],
  sessionItems: StockOpnameItem[],
  products: Product[],
): OpnameImportPlan {
  const issues: OpnameImportIssue[] = [];
  if (fileRows.length < 2) {
    return { rows: [], issues: [{ row: 0, message: 'Berkas kosong.' }], totalRows: 0 };
  }

  const header = fileRows[0].map((h) => h.trim());
  const idxSku = header.findIndex((h) => h.toLowerCase() === 'sku');
  const idxHitung = header.findIndex((h) => h.toLowerCase() === 'hitung fisik');
  if (idxSku < 0 || idxHitung < 0) {
    return {
      rows: [],
      issues: [{ row: 1, message: 'Kolom "SKU" dan "Hitung Fisik" wajib ada.' }],
      totalRows: 0,
    };
  }

  const productBySku = new Map(
    products.filter((p) => p.sku).map((p) => [p.sku!.trim().toUpperCase(), p]),
  );
  const itemByProductId = new Map(sessionItems.map((i) => [i.product_id, i]));

  const rows: OpnameImportRow[] = [];
  let totalRows = 0;

  for (let i = 1; i < fileRows.length; i++) {
    const line = fileRows[i];
    if (!line.some((c) => String(c ?? '').trim())) continue; // baris kosong
    const nomorBaris = i + 1;
    totalRows++;

    const sku = String(line[idxSku] ?? '').trim();
    if (!sku) {
      issues.push({ row: nomorBaris, message: 'SKU kosong, baris dilewati.' });
      continue;
    }

    const produk = productBySku.get(sku.toUpperCase());
    if (!produk) {
      issues.push({ row: nomorBaris, message: `SKU "${sku}" tidak ada di katalog.` });
      continue;
    }

    const item = itemByProductId.get(produk.id);
    if (!item) {
      issues.push({
        row: nomorBaris,
        message: `"${produk.name}" tidak ada dalam sesi opname yang sedang dibuka.`,
      });
      continue;
    }

    const counted = parseNumber(String(line[idxHitung] ?? ''));
    if (counted === null) {
      issues.push({ row: nomorBaris, message: `Hitung Fisik "${line[idxHitung]}" bukan angka.` });
      continue;
    }
    if (counted < 0) {
      issues.push({ row: nomorBaris, message: 'Hitung Fisik tidak boleh negatif.' });
      continue;
    }

    rows.push({
      row: nomorBaris,
      productId: produk.id,
      productName: produk.name,
      sku,
      systemQty: Number(item.system_qty),
      countedQty: counted,
    });
  }

  return { rows, issues, totalRows };
}

/** Baca berkas (CSV atau XLSX) dan langsung susun rencananya. */
export async function planOpnameImportFromFile(
  file: File,
  sessionItems: StockOpnameItem[],
  products: Product[],
): Promise<OpnameImportPlan> {
  const rows = await readSpreadsheet(file);
  return planOpnameImport(rows, sessionItems, products);
}
