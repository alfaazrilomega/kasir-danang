# Deploy ke Vercel + Supabase

Aplikasi ini punya dua bagian: frontend Vite (React) dan backend Express satu
berkas. Di Vercel keduanya jalan dari satu proyek — frontend sebagai statis,
backend sebagai satu serverless function di `api/[...path].js`.

## 1. Siapkan database di Supabase

1. Buat project baru di Supabase.
2. Buka **Project Settings → Database → Connection string**.
3. Ambil string **Connection pooling** (port `6543`), bukan koneksi langsung
   port `5432`.

   Ini penting. Serverless membuka banyak koneksi pendek; koneksi langsung akan
   kehabisan slot dan permintaan mulai gagal saat ramai. Pooler dibuat untuk
   pola ini.

4. Migrasi belum dijalankan di sini — lihat langkah 3.

## 2. Buat project di Vercel

Hubungkan repository GitHub-nya. Vercel membaca `vercel.json`, jadi tidak perlu
mengatur build command atau output directory secara manual.

Isi environment variable berikut di **Project Settings → Environment Variables**:

| Nama | Isi | Catatan |
|---|---|---|
| `DATABASE_URL` | connection string pooler Supabase | wajib pakai port 6543 |
| `DB_SSL` | `true` | Supabase menolak koneksi tanpa SSL |
| `AUTH_SECRET` | acak, minimal 32 karakter | jangan pakai nilai dari `.env` lokal |
| `SESSION_SECRET` | acak, minimal 32 karakter | boleh sama dengan `AUTH_SECRET` |
| `SESSION_DAYS` | `7` | umur sesi login |
| `CORS_ORIGIN` | domain Vercel-nya | kosongkan kalau frontend dan API satu domain |
| `ALLOW_PUBLIC_SIGNUP` | `false` | biarkan mati untuk toko sungguhan |

`VITE_API_BASE_URL` **tidak perlu diisi**. Frontend memanggil `/api` di domain
yang sama.

## 3. Jalankan migrasi ke Supabase

Dari komputer lokal, arahkan `DATABASE_URL` ke Supabase lalu jalankan:

```bash
DATABASE_URL="<pooler supabase>" DB_SSL=true npm run db:migrate
DATABASE_URL="<pooler supabase>" DB_SSL=true npm run db:check
```

`db:check` harus menjawab `schema ok`. Migrasinya SQL murni dan berurutan, jadi
aman dijalankan ulang — yang sudah diterapkan akan dilewati.

## 4. Buat akun admin pertama

```bash
DATABASE_URL="<pooler supabase>" DB_SSL=true \
BOOTSTRAP_ADMIN_EMAIL="admin@tokoanda.com" \
BOOTSTRAP_ADMIN_PASSWORD="<kata sandi kuat>" \
npm run bootstrap:admin
```

## 5. Cek setelah deploy

1. Buka `https://<domain>/api/health` — harus menjawab
   `{"ok":true,"database":"postgres"}`.
2. Login memakai akun dari langkah 4.
3. Buka Settings → Koneksi untuk memastikan tidak ada antrean tertahan.

## Catatan

**Data demo.** Saat login pertama, aplikasi mengisi katalog contoh bila produk
kurang dari 20. Untuk toko sungguhan, masukkan katalog client lewat
Impor / Ekspor Data sebelum dipakai berjualan, supaya data contoh tergantikan.

**PM2 hanya untuk lokal.** `ecosystem.config.cjs` dipakai saat pengembangan.
Di Vercel tidak ada proses yang hidup terus; `app.listen` sengaja dilewati saat
variabel `VERCEL` terdeteksi.
