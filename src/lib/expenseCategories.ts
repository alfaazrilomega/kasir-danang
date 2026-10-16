import type { ExpenseCategory, ExpensePaymentMethod, Store } from '@/types';

export interface OpsiKategori {
  value: ExpenseCategory;
  label: string;
}

export const EXPENSE_CATEGORIES: OpsiKategori[] = [
  { value: 'sewa', label: 'Sewa Tempat' },
  { value: 'gaji', label: 'Gaji & Upah' },
  { value: 'listrik_air', label: 'Listrik & Air' },
  { value: 'internet', label: 'Internet & Telepon' },
  { value: 'transport', label: 'Transport & Pengiriman' },
  { value: 'pemasaran', label: 'Pemasaran & Iklan' },
  { value: 'perlengkapan', label: 'Perlengkapan Toko' },
  { value: 'perawatan', label: 'Perawatan & Perbaikan' },
  { value: 'pajak_retribusi', label: 'Pajak & Retribusi' },
  { value: 'biaya_admin', label: 'Biaya Admin Pembayaran' },
  { value: 'komisi_affiliate', label: 'Komisi Affiliate' },
  { value: 'lainnya', label: 'Lainnya' },
];

export const EXPENSE_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'card', label: 'Kartu' },
  { value: 'ewallet', label: 'E-Wallet' },
  { value: 'other', label: 'Lainnya' },
];

export function expenseCategoryLabel(value: string | null | undefined): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? String(value ?? 'Lainnya');
}

export const MAKS_PANJANG_KATEGORI = 40;
export const MAKS_KATEGORI_TAMBAHAN = 50;

/** Kategori tambahan toko yang sah (teks tidak kosong). */
export function kategoriTambahanToko(store: Pick<Store, 'expense_categories'> | null | undefined): string[] {
  const isi = store?.expense_categories;
  return Array.isArray(isi) ? isi.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
}

function cariKategori(label: string, daftar: readonly OpsiKategori[]): OpsiKategori | undefined {
  const kunci = label.trim().toLowerCase();
  return daftar.find((c) => c.value.toLowerCase() === kunci || c.label.toLowerCase() === kunci);
}

function kategoriSudahAda(label: string, daftar: readonly OpsiKategori[]): boolean {
  return !!cariKategori(label, daftar);
}

/**
 * Kategori bawaan ditambah kategori buatan toko dari Pengaturan Toko
 * (permintaan 26), "Lainnya" tetap paling bawah. Kategori buatan disimpan di
 * pengeluaran sebagai labelnya sendiri, jadi `expenseCategoryLabel` dan
 * laporan menampilkannya tanpa peta tambahan.
 */
export function daftarKategoriPengeluaran(tambahan?: readonly string[] | null): OpsiKategori[] {
  const lainnya = EXPENSE_CATEGORIES.filter((c) => c.value === 'lainnya');
  const hasil = EXPENSE_CATEGORIES.filter((c) => c.value !== 'lainnya');
  for (const t of tambahan ?? []) {
    const label = String(t ?? '').trim();
    if (label && !kategoriSudahAda(label, [...hasil, ...lainnya])) hasil.push({ value: label, label });
  }
  return [...hasil, ...lainnya];
}

/**
 * Pilihan dropdown ditambah nilai yang sedang terpilih bila nilai itu sudah
 * tidak ada di daftar (kategori tambahan yang dihapus). Tanpa ini, membuka dan
 * menyimpan pengeluaran lama diam-diam mengganti kategorinya.
 */
export function opsiDenganNilai(daftar: OpsiKategori[], ...nilai: (string | null | undefined)[]): OpsiKategori[] {
  const hasil = [...daftar];
  for (const n of nilai) {
    if (n && !hasil.some((c) => c.value === n)) hasil.push({ value: n, label: expenseCategoryLabel(n) });
  }
  return hasil;
}

/** Alasan nama kategori baru ditolak, atau null bila boleh disimpan. */
export function cekKategoriBaru(label: string, tambahan: readonly string[]): string | null {
  const bersih = label.trim();
  if (!bersih) return 'Nama kategori wajib diisi.';
  if (bersih.length > MAKS_PANJANG_KATEGORI) return `Nama kategori maksimal ${MAKS_PANJANG_KATEGORI} huruf.`;
  const kembar = cariKategori(bersih, daftarKategoriPengeluaran(tambahan));
  // "gaji" bentrok dengan kode bawaan yang tampil sebagai "Gaji & Upah"; pesannya menyebut nama yang terlihat.
  if (kembar) {
    return kembar.label.toLowerCase() === bersih.toLowerCase()
      ? `Kategori "${bersih}" sudah ada.`
      : `Kategori "${bersih}" sudah ada sebagai "${kembar.label}".`;
  }
  if (tambahan.length >= MAKS_KATEGORI_TAMBAHAN) return `Maksimal ${MAKS_KATEGORI_TAMBAHAN} kategori tambahan.`;
  return null;
}

export function expenseMethodLabel(value: string | null | undefined): string {
  return EXPENSE_METHODS.find((m) => m.value === value)?.label ?? String(value ?? '-');
}
