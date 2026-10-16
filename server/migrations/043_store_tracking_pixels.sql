-- Pelacakan iklan toko online (butir 15 PERMINTAAN-CLIENT.md): Meta Pixel,
-- TikTok Pixel, dan Google Ads. Yang disimpan hanya ID-nya; kode pemasang
-- resmi tiap platform dipasang aplikasi di halaman /toko. Kolom kosong berarti
-- platform itu tidak dipakai.
alter table public.stores add column if not exists meta_pixel_id text;
alter table public.stores add column if not exists tiktok_pixel_id text;
alter table public.stores add column if not exists google_ads_id text;
alter table public.stores add column if not exists google_ads_purchase_label text;
