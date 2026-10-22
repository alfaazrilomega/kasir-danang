-- Spec 0003: banner beranda toko online yang dikelola admin (menu Banner Toko).
-- Gambar disimpan sebagai data URL hasil kompres di browser, sama seperti
-- gambar produk; pembeli menerimanya lewat GET /api/public/banners/:id/gambar.

create table if not exists public.store_banners (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  title text,
  image_data text not null check (length(image_data) <= 3000000),
  image_mobile_data text check (image_mobile_data is null or length(image_mobile_data) <= 3000000),
  -- Alamat toko diawali satu "/" (bukan "//domain") atau alamat https:// lengkap,
  -- tanpa spasi, karakter kontrol, atau "\" (browser membaca "/\domain" sebagai situs lain).
  link_url text check (link_url is null or (link_url ~ '^(/([^/]|$)|https://[^/])' and link_url !~ '[[:space:][:cntrl:]\\]')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create index if not exists store_banners_store_urut_idx on public.store_banners(store_id, sort_order);

alter table public.store_banners enable row level security;
