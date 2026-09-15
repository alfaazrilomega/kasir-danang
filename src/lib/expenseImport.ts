// Impor dan ekspor massal pengeluaran (butir 7.1 sheet client).
//
// Client mencatat pengeluaran bulan Juli–Agustus di luar sistem dan ingin
// memasukkannya sekaligus. Kolom impor dibuat sama dengan hasil ekspornya,
// jadi berkas contoh bisa diunduh, diisi, lalu diunggah balik.
//
// Berbeda dengan impor pelanggan: pengeluaran TIDAK punya kunci alami untuk
// dicocokkan (dua pengeluaran bisa sama persis tanggal, kategori, dan
// jumlahnya). Karena itu impor selalu MENAMBAH baris baru, tidak pernah
// menimpa yang lama — mengunggah berkas yang sama dua kali berarti dobel.

import { db } from './db';
import { getBackendClient } from './api';
import { readSpreadsheet } from './spreadsheet';
import { buildCsv, csvFilename, date as fmtDate, downloadCsv, text } from './csvFormat';
import { uuid } from './format';
import { EXPENSE_CATEGORIES } from './expenseCategories';
import type { Expense, ExpenseCategory, ExpensePaymentMethod } from '@/types';

export const EXPENSE_COLUMNS = ['Tanggal', 'Kategori', 'Keterangan', 'Jumlah', 'Metode Bayar'] as const;

const METODE: { value: ExpensePaymentMethod; kata: string[] }[] = [
  { value: 'cash', kata: ['cash', 'tunai'] },
  { value: 'transfer', kata: ['transfer', 'tf', 'bank'] },
  { value: 'card', kata: ['card', 'kartu', 'debit', 'kredit'] },
  { value: 'ewallet', kata: ['ewallet', 'e-wallet', 'dompet digital', 'ovo', 'dana', 'gopay', 'shopeepay', 'qris'] },
  { value: 'other', kata: ['other', 'lainnya', 'lain'] },
];

/** "12.500", "Rp 12.500,00", "12500" → 12500. Koma dianggap desimal. */
export function bacaJumlah(v: string): number {
  const bersih = String(v ?? '')
    .replace(/rp/gi, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = Number(bersih);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** Menerima 2026-07-31, 31/07/2026, atau 31-07-2026. */
export function bacaTanggal(v: string): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const lokal = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (lokal) {
    const [, d, m, y] = lokal;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const tanggal = new Date(s);
  return Number.isNaN(tanggal.getTime()) ? null : tanggal.toISOString().slice(0, 10);
}

function bacaKategori(v: string): ExpenseCategory | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const cocok = EXPENSE_CATEGORIES.find(
    (c) => c.value === s || c.label.toLowerCase() === s || c.label.toLowerCase().replace(/[^a-z]/g, '') === s.replace(/[^a-z]/g, ''),
  );
  return cocok?.value ?? null;
}

function bacaMetode(v: string): ExpensePaymentMethod | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  return METODE.find((m) => m.kata.some((k) => s.includes(k)))?.value ?? null;
}

export interface ExpenseImportRow {
  row: number;
  expense_date: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  payment_method: ExpensePaymentMethod;
}

export interface ExpenseImportIssue {
  row: number;
  message: string;
}

export interface ExpenseImportPlan {
  rows: ExpenseImportRow[];
  issues: ExpenseImportIssue[];
  totalRows: number;
  total: number;
}

