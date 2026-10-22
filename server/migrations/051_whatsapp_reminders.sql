-- Jadwal disimpan saat checkout, sehingga restart tidak menggandakan reminder.
create table public.whatsapp_reminders (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  template_key text not null check (template_key in ('wa1', 'wa2', 'wa3')),
  requires_gateway boolean not null default false,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, template_key)
);
create index whatsapp_reminders_due_idx on public.whatsapp_reminders(scheduled_at) where status = 'pending';
create index whatsapp_reminders_store_idx on public.whatsapp_reminders(store_id, created_at desc);
alter table public.whatsapp_reminders enable row level security;
