-- Channel penjualan, penjualan tempo (piutang), dan penyesuaian harga setelah terjual.
--
-- Latar belakang:
--   * Penjualan lewat Shopee/TikTok tidak dibayar tunai saat itu juga — uangnya
--     cair belakangan, jadi perlu dicatat sebagai piutang dengan jatuh tempo.
--   * Potongan marketplace baru ketahuan setelah settlement, jadi total order
--     harus bisa disesuaikan tanpa menghapus jejak angka aslinya.

alter table if exists public.orders
  add column if not exists sales_channel text not null default 'offline',
  add column if not exists payment_term text not null default 'cash',
  add column if not exists due_date date,
  add column if not exists paid_amount numeric(12,2) not null default 0,
  add column if not exists settled_at timestamptz,
  -- Jejak penyesuaian harga: total sebelum diubah + selisihnya.
  add column if not exists original_total numeric(12,2),
  add column if not exists adjustment_amount numeric(12,2) not null default 0,
  add column if not exists adjustment_note text,
  add column if not exists adjusted_at timestamptz,
  add column if not exists adjusted_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_adjusted_by_fkey'
  ) then
    alter table public.orders
      add constraint orders_adjusted_by_fkey
      foreign key (adjusted_by) references public.profiles(id) on delete set null;
  end if;
end $$;

-- payment_status lama hanya paid/unpaid; tempo butuh 'partial'.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%payment_status%'
  loop
    execute format('alter table public.orders drop constraint %I', c.conname);
  end loop;

  alter table public.orders
    add constraint orders_payment_status_check
    check (payment_status in ('paid','unpaid','partial'));
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_term_check'
  ) then
    alter table public.orders
      add constraint orders_payment_term_check check (payment_term in ('cash','tempo'));
  end if;
end $$;

create index if not exists orders_store_channel_idx
  on public.orders(store_id, sales_channel, created_at desc);

create index if not exists orders_store_due_idx
  on public.orders(store_id, due_date)
  where payment_term = 'tempo';

-- Order lama dianggap sudah lunas tunai supaya laporan piutang tidak salah hitung.
update public.orders
set paid_amount = total
where payment_term = 'cash'
  and payment_status = 'paid'
  and paid_amount = 0
  and total <> 0;

-- Master channel penjualan supaya toko bisa menambah marketplace sendiri.
create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  name text not null,
  -- Estimasi potongan marketplace dalam persen, dipakai untuk menghitung
  -- perkiraan penerimaan bersih sebelum settlement asli masuk.
  fee_percent numeric(5,2) not null default 0,
  default_term_days int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists sales_channels_store_code_idx
  on public.sales_channels(store_id, lower(code));

-- Pelunasan piutang penjualan (pencairan marketplace / bayar tempo toko).
create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  method text not null default 'transfer'
    check (method in ('cash','transfer','card','ewallet','qris','other')),
  paid_at timestamptz not null default now(),
  reference text,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_payments_order_idx
  on public.order_payments(order_id, paid_at);

create index if not exists order_payments_store_idx
  on public.order_payments(store_id, paid_at desc);

-- paid_amount + payment_status order selalu mengikuti daftar pembayarannya.
create or replace function public.sync_order_paid_amount()
returns trigger
language plpgsql
as $$
declare
  target uuid := coalesce(new.order_id, old.order_id);
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_term text;
begin
  select coalesce(sum(op.amount), 0) into v_paid
  from public.order_payments op
  where op.order_id = target;

  select total, payment_term into v_total, v_term
  from public.orders where id = target;

  update public.orders
  set paid_amount = v_paid,
      payment_status = case
        when v_term <> 'tempo' then payment_status
        when v_paid >= v_total and v_total <> 0 then 'paid'
        when v_paid > 0 then 'partial'
        else 'unpaid'
      end,
      settled_at = case
        when v_term = 'tempo' and v_paid >= v_total and v_total <> 0 then now()
        else null
      end
  where id = target;

  return null;
end;
$$;

drop trigger if exists order_payments_sync_paid on public.order_payments;
create trigger order_payments_sync_paid
  after insert or update or delete on public.order_payments
  for each row execute function public.sync_order_paid_amount();
