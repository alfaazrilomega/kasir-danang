-- Pertahankan metode toko lama sampai admin menonaktifkannya secara manual.
alter table public.stores
  add column if not exists manual_transfer_enabled boolean not null default true,
  add column if not exists manual_qris_enabled boolean not null default true;
