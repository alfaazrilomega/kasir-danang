-- Ukuran paket produk: panjang x lebar x tinggi, dalam sentimeter.
--
-- Ekspedisi menghitung ongkir dari yang lebih besar antara berat timbangan
-- dan berat volumetrik (P x L x T / 6000). Gear set dalam kotak bisa ringan
-- tapi makan tempat, jadi berat saja (kolom weight_gram) tidak cukup.
--
-- Default 0 berarti "belum diisi".

alter table public.products
  add column if not exists length_cm integer not null default 0,
  add column if not exists width_cm integer not null default 0,
  add column if not exists height_cm integer not null default 0;

alter table public.products drop constraint if exists products_dimensions_check;

alter table public.products
  add constraint products_dimensions_check
  check (length_cm >= 0 and width_cm >= 0 and height_cm >= 0)
  not valid;
