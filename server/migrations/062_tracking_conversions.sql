alter table public.stores
  add column if not exists google_analytics_id text,
  add column if not exists google_tag_manager_id text;
alter table public.store_integrations drop constraint if exists store_integrations_provider_check;
alter table public.store_integrations add constraint store_integrations_provider_check
  check (provider in ('tripay', 'mayar', 'doku', 'kiriminaja', 'onesender', 'meta_whatsapp', 'meta_capi'));
alter table public.orders add column if not exists meta_tracking jsonb;

-- Immutable paid purchase snapshot shared by browser analytics and CAPI retries.
create table if not exists public.meta_capi_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_id text not null,
  pixel_id text,
  purchase jsonb not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (store_id, order_id)
);
create index if not exists meta_capi_events_pending_idx on public.meta_capi_events(next_attempt_at, created_at) where processed_at is null;
alter table public.meta_capi_events enable row level security;

create or replace function public.queue_meta_capi_purchase() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  items jsonb;
  capi boolean;
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid'
    and new.sales_channel = 'website' and new.order_status <> 'canceled'
    and new.payment_mode is distinct from 'sandbox' and new.meta_tracking is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', product_id, 'nama', name, 'qty', qty, 'harga', price) order by id), '[]'::jsonb)
      into items from public.order_items where order_id = new.id;
    if jsonb_array_length(items) = 0 then return new; end if;
    capi := coalesce(new.meta_tracking->>'capi', 'false') = 'true';
    insert into public.meta_capi_events (store_id, order_id, event_id, pixel_id, purchase, processed_at)
    values (new.store_id, new.id, new.id::text, new.meta_tracking->>'pixelId',
      jsonb_build_object('jenis', 'Purchase', 'idPesanan', new.id, 'nomorPesanan', new.order_number,
        'nilai', greatest(0, new.total - coalesce(new.shipping_cost, 0) - coalesce(new.tax, 0)),
        'shipping', coalesce(new.shipping_cost, 0), 'tax', coalesce(new.tax, 0), 'barang', items),
      case when capi then null else now() end)
    on conflict (store_id, order_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_meta_capi_purchase on public.orders;
create trigger orders_meta_capi_purchase after update of payment_status on public.orders
for each row execute function public.queue_meta_capi_purchase();
