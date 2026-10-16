-- Akun pelanggan storefront (keputusan client: pelanggan memakai akun).
--
-- Satu akun login (app_users, role 'customer') terhubung ke satu baris
-- customers milik toko, supaya pesanan web tercatat atas nama pembelinya dan
-- terlihat di riwayat akunnya. Alamat disimpan untuk mengisi checkout
-- berikutnya. Waktu persetujuan kebijakan data pribadi dicatat saat daftar.
alter table public.customers
  add column if not exists user_id uuid references public.app_users(id) on delete set null,
  add column if not exists address text,
  add column if not exists privacy_accepted_at timestamptz;

create unique index if not exists customers_user_id_key
  on public.customers(user_id) where user_id is not null;
