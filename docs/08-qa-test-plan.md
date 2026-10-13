# 08 Rencana uji: Program Affiliate

Produk: Toko online GNNK Racing · Versi 0.1 · 11 Okt 2026 · Status: draft · Terkait: [02 PRD](02-prd.md), [Spesifikasi 0001](specs/0001-program-affiliate/index.md)

## 1. Tujuan

Membuktikan setiap kriteria penerimaan AC-1 sampai AC-84 dan NFR-1 sampai NFR-11 untuk rilis pertama Program Affiliate (irisan 1 dan 2), sebelum dipasang di VPS.

## 2. Cakupan

**Masuk:** semua layar affiliate dan admin, endpoint affiliate, pemicu status, antrean email, migrasi 047.

**Keluar:** pengiriman email sungguhan ke kotak masuk (diuji sampai batas Mailketing dengan alamat uji yang dilewati, dan satu uji manual ke alamat milik tim), HP fisik.

## 3. Pendekatan

| Tingkat | Alat | Isi |
|---|---|---|
| Unit | vitest (`server/__tests__/affiliate.test.js`) | Fungsi murni: pengaturan, berhak, cookie, komisi, atribusi, kode |
| Integrasi | Node + PostgreSQL lokal | Pemicu status, kunci baris pembayaran, CTE jaringan |
| Ujung ke ujung | Playwright (`scripts/verify_affiliate_*.cjs`, didaftarkan di `run_all_checks.cjs`) | Alur pengguna sungguhan di browser, dicocokkan dengan query basis data |
| Kinerja | skrip Node dengan data sintetis | p95 endpoint dashboard dan ringkasan admin |
| Manual | QC sub agen di 393 x 852 dan 1440 x 900 | Tampilan, keterbacaan, sentuhan |

## 4. Lingkungan dan data

- Lokal: PostgreSQL 16, server `node server/index.js` di port 3000, Vite di 5173, toko lokal `fff01e2c-4033-492d-a60d-de58c4e07117`.
- Akun terpisah per peran: admin `admin@example.com`; affiliate A dan affiliate B (akun pembeli berbeda, untuk uji isolasi); upline U; pembeli P; member tanpa akses N; kasir K.
- Email memakai domain `contoh.id` supaya dilewati server (tidak ada email keluar dari uji).
- Undangan: token diketahui uji dengan menyisipkan baris undangan bersidik token yang dibuat uji, karena server tidak pernah mengembalikan token asli.
- Setiap suite mengembalikan pengaturan program dan pengaturan produk ke nilai semula, lalu menghapus akun uji putarannya (`aff.*.{cap}@contoh.id`) beserta pesanannya (stok dikembalikan lewat RPC `void_orders`), komisi, pembayaran, pengeluaran, klik, undangan, dan antreannya (`bersihkanUji` di `scripts/lib/affiliate.cjs`). Uji kinerja juga menghapus data volumenya.
- Pendaftaran dan checkout dibatasi per IP (20 per 10 menit). Panggilan uji memakai alamat dari rentang uji RFC 2544 (198.18.0.0/15) supaya suite tidak saling meracuni.

## 5. Kriteria masuk dan keluar

**Masuk:** migrasi 047 lolos di basis data lokal, `npm run typecheck` bersih.

**Keluar:** setiap AC punya minimal satu TC lolos, regresi penuh `run_all_checks.cjs` hijau, tidak ada DF terbuka yang mematahkan AC, QC sub agen tanpa temuan berat, audit sambungan dua putaran berturut-turut bersih.

## 6. Kasus uji

### Akses dan privasi

| TC | Judul | Langkah dan hasil yang diharapkan | AC | Otomatis |
|---|---|---|---|---|
| TC-1 | Program mati | Matikan program, buka link sah: tiba di `/toko`, tidak ada cookie `gnnk_aff`, tidak ada baris klik | AC-1 | ya |
| TC-2 | Bayar setelah program mati | Komisi Belum dibayar ada, program dimatikan, admin membayar: berhasil | AC-2 | ya |
| TC-3 | Mode hanya yang diizinkan | Member N berakses Ikut pengaturan membuka dashboard: pesan akses, kode tetap kosong di DB | AC-3, AC-5 | ya |
| TC-4 | Diblokir di mode semua | Mode Semua member, member berstatus Diblokir: pesan akses dan endpoint affiliate 403 | AC-4 | ya |
| TC-5 | Isolasi dua affiliate | B memanggil semua GET affiliate: hanya data B. B mengirim ulang undangan milik A: 404 | AC-34, NFR-3 | ya |
| TC-6 | Kontak disembunyikan | Saklar kontak mati: JSON order dan jaringan tidak memuat telepon dan email | AC-40, AC-49 | ya |
| TC-7 | Admin saja | Kasir K memanggil endpoint admin affiliate: 403. Membuka `/affiliate`: dialihkan | NFR-3 | ya |

### Alur utama

