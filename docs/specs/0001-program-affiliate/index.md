# 0001. Program affiliate dengan atribusi cookie bertanda tangan dan sinkron komisi lewat pemicu database

**Date**: 2026-10-11
**Status**: In Progress

## Structure

- [0002-jawaban-klien.md](0002-jawaban-klien.md): tarif per affiliate, undangan admin, retur dan potongan, bonus target, minimal pencairan (jawaban klien 13 Okt 2026, PRD D-31 sampai D-40).

## Summary

Spesifikasi ini menjelaskan cara membangun program affiliate di toko online GNNK Racing: link dan kode affiliate, pencatatan pembeli lewat cookie, komisi bertingkat, pembayaran komisi, jaringan referral, undangan email bertoken, dan statistiknya. Perilakunya mengikuti Sejoli 1.14.7. Keputusan teknis utamanya: siapa yang membawa pembeli disimpan di cookie yang ditandatangani server (tidak bisa dipalsukan), komisi dibuat oleh server saat pesanan masuk, lalu statusnya diikat ke status pesanan oleh pemicu (aturan otomatis) di database sehingga jalur mana pun yang mengubah pesanan ikut menggerakkan komisi. Email dikirim lewat antrean yang dikerjakan proses server.

## Requirements

**User stories**: lihat [03 Peta cerita](../../03-story-map.md). Ringkasnya:
- Sebagai admin, saya ingin menjalankan program dengan aturan sendiri dan membayar komisi tanpa menghitung manual.
- Sebagai affiliate, saya ingin membagikan link, melihat hasilnya, dan menerima komisi.
- Sebagai pembeli, saya belanja seperti biasa tanpa perubahan harga.

