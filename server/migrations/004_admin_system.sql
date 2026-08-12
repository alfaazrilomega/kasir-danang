-- Admin operation trail for self-hosted deployments.
-- Used by the admin system page to show who changed user access and when.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_store_created_idx
  on public.admin_audit_logs(store_id, created_at desc);

create index if not exists admin_audit_logs_actor_created_idx
  on public.admin_audit_logs(actor_id, created_at desc);
