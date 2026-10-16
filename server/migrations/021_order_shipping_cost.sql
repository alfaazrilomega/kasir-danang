-- Ongkos kirim pesanan.
--
-- Pesanan dari storefront publik dikirim ke alamat pembeli, tapi ongkirnya
-- belum bisa dihitung otomatis (integrasi KiriminAja menunggu API key). Jadi
-- staff mengisinya sendiri saat mengonfirmasi pesanan, dan nilainya disimpan
-- TERPISAH dari subtotal barang — bukan dilebur ke dalam total.
--
-- Dipisah karena ongkir bukan pendapatan produk: uangnya diteruskan ke kurir
-- dan tidak punya HPP. Kalau dilebur, laba kotor terlihat lebih besar dari
-- kenyataan karena ada "pendapatan" yang modalnya nol. Laporan laba rugi
-- mengeluarkan kolom ini dari pendapatan, sedangkan rekap kas tetap
-- menghitungnya karena uangnya memang diterima.

alter table public.orders
  add column if not exists shipping_cost numeric(12,2) not null default 0;

alter table public.orders drop constraint if exists orders_shipping_cost_check;

alter table public.orders
  add constraint orders_shipping_cost_check
  check (shipping_cost >= 0)
  not valid;
