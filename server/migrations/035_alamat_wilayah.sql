-- Provinsi & kota/kabupaten disimpan terpisah dari alamat teks.
--
-- Ongkir (KiriminAja) menghitung tarif dari wilayah tujuan, bukan dari alamat
-- bebas. Menyimpan provinsi dan kota sebagai kolom sendiri membuat pesanan
-- lama tetap bisa dipakai saat integrasi ongkir dinyalakan, tanpa menebak-nebak
-- isi alamat teksnya.

alter table public.customers add column if not exists address_province text;
alter table public.customers add column if not exists address_city text;

alter table public.orders add column if not exists delivery_province text;
alter table public.orders add column if not exists delivery_city text;