| TC | Judul | Langkah dan hasil yang diharapkan | AC | Otomatis |
|---|---|---|---|---|
| TC-10 | Kode otomatis | Member "Andi Saputra" berhak membuka dashboard: kode `ANDI` + 2 angka, unik | AC-9 | ya |
| TC-11 | Link produk | Pilih produk di halaman Link: teks link persis `/aff/{KODE}/{id}`, Salin menyalin teks itu | AC-10 | ya |
| TC-12 | Produk tidak diaffiliasikan | Matikan affiliasi produk X: tidak muncul di pencarian link | AC-11 | ya |
| TC-13 | Parameter | Platform Facebook, ID `story-okt`: link berakhiran `?utm_source=fb&utm_media=story-okt` | AC-12 | ya |
| TC-14 | Buka link | Pengunjung membuka link produk: tiba di halaman produk, cookie berisi `g` dan `p[produk]`, satu baris klik | AC-13 | ya |
| TC-15 | Galat link | Kode tidak dikenal dan produk "jika sudah membeli": pesan Sejoli, tanpa cookie | AC-14, AC-15 | ya |
| TC-16 | Klik sendiri | Affiliate masuk membuka linknya sendiri: jumlah klik tetap | AC-17 | ya |
| TC-17 | Tombol bagikan produk | Affiliate masuk di halaman produk: tombol menyalin link. Member N: tombol tidak ada | AC-18 | ya |
| TC-18 | Daftar dari link | Pengunjung bercookie A mendaftar: upline A, sumber `link` | AC-19 | ya |
| TC-19 | Checkout dari link | Pesanan pengunjung bercookie A: `affiliate_id` A, sumber `link`, parameter akuisisi tersimpan, komisi Order belum selesai | AC-20, AC-26 | ya |
| TC-20 | Konfirmasi | Staf mengonfirmasi: komisi Belum dibayar, antrean `komisi_masuk` bertambah | AC-32 | ya |
| TC-21 | Pembayaran lengkap | Bayar dengan bukti dan pengeluaran: komisi Sudah dibayar, riwayat, pengeluaran di halaman Pengeluaran dan Laba Rugi, antrean `komisi_dibayar` | AC-36 | ya |
| TC-22 | Ringkasan sama dengan DB | Data uji diketahui: angka layar sama dengan query | AC-47, NFR-9 | ya |
| TC-23 | Jaringan dan kedalaman | A ke B ke C, kedalaman 1 lalu 2 | AC-39 | ya |
| TC-24 | Undangan terkirim | Kirim undangan email baru: status Terkirim, DB menyimpan sidik saja | AC-42 | ya |
| TC-25 | Undangan dibuka dan daftar | Buka token sah, daftar: Dibuka lalu Terdaftar, upline pengundang sumber `undangan`, klik jenis undangan | AC-45 | ya |
| TC-26 | Akuisisi | 2 klik fb/story-okt dan 1 tanpa parameter: dua baris dengan View 2 dan 1 | AC-48 | ya |
| TC-27 | Ringkasan admin | Rentang tanggal: angka sama dengan query | AC-50 | ya |

### Aturan dan galat

| TC | Judul | Langkah dan hasil yang diharapkan | AC | Otomatis |
|---|---|---|---|---|
| TC-30 | Cookie 30 hari | Max-Age cookie 2.592.000 detik ±60 | AC-6 | ya |
| TC-31 | Cookie selamanya | Umur 0: Max-Age minimal 315.360.000 | AC-7 | ya |
| TC-32 | Validasi persen | Simpan 120%: pesan "Persentase komisi harus 0 sampai 100.", DB tidak berubah | AC-8 | ya |
| TC-33 | Cookie dipalsukan | Ubah isi cookie tanpa tanda tangan baru: pesanan tanpa affiliate | AC-16 | ya |
| TC-34 | Beli lewat link sendiri | A membeli dengan cookie A: tanpa affiliate dan komisi | AC-21 | ya |
| TC-35 | Kaitkan affiliasi | Pembeli ber-upline B, cookie A: pesanan atas B sumber `kaitan` | AC-22 | ya |
| TC-36 | Kaitkan mengisi upline | Pembeli tanpa upline checkout dengan cookie A: upline A sumber `checkout` | AC-23 | ya |
| TC-37 | General cookie mati | Cookie A untuk produk X, keranjang hanya Y: tanpa affiliate | AC-24 | ya |
| TC-38 | Akses dicabut | Cookie A lalu akses A dicabut: tanpa affiliate | AC-25 | ya |
| TC-39 | Rumus komisi | Unit: 10% dari 655.000 = 65.500; diskon dibagi sebanding 9.000 dan 27.000; tetap 5.000 x 3 = 15.000; komisi khusus 5% | AC-26 sampai AC-29 | ya |
| TC-40 | Tier dan putaran | Unit dan DB: C ke B ke A, 2 tier; rantai berputar | AC-30, AC-31 | ya |
| TC-41 | Batal massal | Komisi Belum dibayar, batal massal: Dibatalkan | AC-33 | ya |
| TC-42 | Aksi massal komisi | Konfirmasi pembayaran lalu Ubah ke Belum Dibayar: kembali, pembayaran dan pengeluaran ikut dikurangi | AC-35 | ya |
| TC-43 | Bayar ganda | Dua permintaan bayar bersamaan: satu pembayaran | AC-37 | ya |
| TC-44 | Batal setelah dibayar | Bayar lalu batalkan pesanan: tampil di filter Perlu ditindaklanjuti | AC-38 | ya |
| TC-45 | Upline berputar | Jadikan downline sebagai upline: pesan galat, DB tetap | AC-41 | ya |
| TC-46 | Undangan ditolak | Email member, ganda 24 jam, batas harian | AC-43, AC-44 | ya |
| TC-47 | Undangan kedaluwarsa | `expires_at` lewat: pesan kedaluwarsa, tanpa cookie | AC-46 | ya |
| TC-48 | Email gagal | Mailketing menolak: pesanan tetap ada, percobaan bertambah, berhenti di 3 | AC-51, NFR-11 | ya |
| TC-49 | Alamat uji | Alamat `contoh.id`: antrean `skipped` | AC-52 | ya |

### Sambungan dengan fitur lain (ditambahkan saat pembangunan)

