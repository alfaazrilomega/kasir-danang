-- Rahasia hanya diakses endpoint admin/server, tidak melalui /api/query.
create table if not exists public.store_integrations (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('tripay', 'kiriminaja')),
  config_encrypted text not null,
  updated_at timestamptz not null default now(),
  primary key (store_id, provider)
);
alter table public.store_integrations enable row level security;
