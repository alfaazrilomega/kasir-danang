-- Tanda tangan di faktur penjualan A4.
--
-- Faktur untuk pesanan toko/grosir perlu tanda tangan dan nama penanda
-- tangan. Gambarnya disimpan sebagai data URL, sama seperti logo toko.

alter table public.stores
  add column if not exists invoice_signature_url text,
  add column if not exists invoice_signer_name text;
