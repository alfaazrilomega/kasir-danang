-- Verifikasi dua langkah (TOTP, RFC 6238) untuk akun staf, 15 Okt 2026.
-- Rahasia disimpan terenkripsi AES-256-GCM dengan kunci turunan AUTH_SECRET,
-- kode pemulihan disimpan sebagai sidik SHA-256. Aman diulang.
alter table public.app_users add column if not exists totp_secret text;
alter table public.app_users add column if not exists totp_pending text;
alter table public.app_users add column if not exists totp_enabled boolean not null default false;
-- Langkah 30 detik terakhir yang dipakai: kode yang sama tidak bisa dipakai dua kali.
alter table public.app_users add column if not exists totp_last_step bigint;
alter table public.app_users add column if not exists totp_recovery jsonb;
