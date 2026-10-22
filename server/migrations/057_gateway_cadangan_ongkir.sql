-- Spec 0002: gateway pembayaran cadangan (Tripay, Mayar, DOKU), DOKU Checkout,
-- dan ongkir KiriminAja di checkout. Semua kolom baru boleh kosong, jadi
-- pesanan lama dan toko tanpa kunci layanan baru tidak berubah.

alter table public.store_integrations drop constraint if exists store_integrations_provider_check;
alter table public.store_integrations add constraint store_integrations_provider_check
  check (provider in ('tripay', 'mayar', 'doku', 'kiriminaja', 'onesender', 'meta_whatsapp'));

alter table public.store_payment_settings drop constraint if exists store_payment_settings_provider_check;
alter table public.store_payment_settings add constraint store_payment_settings_provider_check
  check (provider in ('tripay', 'mayar', 'doku', 'manual'));

alter table public.orders drop constraint if exists orders_payment_provider_check;
alter table public.orders add constraint orders_payment_provider_check
  check (payment_provider in ('tripay', 'mayar', 'doku'));

-- Layanan asal bila pembayaran dipindah ke cadangan saat Buat Pesanan.
alter table public.orders add column if not exists payment_failover_from text;

-- Wilayah tujuan versi KiriminAja (nama + ID) dan kurir pilihan pembeli.
-- Disimpan lengkap supaya request pickup bisa ditambahkan tanpa migrasi lagi.
alter table public.orders add column if not exists delivery_district text;
alter table public.orders add column if not exists delivery_subdistrict text;
alter table public.orders add column if not exists delivery_district_id integer;
alter table public.orders add column if not exists delivery_subdistrict_id integer;
alter table public.orders add column if not exists shipping_courier text;
alter table public.orders add column if not exists shipping_service text;
alter table public.orders add column if not exists shipping_service_name text;
alter table public.orders add column if not exists shipping_etd text;
alter table public.orders add column if not exists shipping_weight_gram integer;

-- Wilayah KiriminAja terakhir pembeli, untuk mengisi checkout berikutnya.
alter table public.customers add column if not exists address_wilayah jsonb;
