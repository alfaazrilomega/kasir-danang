-- Pembayaran toko online: rekening transfer dan QRIS statis milik toko.
--
-- Tripay (virtual account & e-wallet otomatis) masih menunggu API key client,
-- jadi untuk sekarang pembeli membayar manual: transfer ke rekening toko atau
-- memindai QRIS toko, lalu staff yang mengonfirmasi pesanannya. Kolom ini
-- yang dipakai halaman checkout untuk menampilkan tujuan pembayarannya.

alter table public.stores add column if not exists bank_name text;
alter table public.stores add column if not exists bank_account_number text;
alter table public.stores add column if not exists bank_account_name text;
alter table public.stores add column if not exists qris_image_url text;
