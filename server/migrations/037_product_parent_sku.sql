-- SKU Induk: kunci yang menyatukan varian dari satu produk.
--
-- Client menjual satu produk dengan belasan varian ukuran/warna, dan tiap
-- varian adalah baris products tersendiri karena stoknya memang terpisah.
-- Toko online sudah mengelompokkan varian, tapi kuncinya nama produk — dan itu
-- keliru di data client sendiri: "Gear Belakang Yamaha Fiz R Rx King GNNK
-- Racing Product" dipakai oleh DUA produk berbeda, SKU Induk GEAR-BLKNG-FIZR
-- (3 varian) dan GEAR-BLKNG-FIZR-BLAC (14 varian). Mengelompokkan dari nama
-- akan menggabungkan keduanya jadi satu produk 17 varian campur warna.
--
-- Kolom ini diisi dari kolom "SKU Induk" pada ekspor Shopee, jadi
-- pengelompokan di aplikasi sama persis dengan yang dilihat pembeli di
-- marketplace. Boleh kosong: produk lama tanpa SKU Induk tetap dikelompokkan
-- lewat namanya seperti sebelumnya.
alter table public.products add column if not exists parent_sku text;

create index if not exists products_parent_sku_idx
  on public.products(store_id, parent_sku);
