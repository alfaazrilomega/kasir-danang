-- Hardening layer for databases that were restored from an older/Supabase
-- public schema before running the self-hosted app. Everything here is
-- idempotent: it should be safe on a fresh database and on an existing one.

create extension if not exists pgcrypto;

alter table if exists public.stores
  add column if not exists address text,
  add column if not exists currency text not null default 'IDR',
  add column if not exists tax_rate numeric(5,2) not null default 10.00,
  add column if not exists logo_url text,
  add column if not exists receipt_header text,
  add column if not exists receipt_footer text,
  add column if not exists points_per_amount numeric(12,4) not null default 0,
  add column if not exists low_stock_threshold numeric(12,2) not null default 5,
  add column if not exists industry text not null default 'fnb',
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.profiles
  add column if not exists store_id uuid,
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists role text not null default 'cashier',
  add column if not exists avatar_url text,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.categories
  add column if not exists store_id uuid,
  add column if not exists name text,
  add column if not exists icon text,
  add column if not exists sort_order int not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.products
  add column if not exists store_id uuid,
  add column if not exists category_id uuid,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists image_url text,
  add column if not exists base_price numeric(12,2) not null default 0,
  add column if not exists sizes jsonb not null default '[]'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists sku text,
  add column if not exists barcode text,
  add column if not exists cost_price numeric(12,2) not null default 0,
  add column if not exists stock_qty numeric(12,2) not null default 0,
  add column if not exists min_stock numeric(12,2) not null default 0,
  add column if not exists track_stock boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.customers
  add column if not exists store_id uuid,
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists location text,
  add column if not exists joined_date date not null default current_date,
  add column if not exists is_active boolean not null default true,
  add column if not exists points int not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.promos
  add column if not exists store_id uuid,
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists type text,
  add column if not exists value numeric(12,2) not null default 0,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.shifts
  add column if not exists store_id uuid,
  add column if not exists cashier_id uuid,
  add column if not exists opened_at timestamptz not null default now(),
  add column if not exists closed_at timestamptz,
  add column if not exists opening_cash numeric(12,2) not null default 0,
  add column if not exists closing_cash numeric(12,2),
  add column if not exists expected_cash numeric(12,2),
  add column if not exists total_sales numeric(12,2) not null default 0,
  add column if not exists total_orders int not null default 0,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.orders
  add column if not exists store_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists cashier_id uuid,
  add column if not exists shift_id uuid,
  add column if not exists order_number text,
  add column if not exists subtotal numeric(12,2) not null default 0,
  add column if not exists tax numeric(12,2) not null default 0,
  add column if not exists discount numeric(12,2) not null default 0,
  add column if not exists total numeric(12,2) not null default 0,
  add column if not exists payment_method text not null default 'cash',
  add column if not exists payment_status text not null default 'paid',
  add column if not exists order_status text not null default 'done',
  add column if not exists order_type text not null default 'dine_in',
  add column if not exists table_number text,
  add column if not exists notes text,
  add column if not exists promo_code text,
  add column if not exists received_amount numeric(12,2),
  add column if not exists change_amount numeric(12,2),
  add column if not exists points_earned int not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.order_items
  add column if not exists order_id uuid,
  add column if not exists product_id uuid,
  add column if not exists name text,
  add column if not exists size text,
  add column if not exists qty int not null default 1,
  add column if not exists price numeric(12,2) not null default 0,
  add column if not exists cost_price numeric(12,2),
  add column if not exists note text;

alter table if exists public.cash_movements
  add column if not exists store_id uuid,
  add column if not exists shift_id uuid,
  add column if not exists type text,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.stock_movements
  add column if not exists store_id uuid,
  add column if not exists product_id uuid,
  add column if not exists type text,
  add column if not exists qty_delta numeric(12,2) not null default 0,
  add column if not exists reason text,
  add column if not exists ref_order_id uuid,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.loyalty_transactions
  add column if not exists store_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists points_delta int not null default 0,
  add column if not exists reason text,
  add column if not exists ref_order_id uuid,
  add column if not exists created_at timestamptz not null default now();

-- The self-hosted API enforces tenant access. Disable imported Supabase RLS so
-- the Node database user is not blocked by policies that call auth.uid().
do $$
declare
  t text;
begin
  foreach t in array array[
    'stores', 'profiles', 'categories', 'products', 'customers', 'promos',
    'orders', 'order_items', 'shifts', 'cash_movements', 'stock_movements',
    'loyalty_transactions'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I disable row level security', t);
      execute format('alter table public.%I no force row level security', t);
    end if;
  end loop;
end $$;

-- Supabase dumps may keep profiles.id linked to auth.users. New local users
-- need profiles.id to accept app_users ids. Use NOT VALID so legacy rows can
-- stay in place while new/updated rows are protected.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.profiles'::regclass and attname = 'id')
      ]
      and confrelid <> 'public.app_users'::regclass
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_app_users_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_app_users_id_fkey
      foreign key (id) references public.app_users(id)
      on delete cascade
      not valid;
  end if;
end $$;

alter table if exists public.profiles
  drop constraint if exists profiles_role_check,
  add constraint profiles_role_check
    check (role in ('admin','manager','warehouse','cashier','customer')) not valid;

alter table if exists public.promos
  drop constraint if exists promos_type_check,
  add constraint promos_type_check
    check (type in ('percent','fixed')) not valid;

alter table if exists public.orders
  drop constraint if exists orders_payment_method_check,
  add constraint orders_payment_method_check
    check (payment_method in ('cash','card','ewallet','qris')) not valid,
  drop constraint if exists orders_payment_status_check,
  add constraint orders_payment_status_check
    check (payment_status in ('paid','unpaid')) not valid,
  drop constraint if exists orders_order_status_check,
  add constraint orders_order_status_check
    check (order_status in ('done','pending','canceled')) not valid,
  drop constraint if exists orders_order_type_check,
  add constraint orders_order_type_check
    check (order_type in ('dine_in','take_away')) not valid;

alter table if exists public.cash_movements
  drop constraint if exists cash_movements_type_check,
  add constraint cash_movements_type_check
    check (type in ('open','close','in','out','sale','refund')) not valid;

alter table if exists public.stock_movements
  drop constraint if exists stock_movements_type_check,
  add constraint stock_movements_type_check
    check (type in ('sale','restock','adjust','refund')) not valid;

create index if not exists orders_store_created_idx
  on public.orders(store_id, created_at desc);
create index if not exists order_items_order_idx
  on public.order_items(order_id);
create index if not exists shifts_store_open_idx
  on public.shifts(store_id, opened_at desc);
create index if not exists cash_movements_shift_idx
  on public.cash_movements(shift_id, created_at desc);
create index if not exists stock_movements_store_idx
  on public.stock_movements(store_id, created_at desc);
create index if not exists stock_movements_product_idx
  on public.stock_movements(product_id, created_at desc);
create index if not exists loyalty_customer_idx
  on public.loyalty_transactions(customer_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'products_store_sku_idx'
  ) and not exists (
    select 1
    from public.products
    where sku is not null
    group by store_id, sku
    having count(*) > 1
  ) then
    create unique index products_store_sku_idx
      on public.products(store_id, sku) where sku is not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'products_store_barcode_idx'
  ) and not exists (
    select 1
    from public.products
    where barcode is not null
    group by store_id, barcode
    having count(*) > 1
  ) then
    create unique index products_store_barcode_idx
      on public.products(store_id, barcode) where barcode is not null;
  end if;
end $$;

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
