alter table public.purchases add column if not exists other_cost_label text;
alter table public.purchases add column if not exists extra_cost numeric(14,2) not null default 0;
alter table public.purchases add column if not exists extra_cost_label text;