| TC | Judul | Langkah dan hasil yang diharapkan | AC | Otomatis |
|---|---|---|---|---|
| TC-66 | Varian produk | General cookie mati, link varian X1, beli varian X2 (SKU Induk sama): tercatat. Produk lain: tidak. Syarat sudah membeli terpenuhi lewat varian lain | AC-53, AC-54 | ya |
| TC-67 | Umur cookie di server | Cookie bertanda tangan sah berumur 29 hari berlaku, 31 hari tidak. Umur 0: 400 hari tetap berlaku | AC-55 | ya |
| TC-68 | Ukuran cookie | Unit: 40 klik produk berparameter terpanjang, cookie 12 produk dan di bawah 3.800 byte | AC-56 | ya |
| TC-69 | Parameter akuisisi mengikuti klik | Unit: klik A berparameter lalu klik B tanpa parameter, calon B tanpa parameter A | AC-57 | ya |
| TC-70 | Hapus pesanan berkomisi | Komisi sudah dibayar: hapus ditolak 409 dan tidak ada yang terhapus. Komisi belum dibayar: pesanan dan komisi hilang bersama. Batal: komisi Dibatalkan | AC-58 | ya |
| TC-71 | Undangan tanpa tautan | Nama atau pesan memuat alamat web: 400 dan tidak tersimpan. Pesan berisi titik dan harga: diterima | AC-59 | ya |
| TC-72 | Tautan email undangan | Unit: isi email memakai tautan yang diberikan, judul satu baris, HTML di-escape. Rute menyusun tautan dari `PUBLIC_STORE_URL` | AC-60 | sebagian |
| TC-73 | Kirim ulang ke member | Email undangan sudah menjadi member lewat link lain: kirim ulang ditolak | AC-61 | ya |
| TC-74 | Kode terlarang | Admin mengisi `UNDANGAN`: 400, kode lama tetap | AC-62 | ya |
| TC-75 | Formulir produk | Isi komisi khusus dan syarat sudah membeli lewat layar, simpan, buka lagi: sama. 150%: ditolak. Matikan affiliasi: link langsung ditolak | AC-63 | ya |
| TC-76 | Sesi rusak dan tautan dalam | Token rusak, buka `/toko/affiliate?tab=komisi`: halaman masuk dengan `next` lengkap, setelah masuk tiba di tab Komisi | AC-64 | ya |
| TC-77 | Layar dengan nilai terpanjang | Nama 118 huruf, email panjang, qty besar. Dashboard 360 dan 393 px (7 tab), admin 393, 768, 1024, 1280 px (5 tab), halaman akun: tanpa geser, tanpa elemen keluar layar, tanpa tabel terpotong, kontrol HP 44 px, tab aktif terlihat | AC-65, NFR-7 | ya |
| TC-78 | Batas hari WIB | Pesanan pukul 00.30 WIB terhitung hari ini, 23.30 WIB kemarin tidak | D-10 | ya |
| TC-79 | Rentang tanggal pembayaran | Rentang sampai kemarin: tidak ada yang dibayar (409). Rentang hari ini: jumlah dibayar sama dengan ringkasan | FR-26 | ya |
| TC-80 | Sesi berubah di tengah jalan | Akses dicabut atau program dimatikan saat dashboard terbuka: muat ulang menampilkan pesan, menu Affiliate di akun hilang saat program mati | FR-1, FR-2 | ya |
| TC-81 | Ekspor CSV | Berkas berawalan `sep=;`, kolom dipisah titik koma, komisi angka polos | FR-25 | ya |
| TC-82 | Dialog admin | Calon upline dimuat dari semua member, bukan hasil pencarian. Tampilan kartu punya Pilih semua | FR-48, WF-11 | ya |
| TC-83 | Pelanggan berkomisi tidak terhapus | Hapus pelanggan yang punya komisi lewat jalur umum: ditolak 409, bukan 500 | FR-23 | ya |
| TC-84 | Cangkang lama setelah deploy | Service worker build lama terpasang, server berganti ke build baru, buka link affiliate, `/toko/affiliate`, dan `/affiliate`: tiba di tujuan, cookie dan satu klik. Alamat lama tidak dimuat ulang. index.html masih lama: satu kali muat ulang lalu berhenti | AC-66 | manual, `verify_affiliate_stale_shell.cjs` (butuh dua build produksi) |
| TC-85 | Gangguan saat membuka link | Klik dijawab 429, 500, atau diputus: pengunjung tiba di produk atau toko. Undangan dijawab 500: tiba di formulir daftar. Putus sekali lalu tersambung: satu klik tercatat. Kode salah: pesan Sejoli tetap tampil | AC-67, AC-14 | ya |
| TC-86 | Harga flash sale dan tarif berubah | Pesanan saat flash sale: dasar komisi harga flash. Tarif 10% menjadi 20% sebelum konfirmasi: komisi lama tetap, pesanan baru 20% | D-6, FR-21 | ya |
| TC-87 | Data induk dihapus | Pembeli dihapus setelah pesanan selesai: pesanan dan komisi tetap tampil. Produk dinonaktifkan: link ditolak, komisi lama tetap bernama. Produk yang pernah diklik dihapus: berhasil, klik tetap terhitung | FR-20, FR-23 | ya |
| TC-88 | Permintaan bersamaan | Tiga kirim undangan yang sama bersamaan: satu tersimpan. Enam pembukaan dashboard pertama bersamaan: satu kode | AC-68, AC-9 | ya |
| TC-91 | Kedalaman jaringan di admin | Rantai tiga upline: kedalaman upline 1 menampilkan satu, kedalaman 2 dua. Downline 1 lalu 2 tingkat | AC-69 | ya |
| TC-92 | Callback Tripay | Permintaan bertanda tangan kunci lokal: tanda tangan salah 403. PAID: lunas, komisi tetap Order belum selesai sampai dikonfirmasi. EXPIRED: pesanan batal, komisi Dibatalkan | D-7, AC-33 | ya |
| TC-93 | Data gagal dimuat | Satu permintaan diputus: tab dashboard affiliate dan tiap tab admin menampilkan "Data affiliate gagal dimuat. Coba lagi." dengan tombol 44 px, bukan kerangka tanpa akhir atau daftar kosong. Coba lagi memuat datanya. Rentang tanggal yang gagal tidak tampil sebagai "tidak ada data" | AL-1 | ya |
| TC-94 | Tarif per affiliate | Affiliate 15%: produk biasa 15%, produk berkomisi khusus Rp 5.000 tetap Rp 5.000, affiliate tanpa tarif 10%. Dua tier untuk satu affiliate ditolak | AC-70 | ya, `verify_affiliate_klien.cjs` |
| TC-95 | Undangan khusus admin | Undangan admin bertarif 10%: membuka tautan tanpa cookie, mendaftar menjadi Diizinkan 10% tanpa upline. Email yang sama dan email anggota ditolak 409. Mendaftar tanpa membuka tautan juga Diizinkan | AC-71, AC-72 | ya |
| TC-96 | Undangan affiliate tetap jaringan | Teman yang diundang affiliate menjadi downline, aksesnya Ikut pengaturan, dashboard menolaknya | AC-73 | ya |
| TC-97 | Kontak terkunci | Pengaturan tersimpan dengan saklar kontak menyala: order dan jaringan affiliate tanpa HP dan email | AC-74 | ya |
| TC-98 | Minimal pencairan | Minimal di atas saldo: ringkasan menandai, Bayar tanpa konfirmasi 409, dengan konfirmasi 200 | AC-75 | ya |
| TC-99 | Undangan tanpa batas | Batas 0: undangan ke-22 di hari yang sama diterima | AC-76 | ya |
| TC-100 | Retur memotong komisi | Retur 1 dari 2: komisi separuh; retur kedua: 0, baris membawa komisi awal | AC-77 | ya |
| TC-101 | Potongan dari pembayaran berikutnya | Retur sesudah dibayar: potongan separuh; pembayaran berikutnya mentransfer selisihnya, pengeluaran sama, potongan terpakai | AC-78 | ya |
| TC-102 | Batal sesudah dibayar | Potongan batal sebesar komisi; selesai lagi: potongan hilang | AC-79 | ya |
| TC-103 | Potongan menutup komisi | Komisi lebih kecil atau sama dengan potongan: Bayar 409, tidak ada yang berubah | AC-80 | ya |
| TC-104 | Bonus target | Omset bulan ini lewat target: bonus berjalan dan kartu target; retur menurunkan omset: bonus hilang. Bonus bulan lalu: Belum dibayar, ikut dibayar, tidak berubah sesudahnya | AC-81, AC-82 | ya |
| TC-105 | Omset bersih retur | Omset ringkasan affiliate dan admin sama dengan pesanan Selesai dikurangi retur menurut SQL | AC-83 | ya |
| TC-106 | Batal bayar melepas bonus dan potongan | Seluruh pembayaran dibatalkan: bonus Belum dibayar lagi, potongan menunggu lagi | AC-84 | ya |
| TC-107 | Pemicu retur dan batal di basis data | Transaksi yang dibatalkan: retur 1/2 dan 2/2, potongan retur, potongan batal, selesai lagi, retur dihapus | AC-77, AC-78, AC-79 | manual, SQL |
| TC-89 | Server berzona UTC | Semua suite affiliate dijalankan terhadap API lokal dengan proses dan sesi basis data UTC: hasil sama dengan zona WIB | D-10, TC-78 | manual |
| TC-90 | Migrasi dijalankan dua kali | `047_affiliate.sql` dijalankan dua kali berturut-turut di dalam satu transaksi yang dibatalkan: tanpa galat, jumlah objek tidak berubah | Spesifikasi 0001, langkah migrasi | manual |