**Acceptance criteria**: kontraknya adalah **AC-1 sampai AC-52** di [02 PRD](../../02-prd.md#9-kriteria-penerimaan), berlaku persis seperti tertulis di sana (tidak disalin ulang supaya hanya ada satu sumber). Kelompoknya:

| Kelompok | AC |
|---|---|
| Pengaturan dan akses | AC-1 sampai AC-8 |
| Link dan klik | AC-9 sampai AC-18 |
| Atribusi | AC-19 sampai AC-25 |
| Komisi dan pembayaran | AC-26 sampai AC-38 |
| Referral dan undangan | AC-39 sampai AC-46 |
| Analytics | AC-47 sampai AC-50 |
| Email | AC-51, AC-52 |

Kebutuhan non fungsional NFR-1 sampai NFR-11 di PRD juga mengikat.

## Decision

**Chosen option**: Option 2: cookie bertanda tangan, komisi dihitung server saat pesanan dibuat, status komisi disinkronkan pemicu database, email lewat antrean.

Atribusi disimpan di cookie `gnnk_aff` yang ditandatangani HMAC dan hanya bisa dibaca server, komisi dibuat di transaksi `POST /api/public/orders`, perubahan status pesanan dari jalur mana pun memicu `affiliate_sinkron_status()` di PostgreSQL, dan tiga jenis email affiliate dikirim pekerja antrean di proses server. Alasannya ada di [rationale.md](rationale.md).

**Implementation skills**: tidak ada skill komunitas yang terpasang untuk bagian ini. Skill alur kerja yang dipakai saat membangun: `superpowers:test-driven-development`, `emil-design-eng`, `verify-code-and-journey`, `seam-audit`.

## Feature design

**Data model sketch** (migrasi `server/migrations/047_affiliate.sql`, aman diulang dengan `if not exists`):

Kolom baru di tabel yang ada:

| Tabel | Kolom | Tipe | Aturan |
|---|---|---|---|
| stores | affiliate_settings | jsonb, wajib, bawaan `{}` | Digabung dengan nilai bawaan di server (lihat Configuration) |
| customers | affiliate_code | text, boleh kosong | Unik per toko tanpa beda huruf besar kecil: indeks unik `(store_id, upper(affiliate_code))` bila tidak kosong |
| customers | affiliate_access | text, wajib, bawaan `default` | `default`, `allowed`, `blocked` |
| customers | referred_by | uuid, boleh kosong | FK ke customers, `on delete set null`, indeks `(store_id, referred_by)` |
| customers | referred_at, referral_source | timestamptz, text | Sumber: `link`, `undangan`, `checkout`, `admin` |
| customers | bank_info | text, maks 300 | Diisi affiliate |
| products | affiliate_enabled | boolean, wajib, bawaan true | |
| products | affiliate_if_bought | boolean, wajib, bawaan false | |
| products | affiliate_commission | jsonb, boleh kosong | Larik tier `{type, value}`; kosong atau null berarti komisi bawaan |
| orders | affiliate_id | uuid, boleh kosong | FK ke customers `on delete set null`, indeks `(store_id, affiliate_id, created_at)` |
| orders | affiliate_source | text | `kaitan`, `link`, `undangan` |
| orders | acquisition_source, acquisition_media | text | Dari `utm_source`, `utm_media` |

Tabel baru:

| Tabel | Kolom penting | Aturan |
|---|---|---|
| affiliate_clicks | id, store_id, affiliate_id (FK customers, cascade), product_id (FK products, set null), kind (`link`/`undangan`), source, media (teks, bawaan kosong), visitor_hash, created_at | Indeks `(store_id, affiliate_id, created_at)` |
| affiliate_commissions | id, store_id, order_id (FK orders, cascade), order_item_id (FK order_items, cascade), product_id (set null), affiliate_id (FK customers, restrict), tier (1 sampai 5), base_amount, rate_type, rate_value, commission (lebih dari 0), status (`pending`/`added`/`cancelled`, bawaan `pending`), paid (bawaan false), paid_at, payout_id (FK affiliate_payouts, set null), created_at, updated_at | Unik `(order_item_id, tier)`. Indeks `(store_id, affiliate_id, status)` dan `(order_id)` |
| affiliate_payouts | id, store_id, affiliate_id (FK customers, restrict), amount (lebih dari 0), commission_count, paid_at, paid_by (profil admin), note, proof_image (data URI, boleh kosong), expense_id (FK expenses, set null), created_at | Indeks `(store_id, paid_at desc)` |
| affiliate_invitations | id, store_id, affiliate_id (cascade), email, name, message, token_hash (unik), status (`sent`/`opened`/`registered`/`failed`), sent_at, opened_at, expires_at, registered_customer_id (set null), resend_count, last_error, created_at | Indeks `(store_id, lower(email))` dan `(affiliate_id, sent_at)` |
| affiliate_outbox | id (bigserial), store_id, kind (`pesanan_baru`/`komisi_masuk`/`komisi_dibayar`), ref_id (uuid), status (`pending`/`sent`/`skipped`/`failed`), attempts, next_attempt_at, sent_at, last_error, created_at | Indeks sebagian `(next_attempt_at) where status = 'pending'` |

Pemicu di migrasi yang sama:

```sql
create or replace function public.affiliate_sinkron_status() returns trigger language plpgsql as $$
declare baru text;
begin
  if new.order_status is not distinct from old.order_status then return new; end if;
  baru := case new.order_status when 'done' then 'added' when 'canceled' then 'cancelled' else 'pending' end;
  with diubah as (
    update public.affiliate_commissions set status = baru, updated_at = now()
     where order_id = new.id and status <> baru
    returning id, store_id
  )
  insert into public.affiliate_outbox (store_id, kind, ref_id)
  select store_id, 'komisi_masuk', id from diubah where baru = 'added';
  return new;
end $$;
create or replace trigger orders_affiliate_status after update of order_status on public.orders
  for each row execute function public.affiliate_sinkron_status();
```

Kategori pengeluaran baru `komisi_affiliate` (label "Komisi Affiliate") ditambahkan di tipe `ExpenseCategory` dan daftar kategori halaman Pengeluaran. Kolom `expenses.category` berupa teks bebas, jadi tidak perlu perubahan basis data.

Tiga daftar yang wajib selaras: kolom produk baru masuk `TABLES.products` (`server/index.js`), `REQUIRED_COLUMNS` (`server/migrate.js`), dan tipe `Product` (`src/types/index.ts`). Kolom affiliate di `customers` dan `orders` sengaja **tidak** masuk `TABLES`: hanya server yang mengisinya, sehingga staf atau sinkron klien tidak bisa memalsukan atribusi.

**State transitions**:
- Komisi: `pending` (Order belum selesai) ke `added` (Belum dibayar) saat pesanan `done`. `pending` atau `added` ke `cancelled` saat pesanan `canceled`. Kembali ke `pending` bila pesanan berubah ke status lain. Tanda `paid`: false ke true lewat pembayaran admin atau aksi massal, true ke false lewat aksi "Ubah status komisi ke Belum Dibayar".
- Undangan: `sent` ke `opened` (pembukaan pertama) ke `registered` (pendaftaran). `sent` ke `failed` bila email gagal. Kedaluwarsa dihitung saat dibaca dari `expires_at`.
- Antrean: `pending` ke `sent`, `skipped` (alamat uji, email dimatikan, penerima tanpa email), atau `failed` setelah 3 percobaan (jeda 5 menit kali jumlah percobaan).

**API surface** (semua jawaban berbentuk `{ data }` atau `{ error }` seperti endpoint yang ada):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/public/affiliate/click | POST | store_id, code (wajib), product_id, utm_source, utm_media | redirect, cookie `gnnk_aff` | publik, batas 60/menit/IP | 404 kode atau produk, 403 tidak berhak atau affiliasi produk mati, 429 |
| /api/public/affiliate/invitation | POST | store_id, token | redirect ke daftar, cookie | publik, batas 60/menit/IP | 404 tidak dikenal, 410 kedaluwarsa, 403 pengundang tidak berhak |
| /api/customer/affiliate | GET | | eligible, reason, message, profile (kode dibuat bila belum ada), settings publik, summary 3 periode | pembeli | 403 bukan pembeli |
| /api/customer/affiliate/charts | GET | | month per hari, year per bulan (sales, omset) | affiliate berhak | 403 |
| /api/customer/affiliate/acquisition | GET | | baris sumber dan ID: views, leads, sales, value | affiliate berhak | 403 |
| /api/customer/affiliate/products | GET | | produk aktif yang affiliasinya hidup, tanda eligible | affiliate berhak | 403 |
| /api/customer/affiliate/orders | GET | | 200 pesanan terbaru, kontak hanya bila diizinkan | affiliate berhak | 403 |
| /api/customer/affiliate/commissions | GET | | totals, 500 komisi terbaru | affiliate berhak | 403 |
| /api/customer/affiliate/network | GET | | upline_name, nodes sampai kedalaman pengaturan | affiliate berhak | 403 |
| /api/customer/affiliate/invitations | GET, POST | POST: email (wajib), name, message | daftar, sent_today, daily_limit / baris baru | affiliate berhak | 400 email, 409 sudah member atau ganda 24 jam, 429 batas harian, 502 email gagal |
| /api/customer/affiliate/invitations/:id/resend | POST | | baris diperbarui | pemilik undangan | 404 bukan miliknya, 409 belum 24 jam atau sudah terdaftar |
| /api/customer/affiliate/bank | PATCH | bank_info (maks 300) | bank_info | affiliate berhak | 400 |
| /api/admin/affiliate/settings | GET, PUT | objek pengaturan lengkap | pengaturan tersimpan | admin | 400 dengan pesan PRD |
| /api/admin/affiliate/overview | GET | from, to | totals, affiliates, top_products | admin | |
| /api/admin/affiliate/commissions | GET | from, to, q, order_status, paid, followup, order_id | baris komisi (maks 500) | admin | |
| /api/admin/affiliate/commissions/bulk | POST | ids, action (`mark_paid`/`mark_unpaid`) | updated | admin | 400 aksi |
| /api/admin/affiliate/order/:id | GET | | affiliate, source, acquisition, commissions | admin | 404 |
| /api/admin/affiliate/payouts/summary | GET | from, to | per affiliate: pending, unpaid, paid, kontak, bank_info | admin | |
| /api/admin/affiliate/payouts | GET, POST | POST: affiliate_id, from, to, note, proof_image, record_expense | riwayat / pembayaran baru | admin | 409 tidak ada yang dibayar, 400 bukti tidak sah |
| /api/admin/affiliate/payouts/:id/proof | GET | | proof_image | admin | 404 |
| /api/admin/affiliate/members | GET | q, access | daftar member akun beserta angka | admin | |
| /api/admin/affiliate/members/:id | PATCH | access, code, referred_by | baris diperbarui | admin | 400 kode, 409 kode dipakai, 400 upline berputar |
| /api/admin/affiliate/members/:id/network | GET | | uplines, nodes | admin | 404 |

Halaman `/aff/*` adalah rute aplikasi yang memanggil dua endpoint publik lalu berpindah ke `redirect`. Server Express tidak perlu rute `/aff` sendiri, sehingga cara yang sama berjalan di VPS, Vercel, dan server pengembangan.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Buka link | affiliate | `customers` dengan `upper(affiliate_code) = upper(code)` dan `user_id` terisi di toko itu |
| Buka link | berhak | `affiliate_settings.enabled` dan (`affiliate_access = allowed`, atau `default` dengan `access_mode = all`) |
| Buka link | boleh untuk produk | `products.affiliate_enabled`, dan bila `affiliate_if_bought` ada pesanan `done` milik affiliate berisi produk itu |
| Buka link | umur cookie | `affiliate_settings.cookie_days`, 0 menjadi 3.650 hari |
| Buka link | klik sendiri | `customers.id` dari token pembeli di header `Authorization` bila ada |
| Checkout | cookie yang dipakai | cookie bertanda tangan sah dan waktu klik terakhirnya (`t`) masih di dalam `cookie_days` (D-20). Di luar itu dianggap tidak ada |
| Checkout | calon affiliate | urutan FR-19: `customers.referred_by` (bila `permanent`), lalu `p` di cookie untuk produk yang sekelompok varian dengan barang keranjang (D-19), lalu `g` di cookie (bila `general_cookie`) |
| Checkout | kelompok varian | `products.parent_sku` bila diisi, selain itu `products.name`, huruf kecil, sama dengan `kunciKelompok` di `src/lib/publicCatalog.ts` |
| Checkout | sumber atribusi | `kaitan` untuk (a). Calon per produk selalu `link`. Calon umum `undangan` bila cookie `k = undangan`, selain itu `link` |
| Checkout | parameter akuisisi | `a[id produk]` untuk calon per produk, `a['*']` untuk calon umum, tanpa saling meminjam. Keduanya diisi klik terakhir masing-masing dan dihapus oleh klik tanpa `utm_source` (D-22) |
| Checkout | tier per barang | `products.affiliate_commission` bila larik tidak kosong, selain itu `affiliate_settings.commission` |
| Checkout | dasar komisi | `order_items.price * qty` dikurangi bagian `orders.discount` sebanding nilai barang, ongkir dan pajak tidak ikut |
| Checkout | penerima tier n | `referred_by` penerima tier n minus 1, berhenti bila kosong atau berulang |
| Daftar akun | upline | `g` di cookie yang masih dalam umurnya, atau undangan berlaku tertua untuk email yang sama |
| Klik produk bersyarat | sudah membeli | pesanan `done` milik affiliate yang memuat produk sekelompok varian dengan produk link (D-19) |
| Undangan | tautan di email | `PUBLIC_STORE_URL` (bawaan `https://store.gnnkracing.id`) + `/aff/undangan/{token}`, tidak pernah dari header permintaan (D-24) |
| Ringkasan | batas hari dan bulan | zona `Asia/Jakarta`, dihitung di SQL dengan `at time zone 'Asia/Jakarta'` |
| Ringkasan | Klik, Lead, Sales, Omset, Komisi | `affiliate_clicks`; pesanan `affiliate_id` tidak batal; pesanan `done`; `subtotal - discount` pesanan `done`; komisi `added` (D-10) |
| Grafik | tanggal | `orders.created_at` (tidak ada kolom waktu selesai pesanan) |
| Order affiliate | nama dan kontak pembeli | `orders.customer_name`, `orders.customer_phone`, email dari `customers.email` pembeli; kontak hanya bila `show_buyer_contact` |
| Komisi affiliate | totals | jumlah komisi per status dan tanda paid milik affiliate itu |
| Jaringan | node | CTE rekursif `customers.referred_by` sampai `downline_depth` |
| Pembayaran | jumlah | jumlah komisi `added` dan belum `paid` milik affiliate dalam rentang `created_at`, dikunci `for update` |
| Pembayaran | pengeluaran | baris `expenses` kategori `komisi_affiliate`, tanggal bayar WIB, metode `transfer`, `created_by` admin |
| Email | alamat affiliate | `customers.email`, jatuh ke `app_users.email` |
| Email | tautan dashboard | asal permintaan terakhir tidak tersedia di pekerja, jadi dari `PUBLIC_STORE_URL` bila diisi, bila tidak `https://store.gnnkracing.id` |

**Key invariants**:
- Satu komisi per barang per tier (`unique (order_item_id, tier)`), komisi selalu lebih dari 0.
- Penerima tier 1 tidak pernah sama dengan pembeli. Tidak ada orang yang menerima dua tier dari pesanan yang sama.
- Status komisi selalu cocok dengan status pesanannya (pemicu); `paid` hanya boleh true bila pernah `added`.
- Jumlah `affiliate_payouts.amount` sama dengan jumlah komisi yang menunjuk pembayaran itu, termasuk setelah aksi "Belum Dibayar" (pembayaran dikurangi, dihapus bila nol, pengeluarannya ikut dikurangi atau dihapus).
- Upline tidak boleh dirinya sendiri atau keturunannya.
- Token undangan asli tidak pernah disimpan.
- Pesanan yang punya komisi `paid` tidak bisa dihapus lewat `void_orders` (ditolak 409 di `POST /api/rpc/void_orders`, D-23). Pembatalan tetap boleh.
- Kolom `affiliate_payouts.amount` wajib lebih dari 0, jadi pembayaran yang komisinya habis dibatalkan dihapus, bukan dinolkan.

**Security model**:
- Endpoint pembeli memakai `requireCustomer`. Semua query difilter `customer.id` milik token, sehingga affiliate lain tidak terbaca (NFR-3). Endpoint per baris (resend) memeriksa pemilik dan membalas 404 bila bukan miliknya.
- Endpoint admin memakai `requireUser` dan `requireRoles(['admin'])`, difilter `store_id` staf. Halaman `/affiliate` memakai kapabilitas `manageStoreSettings` yang hanya dimiliki admin.
- Cookie `gnnk_aff`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` bila `x-forwarded-proto` https. Isinya `base64url(json) + "." + HMAC-SHA256(AUTH_SECRET)`; tanda tangan tidak cocok membuat cookie diabaikan. Peta produk dibatasi 12 entri terbaru, kode platform 20 karakter, ID 40 karakter, supaya cookie tetap di bawah 4.096 byte (D-21). Server juga menolak cookie yang lebih tua dari `cookie_days` (D-20).
- Tujuan pengalihan disusun server dari ID, bukan dari masukan pengunjung, jadi tidak ada pengalihan terbuka.
- Bukti transfer: hanya `data:image/(jpeg|png|webp);base64`, maks 400 KB setelah dikodekan.
- Perubahan pengaturan, akses, kode, upline, pembayaran, dan aksi massal ditulis ke `admin_audit_logs`.
- Data pribadi: kontak pembeli dan downline hanya keluar dari server bila saklarnya hidup (D-9).
- Undangan: nama dan pesan ditolak bila memuat alamat web (D-25), judul email dijadikan satu baris, isi HTML di-escape, tautan dari konfigurasi server (D-24).
- Kode `UNDANGAN` ditolak karena `/aff/undangan/{token}` adalah alamat undangan (D-26).

**Configuration required**:
- Tidak ada rahasia baru. Tanda tangan cookie memakai `AUTH_SECRET` yang sudah ada.
- `PUBLIC_STORE_URL` (opsional): alamat toko untuk tautan di email affiliate. Bawaan `https://store.gnnkracing.id`.
- `AFFILIATE_OUTBOX_INTERVAL_MS` (opsional): jeda pekerja antrean, bawaan 15.000. Pekerja tidak jalan bila `VERCEL` terisi.

**Critical test scenarios**:
- Happy path: admin menyalakan program dan mengizinkan member A, A membuka dashboard dan mendapat kode, pengunjung membuka link produk, mendaftar (upline A), checkout, komisi Order belum selesai tercatat, staf mengonfirmasi, komisi Belum dibayar dan antrean berisi email, admin membayar dengan bukti dan pengeluaran, komisi Sudah dibayar dan pengeluaran muncul di Laba Rugi. Membuktikan AC-9, AC-13, AC-19, AC-20, AC-26, AC-32, AC-36.
- Failure case: dua permintaan bayar bersamaan untuk affiliate yang sama menghasilkan satu pembayaran (AC-37). Cookie diubah tangan diabaikan (AC-16). Mailketing menolak, pesanan tetap tersimpan (AC-51).
- Auth/permission: affiliate B meminta data A dan hanya menerima datanya sendiri atau 404 (NFR-3, AC-34). Member tanpa akses ditolak 403 di endpoint affiliate (AC-3). Kasir ditolak 403 di endpoint admin.

## Build plan

Pendekatan: Tracer Bullet (tidak ada catatan pendekatan di repo, jadi dipakai irisan ujung ke ujung untuk pekerjaan produksi).

1. Migrasi `047_affiliate.sql` lengkap (kolom, tabel, indeks, pemicu), daftar di `migrate.js`, kolom produk di `TABLES.products` dan tipe. Satisfies **AC-23**, **AC-32**, **AC-33** (dasar semua AC).
2. Modul murni `server/affiliate/inti.js`: normalisasi pengaturan, cek berhak, tanda tangan dan baca cookie, hitung komisi per barang dan tier, pilih calon atribusi, buat kode. Diuji vitest lebih dulu. Satisfies **AC-6**, **AC-7**, **AC-8**, **AC-9**, **AC-16**, **AC-21**, **AC-22**, **AC-24**, **AC-26** sampai **AC-31**.
3. Irisan tipis ujung ke ujung: pengaturan admin (GET, PUT), `GET /api/customer/affiliate` (kode otomatis), endpoint klik dengan cookie, atribusi dan komisi tier 1 di `POST /api/public/orders` di dalam savepoint, dashboard affiliate memakai data asli (ringkasan, order, komisi). Satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-10**, **AC-13** sampai **AC-15**, **AC-17**, **AC-20**, **AC-25**, **AC-34**, **AC-47**, **AC-49**.
4. Pembayaran: ringkasan per affiliate, `POST` bayar dengan kunci baris, pengeluaran, riwayat, bukti, aksi massal dua arah, daftar komisi admin dengan filter dan CSV, info affiliate di detail pesanan. Satisfies **AC-2**, **AC-35** sampai **AC-38**.
5. Antrean dan pekerja email tiga jenis, teks Sejoli, lewati alamat uji, coba ulang 3 kali. Satisfies **AC-32**, **AC-36**, **AC-51**, **AC-52**.
6. Referral: upline saat daftar email dan Google, Kaitkan affiliasi, tier 2 sampai 5, halaman Jaringan, ubah upline admin dengan cek putaran, jaringan member admin. Satisfies **AC-19**, **AC-22**, **AC-23**, **AC-30**, **AC-31**, **AC-39** sampai **AC-41**.
7. Undangan: kirim (email langsung karena token hanya ada saat dibuat), batas, kirim ulang, buka undangan, daftar dengan email terisi, status Terdaftar. Satisfies **AC-42** sampai **AC-46**.
8. Produk dan analytics lanjutan: bagian Affiliasi di formulir produk, tombol bagikan di halaman produk, grafik, tabel akuisisi, ringkasan admin, daftar member dan aksinya, menu Affiliate di halaman akun. Satisfies **AC-11**, **AC-12**, **AC-18**, **AC-29**, **AC-48**, **AC-50**.
9. Suite Playwright `scripts/verify_affiliate_*.cjs` didaftarkan di `run_all_checks.cjs`, uji isolasi dua akun, uji kinerja dengan 10.000 pesanan dan 50.000 klik sintetis. Satisfies **NFR-2**, **NFR-3**, dan semua AC lewat [08 Rencana uji](../../08-qa-test-plan.md).

## Consequences

**Positive**:
- Setiap jalur yang mengubah status pesanan (konfirmasi, tolak, batal massal, sinkron kasir, callback Tripay) otomatis menggerakkan komisi tanpa kode tambahan di jalur itu.
- Atribusi tidak bisa dipalsukan dari browser, dan staf tidak bisa mengubahnya lewat `/api/query`.
- Biaya komisi masuk Laba Rugi lewat pengeluaran yang sudah ada.

**Negative / tradeoffs**:
- Logika status berada di dua tempat (pemicu SQL dan kode Node). Siapa pun yang mengubah arti status pesanan harus ingat pemicunya.
- Email affiliate hanya terkirim di tempat pekerja berjalan. Di Vercel antrean menumpuk tanpa dikirim.
- Komisi dihitung sekali saat pesanan dibuat. Penyesuaian harga atau perubahan barang setelahnya tidak menghitung ulang komisi.
- Cookie hanya berlaku di browser yang sama. Pembeli yang mengeklik di HP lalu membeli di laptop tidak tercatat (sama dengan Sejoli).
- Retur sebagian tidak mengurangi komisi (sama dengan Sejoli, Q-7).

**Neutral**:
- Migrasi 047 harus diterapkan di VPS, dan di Supabase bila toko Vercel tetap hidup (Q-8). Tanpa migrasi itu, membaca dan menyimpan produk gagal, karena kolom affiliasi produk sudah masuk daftar kolom yang dibaca server.
- Router aplikasi mendapat dukungan rute awalan `/aff/*`.
- Migrasi affiliate bernomor 047, bukan 044: nomor 044 sampai 046 sudah dipakai integrasi API per toko yang lebih dulu berjalan di VPS (commit `e3e9999`).
- `public/kasir-config.js` kini memuat penyelamat cangkang lama, dan `index.html` membawa `data-cangkang="2"` (D-28). Berkas konfigurasi itu satu-satunya yang selalu diambil dari jaringan oleh aplikasi versi lama, jadi rilis berikutnya yang menambah alamat baru harus menaikkan angka penanda dan mendaftarkan alamatnya di sana. Tanpa itu pengunjung lama dilempar ke `/toko` pada kunjungan pertama setelah deploy.
- Halaman pembuka link membedakan link yang salah (pesan Sejoli) dari gangguan sementara (pengunjung tetap diantar, D-29). Kode status baru dari endpoint klik atau undangan harus masuk salah satu dari dua kelompok itu.
- Kirim undangan dan kirim ulang memegang kunci per affiliate di basis data (`pg_advisory_xact_lock`), email dikirim setelah transaksi selesai (D-30).

## Follow-up

- [ ] Jawaban klien untuk Q-1 sampai Q-11 (besaran komisi, akses, cookie, kontak, pembayaran, undangan, retur, Vercel).
- [ ] Kebijakan privasi toko menyebut affiliate sebagai penerima data bila kontak pembeli dinyalakan.
- [ ] `/sync` menambahkan pola pemicu dan antrean affiliate ke `AGENTS.md` setelah fitur selesai.
- [ ] Sebelum `git push`: terapkan migrasi 047 di Supabase atau matikan toko Vercel (Q-8). Push memicu deploy Vercel, dan tanpa 047 semua pembacaan produk lewat `/api/query` gagal karena kolom affiliasi sudah ada di daftar kolom produk.
- [ ] LCP halaman produk 2,8 detik, di atas NFR-1, sama di versi yang tayang dan versi baru (DF-28). Calon tuas yang belum diuji: pemecahan berkas JS toko dan admin, dan meminta gambar utama begitu data produk tiba. Di luar butir 18, perlu dihargai terpisah.
- [ ] Sebelum deploy yang menambah alamat baru: jalankan `scripts/verify_affiliate_stale_shell.cjs` dengan build commit yang sedang tayang sebagai build lama (TC-84).

## Rationale

Lihat [rationale.md](rationale.md).
