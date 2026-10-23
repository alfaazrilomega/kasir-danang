-- Pilihan kecamatan dan desa disimpan terpisah dari detail RT/RW dan patokan rumah.
-- Alamat lama tetap utuh dan dilengkapi pembeli saat checkout berikutnya.
alter table public.customers
  add column if not exists address_district text,
  add column if not exists address_village text;

alter table public.orders
  add column if not exists delivery_district text,
  add column if not exists delivery_village text;
