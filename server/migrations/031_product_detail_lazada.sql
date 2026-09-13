-- Data produk yang dipakai halaman produk toko online, disamakan dengan
-- halaman produk Lazada (permintaan client):
--   * spesifikasi bebas (daftar label: nilai), nama atribut variasi
--   * jenis & periode garansi, isi kotak, kualifikasi (mis. SNI), sorotan
--   * video produk untuk galeri
--   * tag & jumlah "Helpful" pada ulasan
--   * banner promo toko di halaman produk
alter table public.products
  add column if not exists spec jsonb not null default '[]'::jsonb,
  add column if not exists variant_label text,
  add column if not exists warranty_type text,
  add column if not exists warranty_period text,
  add column if not exists box_contents text,
  add column if not exists highlights text,
  add column if not exists license_type text,
  add column if not exists license_code text,
  add column if not exists video_url text;

alter table public.product_reviews
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists helpful_count integer not null default 0;

alter table public.stores
  add column if not exists pdp_banner_url text;
