alter table public.store_integrations
  drop constraint store_integrations_provider_check;
alter table public.store_integrations
  add constraint store_integrations_provider_check
  check (provider in ('tripay', 'kiriminaja', 'onesender'));