### Kualitas

| TC | Judul | Langkah dan hasil yang diharapkan | AC/NFR | Otomatis |
|---|---|---|---|---|
| TC-60 | Kinerja dashboard | 10.000 pesanan, 50.000 klik sintetis: p95 `GET /api/customer/affiliate` dan `overview` paling lama 500 ms | NFR-2 | ya |
| TC-61 | Kecepatan link | Buka link di profil HP 4G: LCP paling lama 2,5 detik | NFR-1 | ya |
| TC-62 | Tata letak | 393 dan 1440 px: lebar dokumen sama dengan layar, target sentuh minimal 44 px | NFR-7 | ya |
| TC-63 | Kontras dan label | Kontras minimal 4,5:1 di dalam layar affiliate (terang dan gelap), semua kolom berlabel, fokus keyboard terlihat. Suite `verify_dark_contrast` menjaga lantai 3:1 untuk seluruh layar di mode gelap | NFR-8 | sebagian |
| TC-64 | Log audit | Ubah akses, kode, upline, bayar: baris audit ada | NFR-10 | ya |
| TC-65 | Pembatas laju | 61 permintaan klik dalam semenit dari satu IP: 429 | NFR-6 | ya |

## 7. Keterlacakan

| AC | TC |
|---|---|
| AC-1 | TC-1 |
| AC-2 | TC-2 |
| AC-3, AC-5 | TC-3 |
| AC-4 | TC-4 |
| AC-6 | TC-30 |
| AC-7 | TC-31 |
| AC-8 | TC-32 |
| AC-9 | TC-10 |
| AC-10 | TC-11 |
| AC-11 | TC-12 |
| AC-12 | TC-13 |
| AC-13 | TC-14 |
| AC-14, AC-15 | TC-15 |
| AC-16 | TC-33 |
| AC-17 | TC-16 |
| AC-18 | TC-17 |
| AC-19 | TC-18 |
| AC-20 | TC-19 |
| AC-21 | TC-34 |
| AC-22 | TC-35 |
| AC-23 | TC-36 |
| AC-24 | TC-37 |
| AC-25 | TC-38 |
| AC-26 sampai AC-29 | TC-39, TC-19 |
| AC-30, AC-31 | TC-40 |
| AC-32 | TC-20 |
| AC-33 | TC-41 |
| AC-34 | TC-5 |
| AC-35 | TC-42 |
| AC-36 | TC-21 |
| AC-37 | TC-43 |
| AC-38 | TC-44 |
| AC-39 | TC-23 |
| AC-40 | TC-6 |
| AC-41 | TC-45 |
| AC-42 | TC-24 |
| AC-43, AC-44 | TC-46 |
| AC-45 | TC-25 |
| AC-46 | TC-47 |
| AC-47 | TC-22 |
| AC-48 | TC-26 |
| AC-49 | TC-6 |
| AC-50 | TC-27 |
| AC-51 | TC-48 |
| AC-52 | TC-49 |
| AC-53, AC-54 | TC-66 |
| AC-55 | TC-67 |
| AC-56 | TC-68 |
| AC-57 | TC-69 |
| AC-58 | TC-70 |
| AC-59 | TC-71 |
| AC-60 | TC-72 |
| AC-61 | TC-73 |
| AC-62 | TC-74 |
| AC-63 | TC-75 |
| AC-64 | TC-76 |
| AC-65 | TC-77 |
| AC-66 | TC-84 |
| AC-67 | TC-85 |
| AC-68 | TC-88 |
| AC-69 | TC-91 |
| AC-70 | TC-94 |
| AC-71 | TC-95 |
| AC-72 | TC-95 |
| AC-73 | TC-96 |
| AC-74 | TC-97 |
| AC-75 | TC-98 |
| AC-76 | TC-99 |
| AC-77 | TC-100, TC-107 |
| AC-78 | TC-101, TC-107 |
| AC-79 | TC-102, TC-107 |
| AC-80 | TC-103 |
| AC-81 | TC-104 |
| AC-82 | TC-104 |
| AC-83 | TC-105 |
| AC-84 | TC-106 |

## 8. Cacat

Semua ditemukan dan diperbaiki di lokal pada 11 Okt 2026, sebelum tayang. "Audit sambungan" berarti ditemukan saat memeriksa titik temu fitur affiliate dengan fitur lain.

