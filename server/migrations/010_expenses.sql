-- Migrasi 010: Pengeluaran operasional (opex) sebagai entitas tersendiri.
--
-- Latar belakang:
--   * Sebelumnya pengeluaran hanya berupa cash_movements bertipe 'out' yang
--     WAJIB menempel pada shift kasir yang sedang terbuka. Akibatnya biaya di
--     luar jam kasir (sewa, gaji, listrik, internet) tidak bisa dicatat sama
--     sekali, dan tidak ada kategori untuk mengelompokkannya.
--   * Laporan Laba Rugi karena itu berhenti di laba KOTOR. Tanpa tabel ini
--     tidak ada angka yang bisa dipotong untuk mendapat laba bersih.
--
-- Hubungan dengan cash_movements:
--   Kalau pengeluaran dibayar tunai dari laci kasir, aplikasi TETAP menulis
--   satu baris cash_movements 'out' supaya rekonsiliasi laci akurat. Laporan
--   Laba Rugi hanya membaca tabel expenses ini, jadi tidak ada dobel hitung.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category text not null default 'lainnya',
  description text,
  amount numeric(14,2) not null default 0,
  expense_date date not null default current_date,
  payment_method text not null default 'cash',
  -- Terisi hanya bila dibayar tunai dari laci shift tertentu.
  shift_id uuid references public.shifts(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists expenses_store_date_idx
  on public.expenses(store_id, expense_date desc);

create index if not exists expenses_store_category_idx
  on public.expenses(store_id, category);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expenses_amount_check'
  ) then
    alter table public.expenses
      add constraint expenses_amount_check check (amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expenses_method_check'
  ) then
    alter table public.expenses
      add constraint expenses_method_check
      check (payment_method in ('cash','transfer','card','ewallet','other'));
  end if;
end $$;
