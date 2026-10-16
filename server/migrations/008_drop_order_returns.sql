-- Migrasi 008: Hapus fitur Retur Pesanan (Retur Customer) beserta tabelnya.
-- Fitur retur customer dan retur supplier dihapus dari aplikasi, jadi tabel
-- pendukungnya ikut dibuang. Data retur yang tersimpan akan hilang permanen.

drop table if exists public.order_return_items;
drop table if exists public.order_returns;
