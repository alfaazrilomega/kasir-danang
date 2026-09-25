-- Flash sale: jendela waktu dengan harga khusus dan kuota per produk, seperti
-- sesi diskon jam tertentu di marketplace. Harga dan kuotanya melekat ke
-- produk per SESI (bukan ke produk itu sendiri) karena satu produk bisa ikut
-- beberapa sesi dengan harga & kuota berbeda, dan base_price produk tidak
-- boleh ikut berubah di luar jam sesi.
create table if not exists public.flash_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists flash_sales_store_window_idx
  on public.flash_sales(store_id, starts_at, ends_at);

-- sold_qty TIDAK dihitung ulang dari order_items: dia dinaikkan lewat UPDATE
-- atomik persis saat checkout (lihat POST /api/public/orders di
-- server/index.js), dalam transaksi yang sama dengan insert pesanan. Postgres
-- mengunci baris yang di-UPDATE, jadi kalau dua pembeli checkout bersamaan
-- dan kuota tinggal satu, pembeli kedua selalu mengevaluasi WHERE-nya
-- terhadap sold_qty yang sudah dinaikkan pembeli pertama, bukan nilai basi.
create table if not exists public.flash_sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  flash_sale_id uuid not null references public.flash_sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  flash_price numeric(12,2) not null check (flash_price >= 0),
  quota_qty integer check (quota_qty is null or quota_qty > 0),
  sold_qty integer not null default 0 check (sold_qty >= 0),
  created_at timestamptz not null default now(),
  unique (flash_sale_id, product_id)
);

create index if not exists flash_sale_items_product_idx
  on public.flash_sale_items(store_id, product_id);