export function planExpenseImport(fileRows: string[][]): ExpenseImportPlan {
  const kosong: ExpenseImportPlan = { rows: [], issues: [], totalRows: 0, total: 0 };
  if (fileRows.length < 2) {
    return { ...kosong, issues: [{ row: 0, message: 'Berkas kosong.' }] };
  }

  const header = fileRows[0].map((h) => h.trim().toLowerCase());
  const cari = (...nama: string[]) => header.findIndex((h) => nama.includes(h));
  const idxTanggal = cari('tanggal', 'date');
  const idxJumlah = cari('jumlah', 'nominal', 'amount');
  if (idxTanggal < 0 || idxJumlah < 0) {
    return { ...kosong, issues: [{ row: 1, message: 'Kolom "Tanggal" dan "Jumlah" wajib ada.' }] };
  }
  const idxKategori = cari('kategori', 'category');
  const idxKeterangan = cari('keterangan', 'deskripsi', 'description');
  const idxMetode = cari('metode bayar', 'metode', 'pembayaran', 'payment method');

  const issues: ExpenseImportIssue[] = [];
  const rows: ExpenseImportRow[] = [];
  let totalRows = 0;
  let total = 0;

  for (let i = 1; i < fileRows.length; i++) {
    const line = fileRows[i];
    if (!line.some((c) => String(c ?? '').trim())) continue;
    const nomorBaris = i + 1;
    totalRows++;

    const expense_date = bacaTanggal(String(line[idxTanggal] ?? ''));
    if (!expense_date) {
      issues.push({ row: nomorBaris, message: 'Tanggal tidak terbaca, baris dilewati.' });
      continue;
    }
    const amount = bacaJumlah(String(line[idxJumlah] ?? ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      issues.push({ row: nomorBaris, message: 'Jumlah tidak valid, baris dilewati.' });
      continue;
    }

    const kategoriMentah = idxKategori >= 0 ? String(line[idxKategori] ?? '') : '';
    const category = bacaKategori(kategoriMentah);
    if (kategoriMentah.trim() && !category) {
      issues.push({ row: nomorBaris, message: `Kategori "${kategoriMentah.trim()}" tidak dikenal, dicatat sebagai Lainnya.` });
    }
    const metodeMentah = idxMetode >= 0 ? String(line[idxMetode] ?? '') : '';
    const payment_method = bacaMetode(metodeMentah);
    if (metodeMentah.trim() && !payment_method) {
      issues.push({ row: nomorBaris, message: `Metode bayar "${metodeMentah.trim()}" tidak dikenal, dicatat sebagai Tunai.` });
    }

    total += amount;
    rows.push({
      row: nomorBaris,
      expense_date,
      category: category ?? 'lainnya',
      description: idxKeterangan >= 0 ? String(line[idxKeterangan] ?? '').trim() || null : null,
      amount,
      payment_method: payment_method ?? 'cash',
    });
  }

  return { rows, issues, totalRows, total };
}

export async function planExpenseImportFromFile(file: File): Promise<ExpenseImportPlan> {
  return planExpenseImport(await readSpreadsheet(file));
}

export interface ExpenseImportResult {
  created: number;
  serverErrors: string[];
}

export async function runExpenseImport(plan: ExpenseImportPlan, storeId: string, userId: string | null): Promise<ExpenseImportResult> {
  const api = getBackendClient();
  const now = new Date().toISOString();
  const baris: Expense[] = plan.rows.map((r) => ({
    id: uuid(),
    store_id: storeId,
    category: r.category,
    description: r.description,
    amount: r.amount,
    expense_date: r.expense_date,
    payment_method: r.payment_method,
    // Pengeluaran lama tidak berasal dari laci kasir mana pun.
    shift_id: null,
    created_by: userId,
    created_at: now,
  }));

  const serverErrors: string[] = [];
  if (navigator.onLine && baris.length) {
    const CHUNK = 200;
    for (let i = 0; i < baris.length; i += CHUNK) {
      const { error } = await api.from('expenses').upsert(baris.slice(i, i + CHUNK));
      if (error) {
        serverErrors.push(error.message);
        return { created: 0, serverErrors };
      }
    }
  }

  await db.expenses.bulkPut(baris);
  return { created: baris.length, serverErrors };
}

/** Berkas contoh: judul kolom dan tiga baris isian. */
export function buildExpenseTemplate(): string {
  const baris = [
    [...EXPENSE_COLUMNS],
    ['2026-07-03', 'Sewa', 'Sewa gudang Juli', '3500000', 'transfer'],
    ['2026-07-15', 'Listrik & Air', 'Token listrik', '450000', 'cash'],
    ['2026-08-02', 'Biaya Admin', 'Biaya transfer supplier', '6500', 'transfer'],
  ].map((r) => r.join(';'));
  return `sep=;\r\n${baris.join('\r\n')}\r\n`;
}

/** Ekspor pengeluaran yang sedang tampil di layar (mengikuti filter). */
export function exportExpensesCsv(expenses: Expense[]): number {
  const label = new Map(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));
  const rows = expenses
    .slice()
    .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
    .map((e) => [
      fmtDate(e.expense_date),
      text(label.get(e.category) ?? e.category),
      text(e.description),
      e.amount,
      text(e.payment_method),
    ]);
  downloadCsv(csvFilename('pengeluaran'), buildCsv([...EXPENSE_COLUMNS], rows));
  return rows.length;
}
