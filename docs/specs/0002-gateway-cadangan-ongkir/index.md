# 0002. Gateway pembayaran cadangan, DOKU Checkout, dan ongkir KiriminAja di checkout

**Date**: 2026-10-17
**Status**: In Progress

## Summary

Toko online kini hanya memakai satu layanan pembayaran (Tripay). Kalau Tripay gangguan, pembeli hanya bisa bayar manual. Spec ini menambah tiga hal: pembayaran otomatis pindah ke layanan cadangan (Mayar, lalu DOKU) untuk pesanan yang sama, DOKU sebagai layanan pembayaran baru, dan ongkir KiriminAja yang dihitung langsung di checkout lalu ikut ditagih. Tujuannya satu: client cukup mengisi kunci layanan di Pengaturan, lalu fiturnya jalan tanpa ngoding lagi. Selama kunci belum diisi, toko berjalan persis seperti sekarang.

## Requirements

**User stories**:
- Sebagai pembeli, saya ingin tetap bisa bayar online walau Tripay sedang gangguan, supaya pesanan saya tidak tertahan.
- Sebagai pembeli, saya ingin melihat ongkir dan memilih kurir sebelum membayar, supaya total yang saya bayar sudah final.
- Sebagai admin toko, saya ingin cukup menempel kunci DOKU, Mayar, atau KiriminAja di Pengaturan, supaya layanan itu langsung dipakai tanpa bantuan developer.
- Sebagai staf, saya ingin ongkir yang sudah dibayar pembeli terkunci saat konfirmasi, supaya total pesanan tidak berubah setelah lunas.

**Acceptance criteria**:

Gateway cadangan (keputusan user D1):
- **AC-1**: Daftar kanal checkout memakai layanan utama (pilihan di Pengaturan, bawaan Tripay). Bila layanan utama melempar galat atau tidak punya kanal aktif, daftar diambil dari layanan aktif berikutnya dengan urutan Tripay, Mayar, DOKU (layanan utama selalu dicoba pertama). Respons menyebut layanan yang dipakai.
- **AC-2**: Saat Buat Pesanan, bila pembuatan pembayaran di layanan terpilih gagal, server mencoba layanan aktif berikutnya untuk pesanan yang sama. Pesanan mencatat layanan yang berhasil dan layanan asal (`payment_failover_from`). Pembeli dibawa ke pembayaran layanan cadangan tanpa membuat pesanan baru.
- **AC-3**: Bila semua layanan gagal, pesanan tetap tersimpan satu kali dan pembeli menerima pesan yang sama seperti sekarang (hubungi toko). Tidak ada pesanan ganda.
- **AC-4**: Hanya layanan yang aktif dan berkunci lengkap yang ikut rantai cadangan. Dengan hanya Tripay terpasang (keadaan produksi 17 Okt 2026), perilaku checkout identik dengan sekarang.

DOKU Checkout:
- **AC-5**: Admin menyimpan Client ID, Secret Key, dan mode DOKU (sandbox atau production). Tombol Tes koneksi memeriksa kunci tanpa membuat pembayaran. Panel menampilkan alamat notifikasi yang perlu ditempel di DOKU Back Office.
- **AC-6**: Pembayaran DOKU dibuat lewat DOKU Checkout dengan nominal `payment_amount` dan nomor invoice = nomor pesanan. Pembeli dibawa ke halaman bayar DOKU, lalu kembali ke daftar pesanan di akun.
- **AC-7**: Pesanan DOKU menjadi lunas lewat notifikasi DOKU, atau lewat pemeriksaan berkala bila notifikasi tidak datang. Kedua jalur memastikan status lewat Check Status API DOKU; nomor invoice dan nominal harus cocok, kalau tidak pesanan tidak diubah dan kejadiannya dicatat di log.
- **AC-8**: DOKU bisa dipilih sebagai layanan utama di Pengaturan, sama seperti Tripay dan Mayar.