| DF | Ditemukan oleh | Akar masalah | Perbaikan | TC regresi | Status |
|---|---|---|---|---|---|
| DF-1 | Unit test ukuran cookie | Cookie berisi 30 produk berparameter panjang mencapai 9.251 byte. Browser membuang cookie di atas 4.096 byte tanpa pesan, sehingga atribusi hilang | Maksimal 12 produk, kode platform 20 dan ID 40 karakter (D-21). Terukur di bawah 3.800 byte | TC-68 | Selesai |
| DF-2 | Audit sambungan | Parameter akuisisi calon per produk jatuh ke parameter klik umum milik affiliate lain. Klik produk setelah membuka undangan tercatat bersumber "undangan" | Parameter disimpan per kunci dan dihapus oleh klik tanpa parameter (D-22). Calon per produk selalu bersumber "link" | TC-69 | Selesai |
| DF-3 | TC-42 | Membatalkan seluruh komisi dalam satu pembayaran gagal 500: pembayaran diperbarui menjadi Rp 0, padahal kolomnya wajib lebih dari 0 | Pembayaran yang habis dihapus beserta pengeluarannya | TC-42 | Selesai |
| DF-4 | Audit sambungan | Umur cookie hanya dijaga browser. Nilai cookie lama yang disalin tetap berlaku di server | Server menolak cookie yang klik terakhirnya lebih tua dari Umur cookie (D-20) | TC-67 | Selesai |
| DF-5 | Audit sambungan | Link untuk satu varian tidak berlaku untuk varian lain produk yang sama, dan syarat "sudah membeli" hanya menghitung varian yang sama persis | Aturan per produk memakai kelompok varian (SKU Induk, D-19) | TC-66 | Selesai |
| DF-6 | Audit sambungan | Hapus pesanan massal ikut menghapus komisi yang sudah dibayar, sehingga riwayat pembayaran tidak cocok lagi dengan komisinya | Penghapusan ditolak dengan pesan berisi nomor pesanan (D-23) | TC-70 | Selesai |
| DF-7 | Audit sambungan | Undangan ke email yang kemudian menjadi member lewat jalan lain masih bisa dikirim ulang | Kirim ulang memeriksa keanggotaan lebih dulu | TC-73 | Selesai |
| DF-8 | Audit sambungan | Kode affiliate `UNDANGAN` bertabrakan dengan alamat undangan `/aff/undangan/{token}` | Kode itu ditolak (D-26) | TC-74 | Selesai |
| DF-9 | Audit sambungan | Ekspor CSV komisi memakai koma, sementara ekspor lain memakai `sep=;` dan titik koma, sehingga Excel Indonesia membukanya dalam satu kolom | Memakai format CSV bersama aplikasi | TC-81 | Selesai |
| DF-10 | Tinjauan keamanan | Tautan di email undangan disusun dari header Origin atau Host permintaan, yang bisa diisi pengirim dengan domain lain | Tautan dari `PUBLIC_STORE_URL` (D-24) | TC-72 | Selesai |
| DF-11 | Tinjauan keamanan | Nama dan pesan undangan bisa memuat tautan, sehingga email resmi toko bisa dipakai menitipkan tautan ke alamat mana pun | Ditolak bila memuat alamat web (D-25) | TC-71 | Selesai |
| DF-12 | Tinjauan keamanan | Judul email memuat nama pengguna apa adanya, termasuk baris baru | Judul dijadikan satu baris | Unit `affiliatePekerja.test.js` | Selesai |
| DF-13 | Tinjauan kode | Ringkasan admin menampilkan "Member" untuk penerima komisi tier atas yang belum pernah membuka dashboard (belum punya kode) | Nama diambil per id penerima | TC-27 | Selesai |
| DF-14 | Pengukuran tata letak | Tabel admin (760 sampai 900 px) lebih lebar dari wadah isi admin di 768 px (726 px) dan 1.024 px (718 px), kolom Aksi keluar layar | Kartu di bawah 1.280 px (WF-10) | TC-77 | Selesai |
| DF-15 | Tinjauan layar | Tampilan kartu Komisi admin tidak punya "Pilih semua" untuk aksi massal | Kotak Pilih semua di baris aksi (WF-11) | TC-82 | Selesai |
| DF-16 | Tinjauan kode | Pilihan upline di dialog ubah member hanya berisi hasil pencarian yang sedang tampil di tab | Calon upline dimuat dari semua member | TC-82 | Selesai |
| DF-17 | Uji nilai terpanjang | Halaman akun bergeser ke samping (913 px di layar 393 px) untuk nama 118 huruf | `min-w-0` di wadah HP | TC-77 | Selesai |
| DF-18 | Tinjauan layar | Membuka langsung tab Undang atau Rekening di HP: tab aktif berada di luar bilah menu | Tab aktif digeser ke tengah (WF-12) | TC-77 | Selesai |
| DF-19 | Tinjauan layar | Label periode "Sepanjang waktu" terlipat dua baris di HP | Label "Semua" (WF-13) | TC-77 | Selesai |
| DF-20 | TC-77 | Saklar di tab Pengaturan admin hanya 23 sampai 32 px di HP | Baris saklar 44 px di HP | TC-77 | Selesai |
| DF-21 | TC-63 | Kontras di bawah 4,5:1: "s.d." 3,26:1, keterangan ubin ungu 4,27:1, label sumbu grafik 3,49:1, peringatan amber di mode gelap 3,52:1 | Warna dinaikkan, varian mode gelap ditambahkan | TC-63 | Selesai |
| DF-22 | Audit sambungan | Sesi kedaluwarsa saat membuka tautan email ke tab tertentu: setelah masuk, pengguna tiba di Ringkasan, bukan tab yang dituju | Alamat lengkap dibawa ke halaman masuk | TC-76 | Selesai |
| DF-23 | QC sub agen (baca kode) | Kebutuhan tertinggal: rentang tanggal di Order (FR-40) dan Komisi (FR-24), grafik Sales (FR-38) | Ditambahkan | TC-22, TC-77 | Selesai |
| DF-24 | QC sub agen (baca kode) | "Komisi" di ringkasan admin berarti potensial + belum + sudah dibayar, sedangkan di dashboard affiliate belum + sudah dibayar (D-10) | Disamakan dengan D-10 | TC-27 | Selesai |
| DF-25 | QC sub agen (baca kode) | "Affiliate aktif X dari Y": X bisa melebihi Y bila affiliate aktif lalu diblokir | X dihitung di antara yang berhak | TC-27 | Selesai |
| DF-26 | TC-14 | Di mode pengembangan satu kunjungan link tercatat dua klik (efek React dijalankan dua kali) | Satu permintaan per alamat dipakai bersama | TC-14 | Selesai |
| DF-27 | TC-25 | Tautan daftar dari undangan memakai `?daftar=1`, padahal halaman masuk memakai `?tab=daftar`, sehingga email tidak terisi | Disamakan `?tab=daftar&email=` | TC-25 | Selesai |
| DF-29 | Regresi penuh (`run_all_checks`) | Suite affiliate meninggalkan sekitar 170 pesanan per putaran (102 menunggu konfirmasi, Rp 1,53 miliar) dan akun bernama 117 huruf. Akibatnya `verify_pnl_math` merah (pembandingnya menghitung pesanan menunggu, aplikasi tidak, dan total pesanan melewati batas tarik 500) dan `verify_mobile_tables` merah (tabel Pesanan, Pelanggan, User melebar). Kode affiliate tidak terlibat: pada data bersih kedua suite lolos 7/7 dan 216/216 | Suite menghapus data uji putarannya. Sisa data uji hari ini (148 akun, 172 pesanan) dihapus sekali, stok kembali ke angka awal | Regresi penuh | Selesai |
| DF-30 | Regresi penuh | Suite undangan menghabiskan batas 10 undangan per menit milik satu akun dengan cek tautan, sehingga undangan berikutnya ditolak 429 dan cek kedaluwarsa gagal. Cacat uji, bukan cacat produk: pembatasnya bekerja sesuai rancangan | Cek tautan memakai akun affiliate kedua | TC-46, TC-71 | Selesai |
| DF-31 | Regresi penuh kedua | Pembantu uji `produkUji` memilih dua produk bernama sama tanpa SKU Induk sebagai "produk lain". Toko menganggap keduanya varian satu produk, sehingga cek AC-24 tercatat atas affiliate. Cacat uji: aturan D-19 bekerja | Pembantu memilih satu produk per kelompok varian | TC-37 | Selesai |
| DF-32 | Regresi penuh kedua | Cek sumbu grafik membaca `innerText` dari teks SVG, yang tidak ada di SVG | Memakai `textContent` | TC-77 | Selesai |
| DF-33 | Regresi penuh kedua | `verify_marketplace_import` sesekali berhenti karena halaman browser uji crash ("Page crashed") di tengah suite. Bukan dari fitur affiliate: alur impor yang sama diulang tiga kali dengan memori halaman 40 sampai 75 MB tanpa crash, dan suite lolos 24/24 baik pada kode sebelum fitur affiliate (worktree commit `a6aef9b`, Vite 5174) maupun kode sekarang, masing-masing 88 detik | Tidak ada perubahan produk. Catatan: suite itu tidak memasang batas waktu klik, jadi saat crash ia menggantung sampai dihentikan runner | Regresi penuh | Diamati, bukan cacat fitur |
| DF-34 | Audit sambungan putaran 2 (deploy x service worker) | Pengunjung yang pernah membuka toko sebelum rilis memuat aplikasi versi lama dari cache service worker pada kunjungan pertama setelah deploy. Aplikasi lama tidak mengenal `/aff/...` dan melemparnya ke `/toko`: 0 klik, tanpa cookie, pengunjung tidak tiba di produk. `/toko/affiliate` dan `/affiliate` bernasib sama. Kunjungan kedua baru benar | Penyelamat cangkang lama di `public/kasir-config.js` dan penanda `data-cangkang` di index.html (D-28) | TC-84 | Selesai |
| DF-35 | Audit sambungan putaran 2 | Server menjawab 429, 500, atau jaringan putus saat link dibuka: pengunjung berhenti di layar "Kesalahan pada link affiliasi" dan tidak pernah tiba di produk | Pengunjung tetap diantar ke tujuan, satu percobaan ulang untuk jaringan dan galat server (D-29) | TC-85 | Selesai |
| DF-36 | Audit sambungan putaran 2 | Tiga permintaan kirim undangan yang sama bersamaan menghasilkan 2 undangan (dan 2 email) karena cek ganda tidak dikunci | Kunci per affiliate di dalam transaksi untuk kirim dan kirim ulang (D-30) | TC-88 | Selesai |
| DF-39 | Tinjauan kode putaran 2 | Pengaturan "Kedalaman jaringan (upline)" tersimpan dan tampil di layar admin tetapi tidak dipakai di mana pun. Tampilan jaringan member di admin memakai batas tetap 10 tingkat. Di Sejoli tampilan itu dibatasi kedua pengaturan kedalaman (`json/affiliate-network.php`) | Tampilan jaringan member di admin memakai kedalaman upline dan downline dari pengaturan, dan bagian Jaringan di Pengaturan menjelaskan di mana tiap angka berlaku | TC-91 | Selesai |
| DF-37 | Pemeriksaan ulang TC-61 | Angka LCP di DF-28 semula diukur pada build mode pengembangan: `.env` lokal berisi `NODE_ENV=development`, sehingga `npm run build` menghasilkan bundel 2,9 MB berisi React development. Angka 2,9 MB dan 630 KB gzip tidak mewakili produksi | Diukur ulang pada build `NODE_ENV=production`, dibandingkan dengan build commit yang sedang tayang. Petunjuk di `perf_affiliate_lcp.cjs` diperbaiki | TC-61 | Selesai, DF-28 dikoreksi |
| DF-38 | Regresi putaran 2 | Suite kontras gelap ikut meninggalkan dua akun affiliate, satu pesanan, dan satu komisi tiap putaran | Suite itu kini menghapus data ujinya | Regresi penuh | Selesai |
| DF-40 | QC sub-agent, dashboard affiliate | Satu permintaan data yang gagal tampil sebagai kerangka memuat tanpa akhir (dashboard) atau daftar kosong "Tidak ada data" (admin). Rentang tanggal yang gagal tampil sebagai "Tidak ada order di rentang tanggal ini." Pesan AL-1 tidak pernah muncul | Keadaan gagal dengan pesan AL-1 dan tombol Coba lagi di tiap bagian | TC-93 | Selesai |
| DF-41 | QC sub-agent C1 | Tab Order: pesanan Dibatalkan menampilkan "Komisi kamu" bernilai penuh dengan gaya yang sama dengan pesanan selesai, berbeda dengan tab Komisi | Label "Komisi dibatalkan" dengan nilai dicoret | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-42 | QC sub-agent C2 | Desktop 1440: pindah tab setelah menggulir membuat judul dan pilihan periode tersembunyi di bawah kepala toko yang menempel (36 dari 36 px tertutup) | Pindah tab menggulir ke atas | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-43 | QC sub-agent C3 | HP: tombol yang difokus keyboard berhenti di bawah kepala toko (24 dari 44 px tertutup) | scroll-margin setinggi kepala toko dan menu tab di dalam layar affiliate | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-44 | QC sub-agent C4 | HP: tombol "Pesan" milik cangkang toko menutupi chip saringan dan bar grafik hari ini | Ruang bawah 64 px supaya isi terakhir bisa digulir keluar dari bawah tombol. Tombol itu tetap menutupi pada tampilan pertama di semua halaman toko (L-7) | QC ulang | Sebagian |
| DF-45 | QC sub-agent C5 | HP: nilai akuisisi disingkat ("2,3 jt") tanpa Rp, berbeda dengan desktop dan ubin | Nilai lengkap dengan Rp, kolom Nilai selebar isinya | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-46 | QC sub-agent C6 | Nama panjang terpotong di kartu profil dan pohon jaringan tanpa cara membacanya di HP | Kartu profil dua baris dengan title, nama di Jaringan terlipat penuh | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-47 | QC sub-agent C7 | Kalimat bantuan parameter janggal, dan "Tautan undangan berlaku 7 hari" terbaca sebagai bantuan kolom Nama | Kalimat ditulis ulang, masa berlaku dipindah ke dekat tombol kirim. "Jaringan Anda" dibiarkan karena judul menu Sejoli | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-48 | QC sub-agent C8 | Keadaan kosong Order dan Komisi tanpa langkah berikut | Tombol "Buat link" | QC ulang, `verify_affiliate_seams2` | Selesai, dikonfirmasi QC ulang |
| DF-49 | QC sub-agent C9 | Admin Pengaturan: mengosongkan Umur cookie lalu simpan menampilkan sukses dan tersimpan 0, yang berarti selamanya. Server juga menerima `''` dan `null` sebagai 0, begitu pula besar komisi yang dikosongkan (menjadi 0%) | Server menolak isian angka kosong (`angkaIsian` di `inti.js`, uji unit). Isian di layar tetap kosong dan ditolak dengan pesan PRD | Uji unit, `verify_affiliate_seams2` | Selesai |
| DF-50 | QC sub-agent C10 | Komponen dialog bersama tidak punya `role="dialog"`, dan tombol tutupnya 29 px tanpa nama untuk pembaca layar. Dipakai 25 layar admin, di luar fitur affiliate | `role="dialog"`, `aria-modal`, judul sebagai label, tombol Tutup 44 px | `verify_affiliate_seams2` | Selesai, perbaikan kecil di luar butir 18 |
| DF-51 | QC sub-agent C11 | Admin tab Affiliate di HP menampilkan 96 member sekaligus, halaman setinggi 13.111 px | Daftar dibuka 30 per tahap dengan tombol Tampilkan lagi | `verify_affiliate_seams2` | Selesai |
| DF-52 | QC sub-agent | Dashboard affiliate: galat server pada data induk menampilkan pesan mentah dari server | Jaringan putus dan galat 5xx memakai pesan AL-1, penolakan yang disengaja tetap memakai pesan server | `verify_affiliate_seams2` | Selesai |
| DF-53 | Pemeriksaan sebelum deploy VPS | VPS menjalankan rilis `20261008-integrations` yang tidak ada di git (integrasi API per toko, OneSender, Meta WhatsApp, migrasi 044 sampai 046). Deploy commit affiliate apa adanya akan menghapus fitur itu dari produksi, dan nomor migrasi affiliate 044 bertabrakan | Kode rilis VPS disalin (18 berkas, MD5 cocok), digabung tiga arah sebagai commit `e3e9999`, migrasi affiliate dinomori ulang 047. Uji callback Tripay disesuaikan dengan aturan baru (reference wajib, header X-Callback-Event) | Regresi penuh, `verify_affiliate_seams2` | Selesai |
| DF-54 | QC sub-agent QC3 D1 | "Sudah dibayar" (dashboard affiliate dan admin) menjumlahkan komisi berstatus dibayar, termasuk bagian yang kemudian dipotong dari pembayaran berikutnya: Rp 716.250 padahal yang ditransfer Rp 573.000 | Sudah dibayar = komisi dibayar dikurangi potongan yang terpakai, ditambah bonus dibayar (dashboard: jumlah pembayaran). Komisi di ringkasan affiliate juga dikurangi potongan retur | `verify_affiliate_klien` | Selesai |
| DF-55 | QC3 D2 | Pilihan Jenis bonus di HP 393 memotong teks ("Persen dari om") | Selebar kolom di HP | Mata sendiri: lebar 333 dari isi 333 px | Selesai |
| DF-56 | QC3 D3 | Daftar undangan admin di HP berada di bawah 30 kartu member | Dipindah ke atas daftar member | Mata sendiri: y 472 vs daftar member 598 | Selesai |
| DF-57 | QC3 D4 | Email undangan panjang dipatah di tengah domain | Dipatah sebelum @; bagian nama yang lebih panjang dari satu baris tetap dipatah | Mata sendiri | Selesai |
| DF-58 | QC3 D5 | Dua baris bonus bernilai sama di Pembayaran tanpa penjelasan | "bonus siap dibayar" dan "bonus bulan ini, dibayar setelah bulan berakhir" | Mata sendiri | Selesai |
| DF-59 | Tinjauan kode | Email komisi dibayar hanya menyebut jumlah transfer; dengan bonus atau potongan angkanya tidak sama dengan jumlah komisi | Baris Rincian: komisi + bonus - potongan | Uji unit `affiliatePekerja.test.js` | Selesai |
| DF-60 | Regresi 13 Okt 2026 | `verify_mobile_tables` merah di Shift Kasir: halaman menampilkan 30 hari terakhir secara bawaan, sedangkan shift terbaru di basis data uji bertanggal 13 Sep 2026, jadi sejak 13 Okt tabelnya kosong. Cacat uji, bukan cacat produk: halaman Shift tidak berubah sejak 27 Sep | Suite melebarkan rentang tanggal Shift sebelum mengukur | Regresi penuh | Selesai |
| DF-28 | TC-61 | LCP halaman produk toko 2.764 sampai 2.840 ms (median 7 putaran, build produksi, gzip setingkat nginx VPS) di profil HP menengah, di atas NFR-1 2.500 ms. Build commit yang sedang tayang mengukur 2.796 ms pada kondisi yang sama, jadi sudah begitu sebelum fitur affiliate. Lewat link affiliate 2.764 ms, langsung 2.840 ms: lompatan `/aff` tidak menambah waktu. Fitur affiliate menambah berkas JS dari 1.788.005 menjadi 1.890.036 byte (+5,7%). Urutan yang memakan waktu: unduh JS selesai di 985 ms, JS selesai dijalankan di 1.880 ms, data produk tiba di 2.030 ms, gambar produk baru diminta di 2.380 ms (sekitar 330 ms merender halaman pada CPU yang diperlambat 4 kali), gambar selesai di 2.640 ms | Belum, dan belum ada tuas yang diuji. Calon tuas: pemecahan berkas JS toko dan admin supaya JS lebih cepat dijalankan, dan meminta gambar utama begitu data produk tiba. Di luar cakupan butir 18 | TC-61 | Terbuka, sudah ada sebelum fitur affiliate |

