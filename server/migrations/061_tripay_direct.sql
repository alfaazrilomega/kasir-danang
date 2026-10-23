-- Snapshot invoice hanya ditulis server setelah transaksi Tripay dibuat.
-- Memungkinkan pembeli membuka ulang VA/QR dan instruksi tanpa membuat transaksi baru.
alter table public.orders add column if not exists payment_details jsonb;
