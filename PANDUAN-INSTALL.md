# Panduan Instalasi VPS + PostgreSQL

Panduan ini untuk menjalankan Aplikasi Kasir di VPS sendiri, tanpa Vercel dan tanpa Supabase.

## Alur

```text
1. Siapkan VPS + Node.js + PostgreSQL
2. Isi .env
3. Jalankan npm run db:migrate
4. Validasi schema dengan npm run db:check
5. Buat akun admin dan toko awal dengan bootstrap
6. Build frontend
7. Jalankan npm start via systemd/PM2
8. Pasang Nginx reverse proxy + HTTPS
```

## 1. Prasyarat VPS

- Node.js 20+.
- PostgreSQL 14+.
- Nginx atau reverse proxy lain.
- Domain yang mengarah ke IP VPS.

Contoh database:

```bash
sudo -u postgres psql
```

```sql
create database kasir;
create user kasir_user with encrypted password 'PASSWORD_KUAT';
grant all privileges on database kasir to kasir_user;
\c kasir
grant all on schema public to kasir_user;
```

## 2. Install Project

```bash
cd /var/www/kasir
npm install
cp .env.example .env
```

Isi `.env`:

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://kasir_user:PASSWORD_KUAT@127.0.0.1:5432/kasir
AUTH_SECRET=isi-dengan-random-minimal-32-karakter

BOOTSTRAP_ADMIN_EMAIL=admin@domainanda.com
BOOTSTRAP_ADMIN_PASSWORD=password-admin-kuat
BOOTSTRAP_ADMIN_NAME=Admin Kasir
BOOTSTRAP_STORE_NAME=Nama Toko Anda
```

Opsional notifikasi:

```bash
GMAIL_SMTP_USER=nama@gmail.com
GMAIL_SMTP_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_SMTP_FROM=nama@gmail.com
GMAIL_SMTP_FROM_NAME=Aplikasi Kasir

FONNTE_TOKEN=token_fonnte
FONNTE_DEFAULT_COUNTRY_CODE=62
```

## 3. Migrasi dan Build

```bash
npm run db:migrate
npm run db:check
npm run bootstrap:admin
npm run build
```

Migrasi membuat schema self-hosted di `server/migrations/001_init.sql`, lalu `002_self_hosted_hardening.sql` merapikan database yang berasal dari restore schema lama: menambah kolom yang hilang, mematikan RLS Supabase, memperbarui constraint QRIS, dan membuat ulang fungsi stok. Command `bootstrap:admin` membuat akun admin dan toko awal langsung di Postgres.

## 4. Jalankan Service

Tes manual:

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

Jika hasilnya `{"ok":true,"database":"postgres"}`, backend sudah siap.

## 5. systemd

Contoh service tersedia di `deploy/kasir.service.example`.

```bash
sudo cp deploy/kasir.service.example /etc/systemd/system/kasir.service
sudo systemctl daemon-reload
sudo systemctl enable --now kasir
sudo systemctl status kasir
```

## 6. Nginx

Contoh konfigurasi tersedia di `deploy/nginx-kasir.conf.example`.

Ringkasnya, Nginx perlu proxy semua request ke Node:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Aktifkan HTTPS dengan Certbot atau tool pilihan Anda.

## 7. First Run

1. Pastikan `npm run bootstrap:admin` sudah sukses.
2. Buka domain aplikasi.
3. Login dengan `BOOTSTRAP_ADMIN_EMAIL` dan `BOOTSTRAP_ADMIN_PASSWORD`.
4. Buka Settings untuk menyesuaikan profil toko, pajak, struk, fitur POS, dan produk.
5. Buka Users untuk menambahkan admin gudang, kasir, atau pembeli.

Opsional env bootstrap:

```bash
BOOTSTRAP_INDUSTRY=fnb
BOOTSTRAP_TAX_RATE=10
BOOTSTRAP_SEED_SAMPLE=true
BOOTSTRAP_RESET_PASSWORD=true
```

Gunakan `BOOTSTRAP_RESET_PASSWORD=true` hanya saat ingin mereset password admin yang sudah ada.

## Role

| Role | Akses |
| --- | --- |
| `admin` | Semua halaman, Settings toko, Users, promo, gudang, kasir, laporan. |
| `warehouse` | Gudang: produk, kategori, stok, dan stock movement. |
| `cashier` | Kasir: input order, pelanggan, shift, dan laporan kasir miliknya. |
| `customer` | Pembeli: katalog produk aktif. |
| `manager` | Role lama, diperlakukan seperti admin. |

## Multi Perangkat

Semua perangkat membuka domain yang sama dan login dengan akun masing-masing. Browser baru tidak perlu mengisi database URL karena koneksi database hanya ada di server.

Jika API dipasang di subdomain berbeda, isi `public/kasir-config.js`:

```js
window.KASIR_CONFIG = {
  apiBaseUrl: 'https://api.domainanda.com',
};
```

## Troubleshooting

| Gejala | Solusi |
| --- | --- |
| `/api/health` gagal | Cek `DATABASE_URL`, firewall Postgres, `npm run db:migrate`, lalu `npm run db:check`. |
| Login selalu gagal | Jalankan `npm run bootstrap:admin`, cek email/password bootstrap, dan pastikan tabel `app_users` ada. |
| Build gagal karena dependency | Jalankan `npm install` ulang di VPS. |
| Transaksi offline belum masuk server | Buka Settings -> Sync sekarang saat online. |
| Notifikasi gagal | Isi env Gmail/Fonnte dan cek log `journalctl -u kasir -f`. |
