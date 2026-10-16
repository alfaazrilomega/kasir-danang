alter table public.stores add column if not exists social_facebook text;
alter table public.stores add column if not exists social_instagram text;
alter table public.stores add column if not exists social_tiktok text;
alter table public.stores add column if not exists social_youtube text;
alter table public.stores add column if not exists footer_links jsonb not null default '[]'::jsonb;
alter table public.stores add column if not exists chat_enabled boolean not null default true;
