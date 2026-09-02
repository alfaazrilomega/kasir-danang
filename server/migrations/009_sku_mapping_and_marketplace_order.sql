-- Migrasi 009: Mapping SKU multi-platform, katalog SKU supplier, dan nomor
-- pesanan marketplace.
--
-- Latar belakang:
--   * Satu produk punya SATU SKU internal, tapi tiap marketplace (Shopee,
--     TikTok, Tokopedia) memakai kode barangnya sendiri. Pesanan yang masuk
--     dari marketplace hanya menyebut SKU platform, jadi tanpa tabel pemetaan
--     kita tidak tahu stok produk mana yang harus dikurangi.
--   * Supplier juga memakai kode barang sendiri; katalognya dipisah supaya
--     nota pembelian bisa dicocokkan otomatis.
--   * Order marketplace punya "No. Pesanan" (Shopee) / "Order Id" (TikTok)
--     yang jadi acuan utama saat mencocokkan dana settlement.

-- 1. Pemetaan SKU internal -> SKU platform ------------------------------------
create table if not exists public.product_channel_mappings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- Mengikuti sales_channels.code, tetapi sengaja tidak di-FK supaya kode lama
  -- tetap terbaca kalau channel-nya dinonaktifkan (sama seperti orders.sales_channel).
  channel_code text not null,
  external_sku text not null,
  external_url text,
  is_synced boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists product_channel_mappings_store_channel_idx
  on public.product_channel_mappings(store_id, channel_code);

create index if not exists product_channel_mappings_product_idx
  on public.product_channel_mappings(product_id);

-- Kunci resolusi pesanan masuk: satu SKU platform hanya boleh menunjuk ke satu
-- produk. Satu produk boleh punya banyak listing di platform yang sama.
create unique index if not exists product_channel_mappings_lookup_idx
  on public.product_channel_mappings(store_id, channel_code, lower(external_sku));

-- 2. Katalog barang supplier --------------------------------------------------
create table if not exists public.supplier_product_mappings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_sku text not null,
  supplier_barcode text,
  supplier_product_name text not null default '',
  -- Harga modal terakhir dalam mata uang supplier (lihat suppliers.currency).
  last_cost_price numeric(14,4) not null default 0,
  currency text not null default 'IDR',
  created_at timestamptz not null default now()
);

create index if not exists supplier_product_mappings_store_idx
  on public.supplier_product_mappings(store_id, supplier_id);

create index if not exists supplier_product_mappings_product_idx
  on public.supplier_product_mappings(product_id);

create unique index if not exists supplier_product_mappings_lookup_idx
  on public.supplier_product_mappings(supplier_id, lower(supplier_sku));

-- 3. Nomor pesanan asli dari platform ----------------------------------------
-- Contoh: Shopee "2608113TQ8HWAB", TikTok "585506423461087094".
-- Sengaja TIDAK unique: insert lewat /api/query menelan error database, jadi
-- pelanggaran unique akan membuat order hilang diam-diam. Duplikat dicegat di
-- sisi aplikasi (POS memberi peringatan sebelum order disimpan).
alter table public.orders
  add column if not exists external_order_no text;

create index if not exists orders_external_order_no_idx
  on public.orders(store_id, external_order_no)
  where external_order_no is not null;

-- 4. Coba pasang lagi unique index SKU internal -------------------------------
-- Di 001_init.sql index ini dilewati kalau saat itu masih ada SKU ganda.
-- Sekarang UI sudah memvalidasi SKU, jadi kita coba pasang sekali lagi.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'products_store_sku_idx'
  ) then
    if not exists (
      select 1 from public.products
      where sku is not null
      group by store_id, sku
      having count(*) > 1
    ) then
      create unique index products_store_sku_idx
        on public.products(store_id, sku) where sku is not null;
    else
      raise notice 'Lewati products_store_sku_idx: masih ada SKU ganda.';
    end if;
  end if;
end $$;
