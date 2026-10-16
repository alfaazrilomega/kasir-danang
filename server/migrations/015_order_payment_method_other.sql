-- Migrasi 015: izinkan metode bayar 'other' pada pesanan.
--
-- Impor penjualan massal memasukkan riwayat penjualan lama yang berkasnya tidak
-- menyimpan metode pembayaran. Memaksakan 'cash' akan merusak rekap metode
-- pembayaran di laporan kasir, sedangkan menebak 'qris' sama saja mengarang.
-- 'other' menyatakan apa adanya: metodenya tidak diketahui.

alter table public.orders drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cash', 'card', 'ewallet', 'qris', 'other'))
  not valid;
