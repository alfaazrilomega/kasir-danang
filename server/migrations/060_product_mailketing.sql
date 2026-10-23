alter table public.products
  add column if not exists mailketing_order_list_id integer check (mailketing_order_list_id > 0),
  add column if not exists mailketing_complete_list_id integer check (mailketing_complete_list_id > 0);

create table if not exists public.mailketing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event text not null check (event in ('order', 'complete')),
  list_id integer not null check (list_id > 0),
  email text not null,
  name text not null default '',
  phone text not null default '',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (order_id, event, list_id, email)
);
alter table public.mailketing_subscriptions enable row level security;
create index if not exists mailketing_pending_idx on public.mailketing_subscriptions (store_id, next_attempt_at)
  where processed_at is null and attempts < 5;

-- Antrean ikut transaksi pesanan. Rollback checkout juga membatalkan antrean.
create or replace function public.queue_product_mailketing(p_order uuid, p_event text, p_product uuid default null)
returns void language sql set search_path = public as $$
  insert into public.mailketing_subscriptions (store_id, order_id, event, list_id, email, name, phone)
  select distinct o.store_id, o.id, p_event,
    case when p_event = 'order' then p.mailketing_order_list_id else p.mailketing_complete_list_id end,
    lower(trim(c.email)), coalesce(nullif(o.customer_name, ''), c.name, ''),
    coalesce(nullif(o.customer_phone, ''), c.phone, '')
  from public.orders o
  join public.customers c on c.id = o.customer_id and c.store_id = o.store_id
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id and p.store_id = o.store_id
  where o.id = p_order and (p_product is null or p.id = p_product)
    and o.order_status <> 'canceled'
    and (p_event = 'order' or o.order_status = 'done')
    and c.email is not null and trim(c.email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and case when p_event = 'order' then p.mailketing_order_list_id else p.mailketing_complete_list_id end is not null
  on conflict (order_id, event, list_id, email) do nothing;
$$;

create or replace function public.mailketing_item_created()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.queue_product_mailketing(new.order_id, 'order', new.product_id);
  perform public.queue_product_mailketing(new.order_id, 'complete', new.product_id);
  return new;
end;
$$;
drop trigger if exists mailketing_item_created on public.order_items;
create trigger mailketing_item_created after insert on public.order_items
  for each row execute function public.mailketing_item_created();

create or replace function public.mailketing_order_completed()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.order_status = 'done' and old.order_status is distinct from 'done' then
    perform public.queue_product_mailketing(new.id, 'complete');
  end if;
  return new;
end;
$$;
drop trigger if exists mailketing_order_completed on public.orders;
create trigger mailketing_order_completed after update of order_status on public.orders
  for each row execute function public.mailketing_order_completed();