Ongkir KiriminAja (keputusan user D2, D3, D4):
- **AC-9**: Bila KiriminAja aktif (aktif, token, dan alamat asal terisi), alamat checkout memakai wilayah KiriminAja: Provinsi, Kota/Kabupaten, Kecamatan, Kelurahan. Wilayah tersimpan di pesanan dan di profil pembeli untuk checkout berikutnya.
- **AC-10**: Setelah kelurahan dipilih, checkout menampilkan pilihan kurir (nama kurir, layanan, ongkir, perkiraan sampai), urut dari termurah. Pembeli wajib memilih satu sebelum Buat Pesanan. Total = barang dikurangi voucher ditambah ongkir.
- **AC-11**: Server menghitung ulang ongkir dari KiriminAja saat Buat Pesanan, tidak memakai angka dari layar. Bila layanan kurir terpilih tidak tersedia lagi atau ongkirnya berubah, pesanan ditolak (409) dengan pesan supaya pembeli memilih ulang, dan daftar terbaru dikirim balik.
- **AC-12**: Ongkir ikut ditagih di pembayaran online: `payment_amount` = total termasuk ongkir untuk Tripay, Mayar, dan DOKU. Tagihan Tripay memuat baris Ongkir.
- **AC-13**: Saat staf mengonfirmasi pesanan berongkir KiriminAja, ongkir tampil terkunci dan total tidak berubah. Server menolak perubahan ongkir untuk pesanan itu.
- **AC-14**: Bila KiriminAja tidak aktif, checkout sama persis seperti sekarang (Provinsi dan Kota dari daftar bawaan, tulisan "Ongkir dihitung toko").
- **AC-15**: Admin memilih alamat asal kirim lewat pilihan bertingkat wilayah KiriminAja, bukan mengetik angka ID.
- **AC-16**: Pesanan menyimpan semua data yang dibutuhkan request pickup KiriminAja nanti (kurir, layanan, ID kecamatan dan kelurahan tujuan, berat, nilai barang, penerima). Request pickup sendiri belum dibuat.

Kunci langsung jalan:
- **AC-17**: Menyimpan kunci Mayar yang aktif otomatis mendaftarkan webhook Mayar (tanpa membuka dashboard Mayar). Kegagalannya ditampilkan ke admin, kunci tetap tersimpan.

## Decision

**Chosen option**: rantai cadangan di server, DOKU lewat halaman Checkout DOKU, dan wilayah KiriminAja bertingkat dengan ongkir dihitung ulang di server. Alasan lengkap ada di [rationale.md](rationale.md).

Semua fitur tidur sampai kuncinya diisi: tanpa kunci Mayar, DOKU, atau KiriminAja, jalur kode baru tidak pernah dipanggil.

## Feature design

**Tempat kode**: salinan sumber rilis produksi (kode leader, belum ada di GitHub), dikerjakan seperti T5, lalu dipasang dengan gabung tiga arah. Berkas utama: `server/index.js`, `server/integrasi/{payments,settings,kiriminaja,doku}.js`, `src/pages/public/PublicCheckout.tsx`, `src/components/public/KolomAlamat.tsx`, `src/lib/publicPayments.ts`, `src/components/settings/IntegrationsPanel.tsx`, `src/pages/Orders.tsx`, `src/lib/receipt.ts`.

**Data model sketch** (migrasi `057_gateway_cadangan_ongkir.sql`):
- `store_integrations.provider` check ditambah `doku`. Konfigurasi DOKU terenkripsi seperti layanan lain: `{ enabled, mode, clientId, secretKey }`.
- `store_payment_settings.provider` check ditambah `doku`.
- `orders.payment_provider` check ditambah `doku`.
- `orders` kolom baru, semua boleh kosong:
  - `payment_failover_from text` (layanan asal bila pindah)
  - `delivery_district text`, `delivery_subdistrict text` (nama kecamatan dan kelurahan)
  - `delivery_district_id integer`, `delivery_subdistrict_id integer` (ID KiriminAja)
  - `shipping_courier text` (kode kurir, misal `jne`), `shipping_service text` (kode layanan, misal `REG`), `shipping_service_name text`, `shipping_etd text`, `shipping_weight_gram integer`
- `customers.address_wilayah jsonb` boleh kosong: `{ provinsi_id, provinsi, kota_id, kota, kecamatan_id, kecamatan, kelurahan_id, kelurahan }`.
- Kolom baru didaftarkan di tiga tempat yang wajib sinkron: `TABLES.orders` di `server/index.js`, `REQUIRED_COLUMNS` di `server/migrate.js`, tipe `Order` di `src/types`.

