-- Pengaturan template dan jejak pengiriman terpisah dari rahasia integrasi.
create table if not exists public.whatsapp_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_messages (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  template_key text not null check (template_key in ('order_new', 'wa1', 'wa2', 'wa3')),
  provider text not null check (provider in ('onesender', 'meta_whatsapp')),
  recipient text not null,
  message_text text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('draft', 'sending', 'accepted', 'failed', 'unknown')),
  provider_message_id text,
  error_message text,
  dedupe_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, dedupe_key)
);
create index if not exists whatsapp_messages_store_created_idx on public.whatsapp_messages(store_id, created_at desc);
alter table public.whatsapp_settings enable row level security;
alter table public.whatsapp_messages enable row level security;
