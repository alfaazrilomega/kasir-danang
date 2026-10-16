# Aplikasi Kasir

Aplikasi kasir/POS offline-first berbasis **React + Vite + TypeScript** dengan backend **Node/Express + PostgreSQL** untuk self-hosted VPS. Data tetap di-cache ke **IndexedDB (Dexie)** sehingga transaksi bisa dibuat saat offline dan otomatis disinkronkan saat online.

## Analisis Migrasi

Versi lama memakai Vercel untuk hosting/serverless dan Supabase untuk Auth + Postgres + REST/RLS. Versi ini sudah dipindah ke arsitektur VPS:

- Frontend React tetap PWA dan dibuild ke `dist/`.
- Express (`server/index.js`) menyajikan API, endpoint notifikasi, dan file static `dist`.
- PostgreSQL murni memakai migrasi di `server/migrations/`, termasuk hardening untuk schema hasil restore lama.
- Auth Supabase diganti auth lokal: tabel `app_users`, password hash `scrypt`, dan bearer token HMAC.
- RLS Supabase diganti validasi tenant di API: data toko dibatasi ke `profiles.store_id` user login.
- Adapter client di `src/lib/api.ts` meniru subset query Supabase yang dipakai app, jadi halaman POS/CRUD tetap minim perubahan.
- Role-based access control berjalan di frontend dan API: admin, admin gudang, kasir, dan pembeli.

## Fitur

- Dashboard, POS menu, orders, customers, products, promos, shifts, reports, settings.
- Offline-first: order masuk IndexedDB dulu, lalu `flushPending()` mengirim ke Postgres saat online.
- Stock movement dan loyalty ledger.
- PWA installable.
- Kirim struk email/WhatsApp via endpoint Express `/api/notifications`.

## Role Aplikasi

- `admin`: kontrol penuh, termasuk Settings toko, promo, laporan, gudang, kasir, dan menu Users untuk menambahkan akun.
- `warehouse`: admin gudang untuk produk, kategori, stok, dan stock movement.
- `cashier`: kasir untuk input pemesanan, pelanggan, shift, dan laporan kasir. Data order/shift dibatasi ke kasir tersebut.
- `customer`: pembeli untuk melihat katalog produk aktif.
- `manager`: role lama yang tetap dianggap setara admin agar data lama tidak rusak.

## Instalasi Lokal

1. Install dependency:

```bash
npm install
```

2. Siapkan Postgres dan `.env`:

```bash
cp .env.example .env
```

Isi minimal:

```bash
DATABASE_URL=postgres://kasir_user:password@localhost:5432/kasir
AUTH_SECRET=ganti-dengan-string-random-panjang
PORT=3000
```

3. Jalankan migrasi:

```bash
npm run db:migrate
npm run db:check
```

4. Buat akun admin dan toko awal:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD=password-kuat \
BOOTSTRAP_STORE_NAME="Nama Toko" \
npm run bootstrap:admin
```

Tambahkan `BOOTSTRAP_SEED_SAMPLE=true` bila ingin produk contoh.
Setelah login sebagai admin, buka menu `Users` untuk menambahkan admin gudang, kasir, atau pembeli.

5. Jalankan API dan frontend dev di dua terminal:

```bash
npm run dev:api
npm run dev
```

Buka `http://localhost:5173`. Vite akan proxy `/api` ke `http://localhost:3000`.

## Production VPS

```bash
npm install
npm run db:migrate
npm run db:check
BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_PASSWORD=password-kuat BOOTSTRAP_STORE_NAME="Nama Toko" npm run bootstrap:admin
npm run build
npm start
```

Di production, Express menyajikan frontend dari `dist/` dan API dari domain yang sama. Jika memakai Nginx, arahkan reverse proxy ke port `3000`.

## Env

Wajib:

- `DATABASE_URL`: koneksi PostgreSQL.
- `AUTH_SECRET`: secret panjang untuk token login.

Opsional:

- `PORT`: default `3000`.
- `DB_SSL=true`: untuk Postgres managed yang butuh SSL.
- `CORS_ORIGIN`: origin tambahan jika API beda domain.
- `GMAIL_SMTP_*` dan `FONNTE_TOKEN`: pengiriman struk digital.
- `VITE_API_BASE_URL`: isi hanya jika frontend dan API beda origin saat build.

## Struktur Penting

```text
server/
  index.js                 # Express API + static hosting
  migrate.js               # runner migrasi Postgres
  bootstrap.js             # buat admin + toko awal
  migrations/               # schema self-hosted + hardening
src/lib/roles.ts           # definisi role, capability, dan navigasi
src/lib/api.ts             # client API Supabase-style adapter
src/lib/sync.ts            # offline pull/flush engine
public/kasir-config.js     # runtime API URL override
```

## Reset

- Reset cache lokal: Settings -> Hapus cache lokal.
- Reset koneksi lokal: Settings -> Reset koneksi lokal.
- Reset database: lakukan manual di PostgreSQL, lalu jalankan ulang `npm run db:migrate`.
