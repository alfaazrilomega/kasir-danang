-- Jejak pembayaran lewat payment gateway (Tripay).
--
-- Pesanan web yang dibayar lewat kanal otomatis (virtual account, e-wallet,
-- QRIS dinamis, gerai retail) punya nomor referensi dan halaman bayar sendiri
-- di sisi Tripay. Kolom ini yang menghubungkan pesanan di sini dengan
-- transaksi di sana, sekaligus dipakai callback untuk menandai lunas.
--
-- Pesanan manual (COD, transfer, QRIS statis) membiarkan kolom ini kosong.

alter table public.orders add column if not exists payment_channel text;
alter table public.orders add column if not exists payment_reference text;
alter table public.orders add column if not exists payment_url text;

create index if not exists orders_payment_reference_idx
  on public.orders(payment_reference)
  where payment_reference is not null;
