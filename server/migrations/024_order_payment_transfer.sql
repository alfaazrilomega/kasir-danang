-- Metode bayar Transfer (bank).
--
-- Client meminta menu kartu diganti transfer. 'card' sengaja TIDAK dihapus
-- dari daftar: pesanan lama yang tercatat bayar kartu harus tetap sah. Kasir
-- saja yang tidak lagi ditawari pilihan itu.

alter table public.orders drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cash', 'card', 'ewallet', 'qris', 'transfer', 'other'))
  not valid;
