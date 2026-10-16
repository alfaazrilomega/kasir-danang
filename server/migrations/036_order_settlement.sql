-- Pencairan dana marketplace: berapa yang benar-benar masuk, dan berapa yang dipotong.
--
-- Angka penjualan yang masuk lewat impor adalah HARGA TAYANG. Uang yang
-- benar-benar diterima baru ketahuan saat dana cair, dan selisihnya adalah
-- biaya admin, komisi, biaya layanan, sampai ongkir yang ditanggung penjual.
-- Selama ini selisih itu hanya bisa dicatat lewat "Sesuaikan harga", yang
-- MENIMPA total pesanan — akibatnya harga tayang hilang dan semua jenis
-- potongan melebur jadi satu angka tanpa nama.
--
-- Karena itu potongan disimpan terpisah, bukan menimpa total: omzet tetap sama
-- dengan angka di Shopee/TikTok, dan potongannya bisa ditampilkan sebagai biaya
-- tersendiri di laba rugi.
alter table public.orders add column if not exists marketplace_fee numeric(12,2) not null default 0;
alter table public.orders add column if not exists net_settled numeric(12,2);
alter table public.orders add column if not exists settlement_date date;

-- Rincian potongan apa adanya dari penyedia. TikTok memberi komisi, biaya
-- layanan, biaya pembayaran, dan ongkir sebagai kolom terpisah; Shopee hanya
-- memberi satu angka bersih. Disimpan sebagai jsonb supaya bentuk yang berbeda
-- antar marketplace tidak memaksa kolom baru tiap kali.
alter table public.orders add column if not exists fee_detail jsonb;

-- Potongan tidak pernah negatif: nilainya besaran, arahnya sudah jelas.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_marketplace_fee_check'
  ) then
    alter table public.orders
      add constraint orders_marketplace_fee_check check (marketplace_fee >= 0);
  end if;
end $$;

-- Laporan pencairan selalu disaring per toko dan per rentang tanggal cair.
create index if not exists orders_settlement_idx
  on public.orders(store_id, settlement_date);
