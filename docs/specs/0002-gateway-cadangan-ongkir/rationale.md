# 0002. Rationale: gateway cadangan, DOKU Checkout, ongkir KiriminAja

## Context

Per 17 Okt 2026 produksi memakai Tripay sebagai satu satunya layanan pembayaran otomatis. Pilihan layanan disimpan di `store_payment_settings` (Tripay, Mayar, atau manual) dan hanya satu yang dipakai. Bila Tripay menolak atau tidak bisa dihubungi, daftar kanal checkout kosong dan pembeli hanya bisa membayar manual. Bila Tripay gagal tepat saat Buat Pesanan, pesanan tersimpan tetapi pembeli diminta menghubungi toko.

Ongkir belum dihitung otomatis. Modul server KiriminAja sudah ada (rute `/api/public/shipping-rates`), tetapi checkout tidak memanggilnya, jalur wilayah di modul itu tidak cocok dengan OpenAPI KiriminAja 6.2.0, dan staf mengisi ongkir manual saat konfirmasi. Untuk pembayaran online, ongkir ditagih terpisah.

Keputusan user (17 Okt 2026): D1 pindah layanan berlaku juga untuk pesanan yang sama saat Buat Pesanan gagal; D2 ongkir ikut ditagih di pembayaran online; D3 pembeli memilih kurir; D4 hanya tarif dan alamat sampai kelurahan, request pickup belum, tetapi data harus siap. Sasaran: client cukup mengisi kunci.

Kode pembayaran hanya ada di rilis produksi (kode leader, belum di GitHub), jadi pekerjaan dilakukan di salinan rilis `20261017-hardening-qc` lalu dipasang dengan gabung tiga arah.

## Options considered

### Rantai cadangan

**Opsi A: Admin memindah layanan manual (keadaan sekarang).** Tidak ada kode baru. Pembeli tetap tertahan selama admin belum sadar ada gangguan.

**Opsi B: Rantai cadangan di server (dipilih).** Server mencoba layanan utama, lalu layanan aktif berikutnya, baik saat daftar kanal maupun saat membuat pembayaran. Satu tempat aturan, bisa diuji, tidak bergantung pada browser.

**Opsi C: Browser mencoba ulang ke layanan lain.** Browser tidak boleh memegang kunci, dan pesanan bisa tercipta dua kali bila jaringan pembeli putus di tengah.

### Cara pembayaran DOKU

**Opsi A: DOKU Checkout, halaman bayar DOKU (dipilih).** Satu endpoint `POST /checkout/v1/payment`, DOKU menampilkan metode yang aktif di akun toko, sama dengan pola Tripay yang membawa pembeli ke halaman penyedia.

**Opsi B: DOKU Direct API per kanal (VA, QRIS, dompet digital).** Kode bayar bisa tampil di toko, tetapi tiap kanal punya endpoint, tanda tangan, dan aktivasi sendiri. Jauh lebih banyak kode untuk layanan cadangan.

### Wilayah alamat untuk ongkir

**Opsi A: Pilihan bertingkat dari KiriminAja (dipilih).** ID kecamatan dan kelurahan tepat, cocok dengan pola `<select>` bawaan yang sudah dipakai checkout di HP, dan mudah disimpan sementara di server.

**Opsi B: Kotak cari kelurahan (`GET /api/mitra/v6.1/addresses`).** Lebih cepat untuk pembeli yang tahu nama kelurahan, tetapi setiap ketikan memakan kuota (sandbox 10 permintaan per menit) dan hasil nama mirip membingungkan.

**Opsi C: Mencocokkan nama provinsi dan kota bawaan ke ID KiriminAja.** Nama tidak selalu sama ("Kota Surabaya" lawan "Surabaya"), dan kecamatan serta kelurahan tetap harus dipilih.

### Pelunasan DOKU

**Opsi A: Notifikasi sebagai petunjuk, pelunasan dari Check Status API (dipilih).** Sama dengan pola Mayar di kode leader (webhook hanya petunjuk). Tetap jalan walau notifikasi belum diatur di Back Office, lewat pemeriksaan berkala `reconcilePayments`.

**Opsi B: Percaya tanda tangan notifikasi saja.** Lebih cepat satu panggilan, tetapi rincian format tanda tangan notifikasi DOKU tidak lengkap di dokumentasi, dan tanpa alamat notifikasi pesanan tidak pernah lunas.

## Rationale

Rantai di server dipilih karena aturan uang harus ada di satu tempat yang memegang kunci, dan karena D1 menuntut pesanan yang sama dipindah, yang hanya aman dilakukan setelah pesanan tersimpan di transaksi database. Urutan Tripay, Mayar, DOKU mengikuti permintaan user.

DOKU Checkout dipilih karena DOKU di sini adalah cadangan kedua: yang penting pembayaran bisa diterima, bukan tampilan per kanal. Satu endpoint juga berarti satu tanda tangan yang bisa dibuktikan di sandbox.

Ongkir dihitung ulang di server karena total pesanan menentukan jumlah tagihan; angka dari browser bisa diubah. Wilayah bertingkat dipilih karena datanya jarang berubah, sehingga satu kali ambil per wilayah cukup, dan kuota KiriminAja aman.

## References

**Project sources**:
- Kode leader di rilis produksi: `server/integrasi/payments.js` (pilihan layanan, `reconcilePayments`, webhook Mayar sebagai petunjuk), `server/integrasi/kiriminaja.js`, `server/integrasi/settings.js` (enkripsi kunci), rute `/api/public/orders` dan `/api/rpc/confirm_web_order` di `server/index.js`.
- Data produksi 17 Okt 2026: 281 dari 282 produk aktif berkolom `weight_gram` terisi; `store_integrations` berisi tripay dan onesender saja.

**Practices & standards**:
- Pelunasan dari API penyedia yang terautentikasi, bukan dari isi webhook.
- Angka uang dihitung di server.
- Fitur tidur sampai dikonfigurasi, supaya pemasangan ke produksi tidak mengubah perilaku.

**Links** (dibuka 17 Okt 2026):
- DOKU Checkout backend integration: https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration.md
- DOKU signature dari header (non SNAP): https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header.md
- DOKU Check Status (non SNAP): https://developers.doku.com/get-started-with-doku-api/check-status-api/non-snap.md
- DOKU override notification URL: https://developers.doku.com/get-started-with-doku-api/notification/override-notification-url.md
- DOKU contoh notifikasi non SNAP: https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap.md
- DOKU registrasi sandbox: https://developers.doku.com/get-started-with-doku-api/user-registration.md
- KiriminAja Mitra API 6.2.0 (OpenAPI): https://developer.kiriminaja.com/docs/openapi/json
