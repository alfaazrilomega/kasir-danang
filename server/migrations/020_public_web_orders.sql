-- Checkout tamu (tanpa login) dari halaman publik.
--
-- Belum ada payment gateway di jalur ini (Tripay masih terpisah, menunggu
-- API key), jadi pembayaran cash/QRIS di halaman publik tidak bisa
-- diverifikasi otomatis. Pesanan masuk dengan status 'awaiting_confirmation'
-- dan TIDAK memotong stok sampai staff (admin/kasir) mengonfirmasinya lewat
-- RPC confirm_web_order — baru di titik itu apply_order_stock dipanggil.
--
-- customer_phone dan delivery_address dibutuhkan karena pesanan ini datang
-- dari pengunjung anonim, bukan pelanggan terdaftar (customer_id tetap null).

alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists delivery_address text;

alter table public.orders drop constraint if exists orders_order_status_check;

alter table public.orders
  add constraint orders_order_status_check
  check (order_status in ('done', 'pending', 'canceled', 'awaiting_confirmation'))
  not valid;
