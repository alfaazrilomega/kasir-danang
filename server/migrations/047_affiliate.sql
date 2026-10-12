-- Program affiliate (spesifikasi docs/specs/0001-program-affiliate). Perilaku
-- mengikuti Sejoli 1.14.7: link affiliate menandai pengunjung lewat cookie,
-- pesanan mendapat affiliate, komisi per barang per tier berstatus
-- pending -> added -> (paid) atau cancelled mengikuti status pesanan.
-- Aman diulang: semua perubahan memakai if not exists / create or replace.

-- 1. Pengaturan program per toko (digabung dengan nilai bawaan di server).
alter table public.stores add column if not exists affiliate_settings jsonb not null default '{}'::jsonb;

-- 2. Member sebagai affiliate dan jaringan referral.
alter table public.customers add column if not exists affiliate_code text;
alter table public.customers add column if not exists affiliate_access text not null default 'default';
alter table public.customers add column if not exists referred_by uuid references public.customers(id) on delete set null;
alter table public.customers add column if not exists referred_at timestamptz;
alter table public.customers add column if not exists referral_source text;
alter table public.customers add column if not exists bank_info text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_affiliate_access_check') then
    alter table public.customers add constraint customers_affiliate_access_check
      check (affiliate_access in ('default', 'allowed', 'blocked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_referral_source_check') then
    alter table public.customers add constraint customers_referral_source_check
      check (referral_source is null or referral_source in ('link', 'undangan', 'checkout', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_bank_info_len') then
    alter table public.customers add constraint customers_bank_info_len check (bank_info is null or length(bank_info) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_referred_by_self') then
    alter table public.customers add constraint customers_referred_by_self check (referred_by is null or referred_by <> id);
  end if;
end $$;

create unique index if not exists customers_affiliate_code_uniq
  on public.customers (store_id, upper(affiliate_code)) where affiliate_code is not null;
create index if not exists customers_referred_by_idx on public.customers (store_id, referred_by) where referred_by is not null;

-- 3. Pengaturan affiliate per produk.
alter table public.products add column if not exists affiliate_enabled boolean not null default true;
alter table public.products add column if not exists affiliate_if_bought boolean not null default false;
alter table public.products add column if not exists affiliate_commission jsonb;

-- 4. Atribusi di pesanan. Diisi server saja (tidak ada di whitelist /api/query).
alter table public.orders add column if not exists affiliate_id uuid references public.customers(id) on delete set null;
alter table public.orders add column if not exists affiliate_source text;
alter table public.orders add column if not exists acquisition_source text;
alter table public.orders add column if not exists acquisition_media text;
create index if not exists orders_affiliate_idx on public.orders (store_id, affiliate_id, created_at) where affiliate_id is not null;

-- 5. Klik link dan undangan.
create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  affiliate_id uuid not null references public.customers(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  kind text not null default 'link' check (kind in ('link', 'undangan')),
  source text not null default '',
  media text not null default '',
  visitor_hash text,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_clicks_aff_idx on public.affiliate_clicks (store_id, affiliate_id, created_at);
create index if not exists affiliate_clicks_store_idx on public.affiliate_clicks (store_id, created_at);

-- 6. Pembayaran komisi (dibuat sebelum komisi karena komisi menunjuknya).
create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  affiliate_id uuid not null references public.customers(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  commission_count int not null default 0,
  paid_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id) on delete set null,
  note text check (note is null or length(note) <= 300),
  proof_image text,
  expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_payouts_store_idx on public.affiliate_payouts (store_id, paid_at desc);

-- 7. Komisi: satu baris per barang per tier.
create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  affiliate_id uuid not null references public.customers(id) on delete restrict,
  tier smallint not null check (tier between 1 and 5),
  base_amount numeric(14,2) not null default 0,
  rate_type text not null check (rate_type in ('percentage', 'fixed')),
  rate_value numeric(14,4) not null,
  commission numeric(14,2) not null check (commission > 0),
  status text not null default 'pending' check (status in ('pending', 'added', 'cancelled')),
  paid boolean not null default false,
  paid_at timestamptz,
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_commissions_item_tier unique (order_item_id, tier)
);
create index if not exists affiliate_commissions_aff_idx on public.affiliate_commissions (store_id, affiliate_id, status);
create index if not exists affiliate_commissions_order_idx on public.affiliate_commissions (order_id);
create index if not exists affiliate_commissions_store_created_idx on public.affiliate_commissions (store_id, created_at);
create index if not exists affiliate_commissions_payout_idx on public.affiliate_commissions (payout_id) where payout_id is not null;

-- 8. Undangan email. Token asli tidak pernah disimpan, hanya sidik SHA-256.
create table if not exists public.affiliate_invitations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  affiliate_id uuid not null references public.customers(id) on delete cascade,
  email text not null,
  name text check (name is null or length(name) <= 80),
  message text check (message is null or length(message) <= 300),
  token_hash text not null unique,
  status text not null default 'sent' check (status in ('sent', 'opened', 'registered', 'failed')),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  expires_at timestamptz not null,
  registered_customer_id uuid references public.customers(id) on delete set null,
  resend_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_invitations_email_idx on public.affiliate_invitations (store_id, lower(email));
create index if not exists affiliate_invitations_aff_idx on public.affiliate_invitations (affiliate_id, sent_at desc);

-- 9. Antrean email affiliate, dikerjakan pekerja di proses server.
create table if not exists public.affiliate_outbox (
  id bigserial primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('pesanan_baru', 'komisi_masuk', 'komisi_dibayar')),
  ref_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_outbox_pending_idx on public.affiliate_outbox (next_attempt_at) where status = 'pending';

-- 10. Status komisi selalu mengikuti status pesanan, dari jalur mana pun
-- pesanan diubah (konfirmasi, tolak, batal massal, sinkron kasir, Tripay).
-- Padanan Sejoli: completed -> added, cancelled/refunded -> cancelled,
-- selain itu -> pending.
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
  return new;
end $$;

create or replace trigger orders_affiliate_status
  after update of order_status on public.orders
  for each row execute function public.affiliate_sinkron_status();
