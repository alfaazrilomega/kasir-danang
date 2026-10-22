alter table public.store_integrations drop constraint store_integrations_provider_check;
alter table public.store_integrations add constraint store_integrations_provider_check
  check (provider in ('tripay', 'mayar', 'kiriminaja', 'onesender', 'meta_whatsapp'));

create table public.store_payment_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  provider text not null check (provider in ('tripay', 'mayar', 'manual')),
  updated_at timestamptz not null default now()
);
alter table public.store_payment_settings enable row level security;

alter table public.orders
  add column payment_provider text check (payment_provider in ('tripay', 'mayar')),
  add column payment_mode text check (payment_mode in ('sandbox', 'production')),
  add column payment_transaction_id text,
  add column payment_amount numeric,
  add column payment_expires_at timestamptz,
  add column payment_checked_at timestamptz;
update public.orders set payment_provider = 'tripay', payment_amount = total - coalesce(shipping_cost, 0)
  where payment_reference is not null;
create unique index orders_mayar_transaction_unique on public.orders(payment_transaction_id)
  where payment_provider = 'mayar' and payment_transaction_id is not null;
create index orders_payment_check on public.orders(payment_checked_at nulls first)
  where payment_reference is not null and payment_status = 'unpaid';
