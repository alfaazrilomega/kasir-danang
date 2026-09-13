-- Berat produk, dalam gram.
--
-- Ongkos kirim dihitung dari berat, jadi tanpa kolom ini integrasi ekspedisi
-- (KiriminAja) tidak bisa berjalan sama sekali meski API key sudah ada.
--
-- Satuannya gram (bukan kg) supaya tidak ada pecahan: data ekspor client
-- memakai dua satuan sekaligus — TikTok menulis "2" kg, Shopee menulis
-- "300 gr" — dan keduanya bulat kalau disimpan sebagai gram.
--
-- Default 0 berarti "belum diisi", bukan "gratis": halaman ongkir nanti harus
-- menolak menghitung untuk produk yang beratnya masih 0.

alter table public.products
  add column if not exists weight_gram integer not null default 0;

alter table public.products drop constraint if exists products_weight_gram_check;

alter table public.products
  add constraint products_weight_gram_check
  check (weight_gram >= 0)
  not valid;
