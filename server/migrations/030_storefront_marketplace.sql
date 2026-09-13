-- Halaman produk toko online disamakan dengan marketplace (permintaan client:
-- detail produk seperti Lazada). Menambah data yang dibutuhkan halaman itu:
--   * galeri foto, merek, nama variasi, dan harga coret per produk
--   * kontak WhatsApp, kebijakan pengembalian, dan garansi toko
--   * ulasan pembeli (hanya dari pesanan yang selesai) dan tanya jawab produk
alter table public.products
  add column if not exists brand text,
  add column if not exists variant_name text,
  add column if not exists compare_at_price numeric(12,2) not null default 0,
  add column if not exists images jsonb not null default '[]'::jsonb;

alter table public.products drop constraint if exists products_compare_at_price_check;
alter table public.products
  add constraint products_compare_at_price_check check (compare_at_price >= 0);

alter table public.stores
  add column if not exists shop_phone text,
  add column if not exists return_policy text,
  add column if not exists warranty_info text;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  reviewer_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text,
  images jsonb not null default '[]'::jsonb,
  variant_label text,
  is_hidden boolean not null default false,
  seller_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  -- Satu ulasan per barang per pesanan.
  unique (order_id, product_id)
);

create index if not exists product_reviews_product_idx
  on public.product_reviews(product_id, created_at desc);

create table if not exists public.product_questions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  asker_name text not null,
  question text not null,
  answer text,
  answered_at timestamptz,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists product_questions_product_idx
  on public.product_questions(product_id, created_at desc);
