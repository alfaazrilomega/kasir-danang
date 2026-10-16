-- Lupa kata sandi pembeli: kode verifikasi 6 digit dikirim ke email akun,
-- disimpan dalam bentuk hash, berlaku 10 menit, maksimal 5 kali salah.
-- Sekalian lokasi toko (kota) yang tampil di kartu produk toko online.
alter table public.stores add column if not exists shop_city text;

create table if not exists public.customer_password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_password_resets_user_idx
  on public.customer_password_resets(user_id, created_at desc);
