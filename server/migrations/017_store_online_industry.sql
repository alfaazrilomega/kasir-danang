-- Pindahkan toko ke jenis usaha "Toko Online".
--
-- Aplikasi ini dipakai satu toko online sparepart motor. Sisa bentuk kerja
-- restoran (Dine In, Take Away, nomor meja, ukuran S/M/L) tidak pernah dipakai
-- dan hanya membingungkan kasir.
--
-- Saklar fiturnya disimpan sebagai penimpa di kolom features. Mengubah
-- industry saja tidak cukup: penimpa lama tetap menang dan Dine In akan tetap
-- muncul. Karena itu ketiga penimpa tampilan itu dibuang, sedangkan penimpa
-- lain (mis. defaultTrackStock) dibiarkan apa adanya.

update public.stores
set industry = 'online',
    features = coalesce(features, '{}'::jsonb) - 'useOrderType' - 'useTable' - 'useSizes';
