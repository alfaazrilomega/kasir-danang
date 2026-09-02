// Format CSV bersama untuk SELURUH ekspor aplikasi.
//
// Masalah yang diselesaikan — berkas lama dibuka berantakan di Excel:
//
// 1. Pemisah koma. Excel dengan regional Indonesia (dan sebagian besar Eropa)
//    memakai TITIK KOMA sebagai pemisah daftar. Berkas berkoma dibuka menumpuk
//    di satu kolom. Diperbaiki dengan menulis baris petunjuk `sep=;` di awal
//    berkas — Excel membacanya dan langsung memisah kolom dengan benar.
// 2. Angka desimal bertitik (`62.5`) terbaca sebagai teks di Excel Indonesia.
//    Sekarang desimal memakai koma (`62,5`), bilangan bulat tetap polos supaya
//    tetap bisa dihitung di Excel.
// 3. Nilai teknis mentah (`sale`, `paid`, `done`) ditampilkan apa adanya.
//    Sekarang diterjemahkan ke label manusia.
// 4. Tanggal panjang tak seragam. Sekarang `dd/mm/yyyy` yang langsung dikenali
//    Excel Indonesia sebagai tanggal.

export const CSV_DELIMITER = ';';
/** Baris petunjuk untuk Excel. Parser kita melewatinya saat impor. */
export const CSV_SEP_HINT = `sep=${CSV_DELIMITER}`;

/** Bungkus sel bila mengandung pemisah, kutip, atau baris baru. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Susun CSV siap dibuka Excel: baris `sep=;`, judul kolom, lalu data.
 * Nilai sudah harus diformat lewat helper di bawah.
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [CSV_SEP_HINT, headers.map(cell).join(CSV_DELIMITER)];
  for (const row of rows) lines.push(row.map(cell).join(CSV_DELIMITER));
  return lines.join('\r\n');
}

/**
 * Angka untuk Excel Indonesia. Bilangan bulat ditulis polos (`8000`) supaya
 * tetap berupa angka; desimal memakai koma (`62,5`).
 * Sengaja TIDAK memakai pemisah ribuan: titik ribuan membuat Excel
 * memperlakukannya sebagai teks sehingga tidak bisa dijumlahkan.
 */
export function num(value: unknown, decimals = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(decimals).replace('.', ',');
}

/** Bilangan bulat; nilai kosong jadi 0. */
export function int(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Math.round(n)) : '';
}

/** Tanggal `dd/mm/yyyy` — dikenali Excel Indonesia sebagai tanggal asli. */
export function date(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Tanggal + jam `dd/mm/yyyy HH:mm`. */
export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Ya / Tidak, bukan true / false. */
export function yesNo(value: unknown): string {
  return value ? 'Ya' : 'Tidak';
}

/** Teks; nilai kosong jadi sel kosong, bukan tanda hubung. */
export function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s;
}

// --- Terjemahan nilai teknis ke label manusia -------------------------------

const LABELS: Record<string, Record<string, string>> = {
  stockMovement: {
    sale: 'Penjualan',
    restock: 'Restock',
    adjust: 'Penyesuaian',
    refund: 'Retur / Kembali',
  },
  paymentStatus: { paid: 'Lunas', unpaid: 'Belum Bayar', partial: 'Sebagian' },
  orderStatus: { done: 'Selesai', pending: 'Tertunda', canceled: 'Dibatalkan' },
  orderType: { dine_in: 'Makan di Tempat', take_away: 'Bawa Pulang' },
  paymentMethod: {
    cash: 'Tunai', card: 'Kartu', ewallet: 'E-Wallet', qris: 'QRIS',
    transfer: 'Transfer', other: 'Lainnya',
  },
  paymentTerm: { cash: 'Bayar Langsung', tempo: 'Tempo / Piutang' },
  purchaseStatus: {
    draft: 'Draf', ordered: 'Dipesan', partial: 'Sebagian',
    received: 'Diterima', canceled: 'Dibatalkan',
  },
  purchasePaymentType: { dp: 'DP / Uang Muka', settlement: 'Pelunasan', other: 'Lainnya' },
};

/**
 * Ubah nilai teknis jadi label. Nilai tak dikenal dikembalikan apa adanya
 * supaya data baru tidak berubah jadi sel kosong tanpa disadari.
 */
export function label(kind: keyof typeof LABELS, value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  return LABELS[kind]?.[raw] ?? raw;
}

/** Unduh berkas dengan BOM agar Excel membaca UTF-8 dengan benar. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Nama berkas seragam: `kasir_<jenis>_<tanggal>.csv`. */
export function csvFilename(kind: string, suffix?: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = suffix || `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `kasir_${kind}_${stamp}.csv`;
}
