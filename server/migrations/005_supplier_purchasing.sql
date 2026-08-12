-- Supplier, pembelian, dan pembayaran bertahap (DP + pelunasan).
--
-- Alur yang didukung:
--   1. Buat nota pembelian ke supplier (status draft/ordered).
--   2. Bayar DP (mis. 20%) saat supplier mulai produksi awal bulan.
--   3. Terima barang -> stok bertambah lewat public.stock_movements.
--   4. Pelunasan sisa (mis. 80%) di akhir bulan sebelum/saat jatuh tempo.
--
-- Sisa utang tidak disimpan sebagai kolom terpisah; selalu total - paid_amount,
-- dan paid_amount dijaga trigger dari tabel purchase_payments supaya tidak
-- pernah meleset dari daftar pembayarannya.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  -- Termin default supplier dalam hari (0 = tunai), dipakai sebagai saran jatuh tempo.
  default_term_days int not null default 0,
  -- Persentase DP default, dipakai sebagai saran saat membuat nota baru.
  default_dp_percent numeric(5,2) not null default 0,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists suppliers_store_name_idx
  on public.suppliers(store_id, name);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft'
    check (status in ('draft','ordered','partial','received','canceled')),
  order_date date not null default current_date,
  expected_date date,
  due_date date,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  other_cost numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  dp_percent numeric(5,2) not null default 0,
  received_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists purchases_store_invoice_idx
  on public.purchases(store_id, lower(invoice_number));

create index if not exists purchases_store_status_idx
  on public.purchases(store_id, status, order_date desc);

create index if not exists purchases_supplier_idx
  on public.purchases(supplier_id, order_date desc);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  sku text,
  qty numeric(12,2) not null default 0,
  received_qty numeric(12,2) not null default 0,
  cost_price numeric(14,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  note text
);

create index if not exists purchase_items_purchase_idx
  on public.purchase_items(purchase_id);

create table if not exists public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  type text not null default 'dp' check (type in ('dp','settlement','other')),
  amount numeric(14,2) not null default 0,
  method text not null default 'cash' check (method in ('cash','transfer','card','ewallet','other')),
  paid_at timestamptz not null default now(),
  reference text,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists purchase_payments_purchase_idx
  on public.purchase_payments(purchase_id, paid_at);

create index if not exists purchase_payments_store_idx
  on public.purchase_payments(store_id, paid_at desc);

-- paid_amount selalu mengikuti jumlah pembayaran yang tercatat.
create or replace function public.sync_purchase_paid_amount()
returns trigger
language plpgsql
as $$
declare
  target uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  update public.purchases p
  set paid_amount = coalesce((
    select sum(pp.amount)
    from public.purchase_payments pp
    where pp.purchase_id = target
  ), 0)
  where p.id = target;
  return null;
end;
$$;

drop trigger if exists purchase_payments_sync_paid on public.purchase_payments;
create trigger purchase_payments_sync_paid
  after insert or update or delete on public.purchase_payments
  for each row execute function public.sync_purchase_paid_amount();

-- Terima barang: tambah stok produk + catat mutasi, sekali jalan per nota.
-- Idempoten lewat kolom received_at, jadi aman kalau tombol ditekan dua kali.
create or replace function public.receive_purchase(p_purchase_id uuid)
returns void
language plpgsql
as $$
declare
  v_store uuid;
  v_received timestamptz;
  v_invoice text;
  item record;
begin
  select store_id, received_at, invoice_number
    into v_store, v_received, v_invoice
  from public.purchases
  where id = p_purchase_id
  for update;

  if v_store is null then
    raise exception 'Nota pembelian tidak ditemukan';
  end if;
  if v_received is not null then
    return;
  end if;

  for item in
    select id, product_id, qty, cost_price
    from public.purchase_items
    where purchase_id = p_purchase_id
  loop
    update public.purchase_items
    set received_qty = item.qty
    where id = item.id;

    if item.product_id is null or item.qty = 0 then
      continue;
    end if;

    -- Harga modal terakhir ikut nota supaya HPP laporan tetap akurat.
    update public.products
    set stock_qty = case when track_stock then coalesce(stock_qty, 0) + item.qty else stock_qty end,
        cost_price = case when item.cost_price > 0 then item.cost_price else cost_price end
    where id = item.product_id;

    insert into public.stock_movements(store_id, product_id, type, qty_delta, reason)
    values (
      v_store,
      item.product_id,
      'restock',
      item.qty,
      concat('Pembelian ', coalesce(v_invoice, ''))
    );
  end loop;

  update public.purchases
  set received_at = now(),
      status = 'received'
  where id = p_purchase_id;
end;
$$;
