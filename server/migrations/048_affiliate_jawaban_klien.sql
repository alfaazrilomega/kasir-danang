-- Jawaban klien program affiliate (spesifikasi docs/specs/0001-program-affiliate/0002-jawaban-klien.md,
-- PRD D-31 sampai D-40). Aman diulang.

-- D-31: tarif komisi per affiliate (daftar tier, kosong = ikut bawaan toko).
alter table public.customers add column if not exists affiliate_commission jsonb;

-- D-32: undangan khusus dari admin, tanpa affiliate pengirim.
alter table public.affiliate_invitations alter column affiliate_id drop not null;
alter table public.affiliate_invitations add column if not exists dari_admin boolean not null default false;
alter table public.affiliate_invitations add column if not exists commission jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'affiliate_invitations_pengirim') then
    alter table public.affiliate_invitations
      add constraint affiliate_invitations_pengirim check (dari_admin or affiliate_id is not null);
  end if;
end $$;
create index if not exists affiliate_invitations_admin_idx
  on public.affiliate_invitations (store_id, lower(email)) where dari_admin;

-- D-36: komisi sebelum dipotong retur. Komisi yang seluruh barangnya diretur bernilai 0.
alter table public.affiliate_commissions add column if not exists commission_awal numeric(14,2);
update public.affiliate_commissions set commission_awal = commission where commission_awal is null;
alter table public.affiliate_commissions drop constraint if exists affiliate_commissions_commission_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'affiliate_commissions_commission_nonneg') then
    alter table public.affiliate_commissions
      add constraint affiliate_commissions_commission_nonneg check (commission >= 0);
  end if;
end $$;

-- D-36, D-37: potongan untuk komisi yang sudah dibayar, dipotong dari pembayaran berikutnya.
create table if not exists public.affiliate_potongan (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  affiliate_id uuid not null references public.customers(id) on delete restrict,
  commission_id uuid not null references public.affiliate_commissions(id) on delete cascade,
  jenis text not null check (jenis in ('retur', 'batal')),
  amount numeric(14,2) not null check (amount > 0),
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_potongan_terbuka_idx
  on public.affiliate_potongan (store_id, affiliate_id) where payout_id is null;
create index if not exists affiliate_potongan_komisi_idx on public.affiliate_potongan (commission_id);
alter table public.affiliate_potongan enable row level security;

-- D-38: bonus target bulanan, satu baris per affiliate per bulan (hari pertama bulan, WIB).
create table if not exists public.affiliate_bonuses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  affiliate_id uuid not null references public.customers(id) on delete restrict,
  bulan date not null,
  omset numeric(14,2) not null,
  target numeric(14,2) not null,
  rate_type text not null check (rate_type in ('percentage', 'fixed')),
  rate_value numeric(14,2) not null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null check (status in ('berjalan', 'added')),
  paid boolean not null default false,
  paid_at timestamptz,
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, affiliate_id, bulan)
);
alter table public.affiliate_bonuses enable row level security;

-- D-40: rincian pembayaran. amount = yang ditransfer.
alter table public.affiliate_payouts add column if not exists commission_total numeric(14,2) not null default 0;
alter table public.affiliate_payouts add column if not exists bonus_total numeric(14,2) not null default 0;
alter table public.affiliate_payouts add column if not exists deduction_total numeric(14,2) not null default 0;
update public.affiliate_payouts set commission_total = amount where commission_total = 0 and bonus_total = 0;

-- D-36: hitung ulang komisi satu produk di satu pesanan setelah returnya berubah.
create or replace function public.affiliate_hitung_retur(p_order uuid, p_product uuid) returns void
language plpgsql as $$
declare
  qty_pesan numeric;
  qty_retur numeric;
  r numeric;
  k record;
  baru numeric;
  seharusnya numeric;
  terpakai numeric;
begin
  select coalesce(sum(qty), 0) into qty_pesan from public.order_items where order_id = p_order and product_id = p_product;
  if qty_pesan <= 0 then return; end if;
  select coalesce(sum(ri.qty), 0) into qty_retur
    from public.order_return_items ri join public.order_returns rt on rt.id = ri.return_id
   where rt.order_id = p_order and ri.product_id = p_product;
  r := least(1, qty_retur / qty_pesan);
  for k in
    select c.id, c.store_id, c.affiliate_id, c.paid, coalesce(c.commission_awal, c.commission) as awal
      from public.affiliate_commissions c
     where c.order_id = p_order and c.product_id = p_product
     for update
  loop
    baru := floor(k.awal * (1 - r));
    if not k.paid then
      update public.affiliate_commissions
         set commission = baru, commission_awal = k.awal, updated_at = now()
       where id = k.id and commission <> baru;
    else
      -- Komisi yang sudah ditransfer tidak diubah. Selisihnya menjadi potongan.
      seharusnya := k.awal - baru;
      delete from public.affiliate_potongan where commission_id = k.id and jenis = 'retur' and payout_id is null;
      select coalesce(sum(amount), 0) into terpakai
        from public.affiliate_potongan where commission_id = k.id and jenis = 'retur' and payout_id is not null;
      if seharusnya - terpakai > 0 then
        insert into public.affiliate_potongan (store_id, affiliate_id, commission_id, jenis, amount)
        values (k.store_id, k.affiliate_id, k.id, 'retur', seharusnya - terpakai);
      end if;
    end if;
  end loop;
end $$;

create or replace function public.affiliate_potong_retur() returns trigger
language plpgsql as $$
declare
  baris record;
  pesanan uuid;
begin
  baris := coalesce(new, old);
  if baris.product_id is null then return null; end if;
  select order_id into pesanan from public.order_returns where id = baris.return_id;
  if pesanan is null then return null; end if;
  perform public.affiliate_hitung_retur(pesanan, baris.product_id);
  return null;
end $$;

create or replace trigger order_return_items_affiliate
  after insert or delete or update of qty, product_id on public.order_return_items
  for each row execute function public.affiliate_potong_retur();

-- D-37: status komisi mengikuti pesanan, dan pembatalan sesudah dibayar menjadi potongan.
create or replace function public.affiliate_sinkron_status() returns trigger
language plpgsql as $$
declare
  baru text;
begin
  if new.order_status is not distinct from old.order_status then
    return new;
  end if;
  baru := case new.order_status
    when 'done' then 'added'
    when 'canceled' then 'cancelled'
    else 'pending'
  end;
  with diubah as (
    update public.affiliate_commissions
       set status = baru, updated_at = now()
     where order_id = new.id and status <> baru
    returning id, store_id
  )
  insert into public.affiliate_outbox (store_id, kind, ref_id)
  select store_id, 'komisi_masuk', id from diubah where baru = 'added';

  if new.order_status = 'canceled' then
    insert into public.affiliate_potongan (store_id, affiliate_id, commission_id, jenis, amount)
    select c.store_id, c.affiliate_id, c.id, 'batal',
           c.commission - coalesce((select sum(p.amount) from public.affiliate_potongan p where p.commission_id = c.id and p.jenis = 'retur'), 0)
      from public.affiliate_commissions c
     where c.order_id = new.id and c.paid
       and not exists (select 1 from public.affiliate_potongan p where p.commission_id = c.id and p.jenis = 'batal')
       and c.commission - coalesce((select sum(p.amount) from public.affiliate_potongan p where p.commission_id = c.id and p.jenis = 'retur'), 0) > 0;
  elsif old.order_status = 'canceled' then
    delete from public.affiliate_potongan p
     using public.affiliate_commissions c
     where c.id = p.commission_id and c.order_id = new.id and p.jenis = 'batal' and p.payout_id is null;
  end if;
  return new;
end $$;
