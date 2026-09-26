alter table public.purchases add column if not exists other_cost_date date;
alter table public.purchases add column if not exists other_cost_category text;
alter table public.purchases add column if not exists extra_cost_date date;
alter table public.purchases add column if not exists extra_cost_category text;
alter table public.expenses add column if not exists purchase_id uuid
  references public.purchases(id) on delete cascade;
alter table public.expenses add column if not exists purchase_cost_slot text;
create unique index if not exists expenses_purchase_slot_idx
  on public.expenses(purchase_id, purchase_cost_slot)
  where purchase_id is not null;
