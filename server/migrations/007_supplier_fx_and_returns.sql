-- Migrasi 007: Kurs Valas Supplier (USD -> IDR), Barcode Pembelian, dan Retur Pesanan berbasis Nomor Pemesanan

-- 1. Tambah dukungan valuta asing dan kurs pada supplier & pembelian
alter table public.suppliers
  add column if not exists currency text not null default 'IDR',
  add column if not exists exchange_rate numeric(14,4) not null default 1;

alter table public.purchases
  add column if not exists currency text not null default 'IDR',
  add column if not exists exchange_rate numeric(14,4) not null default 1;

alter table public.purchase_items
  add column if not exists barcode text,
  add column if not exists original_cost_price numeric(14,4) not null default 0,
  add column if not exists currency text not null default 'IDR';

-- 2. Tabel Retur Pesanan (Primary reference: order_number)
create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  order_number text not null,
  refund_amount numeric(14,2) not null default 0,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_returns_store_order_idx
  on public.order_returns(store_id, order_number);

create table if not exists public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  sku text,
  barcode text,
  qty numeric(12,2) not null default 1,
  refund_price numeric(14,2) not null default 0,
  note text
);

create index if not exists order_return_items_return_idx
  on public.order_return_items(return_id);