### Temuan di luar fitur affiliate (tidak diperbaiki di butir 18)

| Kode | Temuan | Bukti | Dampak |
|---|---|---|---|
| L-1 | Aplikasi admin hanya menarik 500 pesanan terbaru (F1 dari uji VPS 6 Okt 2026) | Lokal dengan 618 pesanan: Laba Rugi "semua waktu" Rp 393.837.900 di layar vs Rp 479.809.700 dari pesanan selesai di basis data | Toko produksi punya 618 pesanan, jadi Riwayat dan Laporan untuk rentang panjang kurang |
| L-2 | Tabel Pesanan, Pelanggan, dan User tidak memotong nama atau email yang sangat panjang | Nama 117 huruf dan email 81 karakter: tabel Pelanggan 546 px di wadah 328 px (HP), tabel User 1.040 px di wadah 937 px (1.280 px) | Jarang terjadi pada data nyata |
| L-3 | Ikon kepala toko di HP 35 px (cari, akun, keranjang), di bawah 44 px | Diukur agen QC di 393 px | Lebih sulit disentuh |
| L-4 | Pembanding SQL `verify_pnl_math` menghitung pesanan menunggu konfirmasi sebagai pendapatan, aplikasi tidak (`isSaleStatus`) | DF-29 | Suite merah palsu setiap kali ada pesanan web yang belum dikonfirmasi |
| L-5 | Satu berkas JS 1,89 MB (1,80 MB di versi yang tayang, 577 KB terkirim dengan gzip nginx) untuk seluruh aplikasi: 0,9 detik menjalankannya di HP menengah sebelum permintaan data pertama | DF-28 | LCP halaman produk 2,8 detik di HP menengah, baik di versi yang tayang maupun versi baru |
| L-6 | Emulasi tidak menghitung waktu sambung ke host gambar (`gnnkracing.id`), jadi manfaat `preconnect` tidak bisa dibuktikan di sini | Dengan dan tanpa preconnect: 2.884 vs 2.832 ms, selisih di dalam simpangan | Perlu diukur di HP sungguhan sebelum diputuskan |
| L-7 | Tombol "Pesan" yang mengambang menutupi isi di atasnya pada tampilan pertama di semua halaman toko di HP | DF-44 | Kontrol di bawahnya harus digulir dulu baru bisa disentuh |
| L-8 | Ringkasan affiliate menulis konversi di atas 100% ("300% dari klik") bila satu klik menghasilkan beberapa pesanan | QC3 | Angkanya benar, hanya terlihat aneh |

