-- Kategori pengeluaran tambahan per toko (permintaan 26), diisi dari
-- Pengaturan Toko. Isinya daftar label teks. Pengeluaran yang memakai kategori
-- tambahan menyimpan label itu apa adanya di expenses.category (kolom teks
-- bebas), jadi laporan tidak butuh peta tambahan. Aman diulang.

alter table public.stores
  add column if not exists expense_categories jsonb not null default '[]'::jsonb;
