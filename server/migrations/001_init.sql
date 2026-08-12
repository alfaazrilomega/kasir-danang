create extension if not exists pgcrypto;

create table if not exists public.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists app_users_email_lower_idx
  on public.app_users (lower(email));

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  currency text not null default 'IDR',
  tax_rate numeric(5,2) not null default 10.00,
  logo_url text,
  receipt_header text,
  receipt_footer text,
  points_per_amount numeric(12,4) not null default 0,
  low_stock_threshold numeric(12,2) not null default 5,
  industry text not null default 'fnb',
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references public.app_users(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  full_name text,
  email text,
  role text not null default 'cashier' check (role in ('admin','manager','warehouse','cashier','customer')),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  icon text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  image_url text,
  base_price numeric(12,2) not null default 0,
  sizes jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sku text,
  barcode text,
  cost_price numeric(12,2) not null default 0,
  stock_qty numeric(12,2) not null default 0,
  min_stock numeric(12,2) not null default 0,
  track_stock boolean not null default false,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'products_store_sku_idx'
  ) then
    if not exists (
      select 1
      from public.products
      where sku is not null
      group by store_id, sku
      having count(*) > 1
    ) then
      create unique index products_store_sku_idx
        on public.products(store_id, sku) where sku is not null;
    else
      raise notice 'Skip unique index products_store_sku_idx because duplicate SKU values exist.';
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'products_store_barcode_idx'
  ) then
    if not exists (
      select 1
      from public.products
      where barcode is not null
      group by store_id, barcode
      having count(*) > 1
    ) then
      create unique index products_store_barcode_idx
        on public.products(store_id, barcode) where barcode is not null;
    else
      raise notice 'Skip unique index products_store_barcode_idx because duplicate barcode values exist.';
    end if;
  end if;
end $$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  location text,
  joined_date date not null default current_date,
  is_active boolean not null default true,
  points int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.promos (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('percent','fixed')),
  value numeric(12,2) not null,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cashier_id uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12,2) not null default 0,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  total_sales numeric(12,2) not null default 0,
  total_orders int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists shifts_store_open_idx
  on public.shifts(store_id, opened_at desc);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid references public.profiles(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  order_number text not null,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_method text not null check (payment_method in ('cash','card','ewallet','qris')),
  payment_status text not null default 'paid' check (payment_status in ('paid','unpaid')),
  order_status text not null default 'done' check (order_status in ('done','pending','canceled')),
  order_type text not null default 'dine_in' check (order_type in ('dine_in','take_away')),
  table_number text,
  notes text,
  promo_code text,
  received_amount numeric(12,2),
  change_amount numeric(12,2),
  points_earned int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists orders_store_created_idx
  on public.orders(store_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  size text,
  qty int not null default 1,
  price numeric(12,2) not null default 0,
  cost_price numeric(12,2),
  note text
);

create index if not exists order_items_order_idx
  on public.order_items(order_id);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  type text not null check (type in ('open','close','in','out','sale','refund')),
  amount numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists cash_movements_shift_idx
  on public.cash_movements(shift_id, created_at desc);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  type text not null check (type in ('sale','restock','adjust','refund')),
  qty_delta numeric(12,2) not null,
  reason text,
  ref_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_store_idx
  on public.stock_movements(store_id, created_at desc);
create index if not exists stock_movements_product_idx
  on public.stock_movements(product_id, created_at desc);

create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  points_delta int not null,
  reason text,
  ref_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_customer_idx
  on public.loyalty_transactions(customer_id, created_at desc);

create or replace function public.apply_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select oi.product_id, oi.qty
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id is not null
  loop
    update public.products
      set stock_qty = stock_qty - r.qty
      where id = r.product_id and track_stock = true;

    insert into public.stock_movements(store_id, product_id, type, qty_delta, ref_order_id, reason)
    select store_id, r.product_id, 'sale', -r.qty, p_order_id, 'POS sale'
    from public.products where id = r.product_id;
  end loop;
end;
$$;