## 9. Ringkasan hasil

Dijalankan 11 dan 12 Oktober 2026 di lingkungan lokal: Windows 11, PostgreSQL 16 lokal, API Express di port 3000, Vite di port 5173, Chromium dari Playwright. Belum dijalankan di VPS.

| Pemeriksaan | Hasil |
|---|---|
| Regresi penuh `run_all_checks`, putaran 1 | 46 suite lolos. Dua suite (`verify_marketplace_import`, `verify_purchase_cost_expense`) tidak mengeluarkan ringkasan di dalam putaran penuh, lalu lolos 24/24 dan 10/10 saat dijalankan sendiri (DF-33). Putaran ini sempat terputus karena sesi berakhir, sisanya dijalankan ulang tanpa perubahan kode |
| Regresi penuh `run_all_checks`, putaran 2 | 1.337 dari 1.337 pemeriksaan, 46 suite, tanpa suite yang gagal atau tanpa ringkasan |
| Suite affiliate di server berzona UTC (TC-89) | 85/85, 16/16, 54/54, 35/35, 24/24, 54/54, 15/15 |
| Cangkang lama setelah deploy (TC-84) | 10/10 dengan build commit `a6aef9b` sebagai build lama dan build produksi kode sekarang |
| Uji unit `vitest` | 164/164 |
| Pemeriksa tipe `tsc -b` | 0 galat |
| Kinerja API (NFR-2) | 14 endpoint dengan 10.000 pesanan dan 50.001 klik: p95 paling lama 174 ms, batas 500 ms |
| LCP link affiliate (NFR-1, TC-61) | Tidak terpenuhi, sudah begitu sebelum fitur affiliate: 2.764 ms lewat link, 2.840 ms langsung, 2.796 ms di build yang tayang (DF-28) |
| Kontras (NFR-8) | 111/111 pemeriksaan mode gelap, termasuk 5 layar admin affiliate dan 7 tab dashboard |
| QC sub-agent, HP 393x852 dan desktop 1440x900 | 144 angka dashboard dan 39 angka ringkasan admin sama dengan SQL. 42 layar tanpa geser mendatar, 0 target sentuh di bawah 44 px di dalam fitur. 22 pembukaan link, satu perjalanan utuh di HP (buka link sampai \"Sudah dibayar\"), mode gelap 3 layar. 11 temuan, 10 diperbaiki, 1 sebagian (DF-44) |

Belum diperiksa: HP sungguhan, pengiriman email sungguhan lewat Mailketing, daftar lewat Google pada akun baru, callback Tripay sungguhan (yang diuji permintaan bertanda tangan kunci lokal), lebih dari satu toko, dan apa pun di VPS.