**State transitions**: tidak ada status baru. Pesanan web tetap `awaiting_confirmation` lalu `done` atau `canceled`; `payment_status` tetap `unpaid` lalu `paid`. Pindah layanan hanya mengganti kolom `payment_*` sebelum pembeli membayar.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/public/payment-channels` | GET | store_id, amount | active, provider, mode, channels, cadangan_dari | publik | 503 semua layanan gagal |
| `/api/public/orders` | POST | isian lama + `shipping: { courier, service }`, `delivery_wilayah: {provinsi_id, kota_id, kecamatan_id, kelurahan_id, nama...}` | order_id, order_number, payment `{provider, checkout_url, pindah_dari}` | pembeli | 409 ongkir berubah (+ `shipping_options`), 503 ongkir gagal dihitung |
| `/api/public/wilayah` | GET | level (provinsi, kota, kecamatan, kelurahan), induk | `[{id, nama}]` | publik, batas per IP | 404 KiriminAja tidak aktif, 429 |
| `/api/public/shipping-rates` | POST | store_id, kecamatan_id, kelurahan_id, items `[{product_id, qty}]` | active, options `[{courier, service, nama, ongkir, etd}]`, berat_gram | publik, batas per IP | 400 wilayah kosong, 503 KiriminAja gagal |
| `/api/doku/notifikasi` | POST | header Client-Id, Request-Id, Request-Timestamp, Signature; body notifikasi DOKU | 200 | tanda tangan DOKU | 200 juga untuk notifikasi yang diabaikan |
| `/api/admin/integrations/doku` | PATCH (baca lewat GET `/api/admin/integrations`) | enabled, mode, clientId, secretKey | konfigurasi publik (tanpa rahasia), `notificationUrl` | admin integrasi | 400 isian tidak lengkap |
| `/api/admin/integrations/doku/test` | POST | | pesan berhasil | admin integrasi | 502 kunci ditolak |
| `/api/admin/integrations/kiriminaja/wilayah` | GET | level, induk | `[{id, nama}]` | admin integrasi | 400 token belum disimpan |
| `/api/customer/me` | PATCH | isian lama + `wilayah` | me + wilayah | pembeli | 400 |
| `/api/rpc/confirm_web_order` | POST | p_order_id, p_shipping_cost | | staf | 409 sudah diproses |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Daftar kanal | urutan layanan | layanan utama dari `store_payment_settings` (bawaan tripay), lalu sisa dari urutan tetap tripay, mayar, doku |
| Daftar kanal | layanan aktif | `loadIntegration` + `tripayAktif` / `mayarAktif` / `dokuAktif` |
| Daftar kanal DOKU | kanal yang tampil | satu pilihan `DOKU` (halaman DOKU menampilkan metode yang aktif di akun DOKU toko) |
| Buat pesanan | ongkir | dihitung ulang server: `kiriminaja.tarifOngkir` dengan asal dari konfigurasi KiriminAja toko, tujuan dari `delivery_wilayah`, berat dari produk |
| Buat pesanan | berat | jumlah `products.weight_gram` x qty; produk tanpa berat dihitung 1000 g |
| Buat pesanan | nilai barang | subtotal setelah voucher |
| Buat pesanan | total | subtotal dikurangi voucher ditambah ongkir |
| Buat pesanan | payment_amount | total (termasuk ongkir) |
| Pindah layanan | metode setara | peta kanal: QRIS ke QRIS, VA bank ke VA bank yang sama, dompet digital ke dompet yang sama, lainnya ke halaman umum layanan cadangan |
| DOKU | invoice_number | `orders.order_number` |
| DOKU | payment_reference | `response.payment.token_id`; `payment_transaction_id` = Request-Id pembuatan |
| DOKU | lunas | Check Status API: `transaction.status = SUCCESS`, `order.invoice_number` dan `order.amount` cocok |
| Notifikasi DOKU | alamat | `${ASAL_TOKO}/api/doku/notifikasi`, ditampilkan di panel |
| Konfirmasi staf | ongkir terkunci | `orders.shipping_service is not null` |
| Wilayah | daftar | KiriminAja `/api/mitra/province`, `/city`, `/kecamatan`, `/kelurahan`, disimpan di memori server 24 jam |

**Key invariants**:
- Satu pesanan punya paling banyak satu pembayaran aktif. Pindah layanan hanya terjadi bila layanan sebelumnya gagal membuat pembayaran (tidak pernah setelah kode bayar diterima pembeli).
- Status lunas hanya diambil dari API layanan yang terautentikasi (Tripay callback bertanda tangan, Mayar API, DOKU Check Status), dengan nominal dan referensi yang cocok.
- Ongkir di pesanan selalu angka hitungan server.
- Pesanan berongkir KiriminAja tidak bisa diubah ongkirnya saat konfirmasi.
- Tanpa kunci layanan baru, tidak ada permintaan keluar ke Mayar, DOKU, atau KiriminAja.

**Security model**:
- Kunci DOKU terenkripsi di `store_integrations` (AES GCM yang sama); Secret Key tidak pernah dikirim ke browser, panel hanya tahu "sudah tersimpan".
- Notifikasi DOKU diperiksa tanda tangannya (HMAC SHA256, Request-Target = jalur notifikasi kita); apa pun hasilnya, pelunasan hanya dari Check Status API.
- Endpoint wilayah dan ongkir publik dibatasi per IP dan memakai simpanan sementara supaya kuota KiriminAja (60 permintaan per menit di paket Basic) tidak habis oleh satu pengunjung.
- Hanya admin dengan izin integrasi yang bisa menyimpan kunci dan membaca wilayah admin.
- Lingkup kepatuhan: pembayaran diproses di halaman penyedia (kartu tidak pernah melewati server toko).

**Configuration required**: tidak ada variabel lingkungan baru. Semua kunci diisi di Pengaturan, Integrasi.

**Critical test scenarios**:
- Tripay dipaksa gagal (kunci salah di lokal), DOKU sandbox aktif: daftar kanal menampilkan DOKU; Buat Pesanan diarahkan ke halaman DOKU sandbox; pesanan mencatat `payment_failover_from = tripay`; verifies **AC-1**, **AC-2**.
- Semua layanan gagal: satu pesanan tersimpan, pesan galat tampil; verifies **AC-3**.
- Hanya Tripay aktif: respons daftar kanal dan pesanan sama dengan sebelum perubahan; verifies **AC-4**, **AC-14**.
- DOKU sandbox: Tes koneksi berhasil dengan kunci benar dan gagal dengan kunci salah; pembayaran dibuat dan URL halaman DOKU sandbox terbuka; setelah simulasi bayar, pemeriksaan status membuat pesanan lunas; verifies **AC-5**, **AC-6**, **AC-7**.
- Notifikasi DOKU palsu (tanda tangan salah atau nominal beda): pesanan tidak berubah; verifies **AC-7**.
- KiriminAja sandbox: pilih wilayah sampai kelurahan, daftar kurir tampil, total bertambah ongkir, pesanan tersimpan dengan kurir dan ongkir hitungan server; verifies **AC-9**, **AC-10**, **AC-11**, **AC-12**.
- Ongkir dikirim berbeda dari layar (dimanipulasi): server memakai angka hitungannya atau menolak 409; verifies **AC-11**.
- Konfirmasi staf pesanan berongkir: kolom ongkir terkunci, total tetap; verifies **AC-13**.
- HP 393 px dan desktop 1440 px: alamat bertingkat dan pilihan kurir bisa disentuh (44 px), tidak meluap; verifies **AC-9**, **AC-10**.

## Build plan

Urutan: benang tipis ujung ke ujung dulu per fitur, lalu ditebalkan (Tracer Bullet).

1. Migrasi 057 dan pendaftaran kolom di tiga tempat, satisfies **AC-2**, **AC-8**, **AC-9**, **AC-16**
2. Modul `server/integrasi/doku.js`: tanda tangan, buat pembayaran, cek status, verifikasi notifikasi, plus uji unit, satisfies **AC-5**, **AC-6**, **AC-7**
3. Pengaturan: provider `doku` di settings (validasi, konfigurasi publik), rute tes, `selectGateway` menerima doku, Mayar mendaftarkan webhook saat disimpan, satisfies **AC-5**, **AC-8**, **AC-17**
4. Rantai cadangan di `payments.js`, rute daftar kanal, rute buat pesanan, `readPayment` untuk doku, rute notifikasi, pemeriksaan berkala, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-7**
5. KiriminAja: perbaiki jalur wilayah sesuai OpenAPI 6.2, simpanan sementara wilayah, rute wilayah publik dan admin, rute ongkir dengan berat dari server, hitung ulang ongkir di buat pesanan, baris Ongkir di tagihan Tripay, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-15**, **AC-16**
6. Checkout: alamat bertingkat KiriminAja, pilihan kurir, total dengan ongkir, isian baru di kiriman pesanan, penanganan 409, catatan pindah layanan; tulisan "ongkir ditagih terpisah" di ringkasan checkout dan di halaman bayar Mayar diganti "sudah termasuk ongkir" untuk pesanan berongkir KiriminAja (respons pembayaran pembeli membawa penanda `termasuk_ongkir`), satisfies **AC-1**, **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-14**
7. Admin: formulir DOKU, pemilih alamat asal KiriminAja, pilihan layanan utama dengan DOKU dan keterangan cadangan, detail pesanan menampilkan kurir dan wilayah, dialog konfirmasi mengunci ongkir, label kirim menampilkan kurir, satisfies **AC-5**, **AC-8**, **AC-13**, **AC-15**
8. Uji: unit (vitest) untuk doku dan rantai cadangan; Playwright lokal dengan sandbox DOKU dan KiriminAja; regresi suite yang ada, satisfies semua AC
9. QC sub agen di 393 px dan 1440 px, lalu pasang ke produksi dalam keadaan tidur dan uji asap, satisfies **AC-4**, **AC-14**

## Consequences

**Positive**:
- Gangguan Tripay tidak lagi menghentikan pembayaran online, selama layanan cadangan berkunci.
- Pembeli membayar total final, staf tidak lagi mengisi ongkir manual untuk pesanan KiriminAja.
- Menambah layanan cukup lewat Pengaturan.

**Negative / tradeoffs**:
- Pembayaran DOKU tampil sebagai satu pilihan (halaman DOKU), bukan daftar kanal per bank seperti Tripay.
- Tanpa alamat notifikasi di DOKU Back Office, pelunasan DOKU baru terdeteksi lewat pemeriksaan berkala (paling lambat sekitar 5 menit).
- Checkout bergantung pada KiriminAja saat aktif; gangguan KiriminAja membuat pembeli tidak bisa memilih kurir (lihat Follow-up AS-3).
- Kode berada di salinan kode leader; bentrok mungkin terjadi bila leader mengubah berkas yang sama sebelum push.

**Neutral**:
- Satu migrasi menambah kolom yang semuanya boleh kosong; pesanan lama tidak berubah.
- Halaman Profil & Alamat akun tetap memakai daftar bawaan; wilayah KiriminAja disimpan dari checkout.

## Follow-up

Asumsi yang saya ambil saat user tidak di tempat (user sudah memutuskan D1 sampai D4; sisanya rekomendasi saya, mohon ditinjau):
- [ ] **AS-1**: DOKU tampil sebagai satu pilihan "Bayar lewat DOKU", karena daftar metode aktif ada di akun DOKU toko. Pengganti: daftar per metode dengan `payment_method_types`.
- [ ] **AS-2**: Produk tanpa berat dihitung 1000 g (281 dari 282 produk aktif sudah berberat).
- [ ] **AS-3**: Bila KiriminAja gagal menghitung ongkir, pembeli melihat pesan dan tombol coba lagi; Buat Pesanan tertahan sampai kurir dipilih. Pengganti: izinkan pesan dengan "ongkir dikonfirmasi toko".
- [ ] **AS-4**: Ongkir berubah antara layar dan pesanan: tolak 409 dan tampilkan harga baru.
- [ ] **AS-5**: Bayar di tempat (COD) tetap metode manual toko; COD lewat KiriminAja belum termasuk.
- [ ] **AS-6**: Asuransi kiriman tidak dipakai.
- [ ] Request pickup KiriminAja (dikerjakan bila client meminta, data sudah tersimpan per AC-16).
- [x] Bukti DOKU sandbox asli (17 Okt 2026): kunci salah ditolak, kunci benar diterima; pesanan pindahan dari Tripay membuka halaman bayar DOKU asli IDR 710.000 (termasuk ongkir); setelah bayar lewat simulator VA BCA, pemeriksaan berkala melunasi pesanan dalam sekitar 2 menit tanpa alamat notifikasi.
- [ ] Bukti KiriminAja asli: tautan pendaftaran sandbox di dokumentasi KiriminAja (sandbox.kiriminaja.com) tidak ada di DNS; butuh token dari akun client atau dukungan KiriminAja (A3).
- [ ] Sisa QC 17 Okt 2026 yang sengaja tidak diubah: tombol dialog admin 32px di HP (komponen Button bersama, berdampak ke semua dialog); catatan pindah layanan ke pembeli (pembeli langsung dialihkan ke halaman bayar); nilai pixel Purchase tanpa ongkir (sesuai kebiasaan nilai barang).
- [ ] Gabungkan ke GitHub setelah leader push kode pembayarannya (A13, A16).

## Rationale

Lihat [rationale.md](rationale.md).
