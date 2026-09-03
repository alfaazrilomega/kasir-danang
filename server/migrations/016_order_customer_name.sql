-- Nama pelanggan lepas pada pesanan.
--
-- Impor rekap penjualan marketplace membawa nama penerima (Shopee "Nama
-- Penerima", TikTok "Recipient"). Nama itu perlu tersimpan supaya pesanan bisa
-- ditelusuri, tapi TIDAK boleh membuat baris pelanggan baru: satu berkas rekap
-- bisa memuat ratusan pembeli sekali pakai, dan daftar pelanggan akan penuh
-- oleh nama yang tidak pernah dipakai lagi.
--
-- customer_id tetap dipakai untuk pelanggan terdaftar; kolom ini hanya untuk
-- pesanan yang tidak punya pelanggan terdaftar.

alter table public.orders add column if not exists customer_name text;
