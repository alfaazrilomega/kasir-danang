-- Kredensial pengiriman per toko terpisah dari template HTML yang disanitasi.
create table if not exists public.store_email_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  config_encrypted text not null,
  templates jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.store_email_settings enable row level security;
