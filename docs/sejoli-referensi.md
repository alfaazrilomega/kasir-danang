# Referensi Sejoli: perilaku yang disalin

Produk: Program Affiliate GNNK Racing · 11 Okt 2026 · Status: draft · Terkait: [01 BRD](01-brd.md), [02 PRD](02-prd.md)

## Sumber

- Plugin Sejoli versi **1.14.7** (lisensi GNU GPL v2), salinan publik di GitHub `obitouchiha3455-del/sejoli-plugin`, dibaca langsung pada 11 Okt 2026.
- Pembanding: Sejoli 1.13.14 (`drmn29/sejoli`) dan 1.5.4 (`zanura7/sejoli`), serta daftar add-on resmi pengembangnya (`orangerdev/*`).
- Dokumentasi resmi: docs.sejoli.co.id (Mitra Affiliasi, Pengaturan Alat Bantu Affiliate).
- Akun Sejoli klien tidak diperlukan: semua perilaku di bawah dibaca dari kodenya, bukan ditebak dari tampilan.

Kolom "Kita" memakai tiga nilai: **Sama** (perilaku disalin), **Lebih** (perilaku Sejoli disalin lalu ditambah), **Beda** (sengaja berbeda, alasannya di keputusan PRD).

## Pemetaan per bagian yang diminta leader

### 1. Link dan kode affiliate

| Perilaku Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Link berbentuk `/aff/{id affiliate}/{id produk}/{target}`, target `checkout` atau landing page lain | `public/affiliate.php` (set_endpoint, set_affiliate_link) | **Lebih:** `/aff/{KODE}/{id produk}`, ditambah link seluruh toko `/aff/{KODE}` karena toko fisik punya 305 produk. ID angka diganti kode pendek karena ID kita berupa UUID (D-3) |
| Link ke produk yang affiliasinya dimatikan ditolak: "Produk ini sudah tidak diaffiliasikan lagi" | `public/affiliate.php` (check_parse_query) | **Sama** |
| Affiliate tidak dikenal: "Affiliasi tidak terdaftar di database" | sama | **Sama** |
| Affiliate tidak berhak atas produk: "Link affiliasi ini tidak diperkenankan. Silahkan hubungi pemilik link affiliasi ini" | sama | **Sama** |
| Pembuat link: pilih produk, Generate, salin. Parameter akuisisi (Platform dan ID) dan parameter kupon | `template/affiliasi-link.php` | **Sama** untuk produk dan parameter akuisisi. Parameter kupon tidak, karena kupon di luar cakupan |
| Daftar platform bawaan: Facebook, Instagram, Instagram Story, WhatsApp, Email, Line, bisa diubah admin | `admin/acquisition.php` | **Lebih:** ditambah TikTok |

### 2. Cookie dan atribusi pesanan

| Perilaku Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Klik link menyimpan cookie berisi affiliate umum (`general`) dan affiliate per produk | `public/affiliate.php` (set_cookie) | **Sama**, ditambah tanda tangan digital supaya cookie tidak bisa dipalsukan (Sejoli menyimpannya polos) |
| Umur cookie diatur dalam hari (`sejoli_cookie_age`). Teks bantuan: "Isi dengan 0 jika umur cookie selamanya", tetapi kodenya memakai 30 hari bila diisi 0 | `admin/admin.php`, `public/affiliate.php` | **Beda:** 0 berarti selamanya sesuai teks bantuan, disimpan 10 tahun (D-4) |
| General Cookie: pembeli terdaftar ke affiliate untuk semua produk, bukan hanya produk yang diklik | `admin/admin.php` (`sejoli_cookie_is_general`) | **Sama** |
| Kaitkan affiliasi: pembeli yang sudah pernah tercatat milik affiliate selalu dicatat ke affiliate itu, link lain diabaikan | `admin/admin.php` (`sejoli_permanent_affiliate`), `admin/order.php` (set_affiliate) | **Sama** |
| Urutan atribusi saat checkout: kaitan permanen, lalu kupon, lalu link | `admin/order.php`, `functions/affiliate.php` | **Sama** tanpa kupon |
| Membeli lewat link sendiri tidak dihitung | `admin/order.php` | **Sama** |
| Opsi produk "Aktifkan fitur affiliasi jika user telah membeli produk ini" | `admin/affiliate.php`, `functions/affiliate.php` | **Sama** |

### 3. Komisi

| Perilaku Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Komisi diatur per produk, per tier: Tipe (Nilai Tetap atau Persentase) dan Besar Komisi | `admin/affiliate.php` (setup_commission_fields) | **Lebih:** ditambah komisi bawaan toko yang dipakai produk tanpa pengaturan sendiri (D-5) |
| Persentase dihitung dari grand total dikurangi ongkir dan PPN, nilai tetap dikali jumlah barang | `admin/affiliate.php` (get_order_commission), `admin/shipment.php`, `admin/ppn.php` | **Sama**, dihitung per barang karena satu pesanan kita bisa berisi banyak produk (D-6) |
| Komisi dibuat saat pesanan baru, untuk tier 1 sampai jumlah tier produk, mengikuti rantai upline, berhenti bila ada orang yang berulang | `admin/affiliate.php` (set_commission, get_uplines) | **Sama** |
| Status komisi: `pending` (Order belum selesai), `added` (Belum dibayar), `cancelled` (Dibatalkan), ditambah tanda dibayar (Sudah dibayar) | `models/affiliate.php`, `admin/affiliate.php` | **Sama** |
| Pesanan selesai mengubah komisi ke Belum dibayar, pesanan batal atau refund ke Dibatalkan, pesanan diproses kembali ke Order belum selesai | `includes/class-sejoli.php` baris 398-404 | **Sama**, dipetakan ke status pesanan kita (D-7) |
| Komisi 0 tidak dicatat | `models/affiliate.php` (validate) | **Sama** |

### 4. Pembayaran komisi

| Perilaku Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Halaman "Data Komisi per Affiliasi": Komisi potensial, Komisi belum dibayar, Komisi sudah dibayar, filter tanggal, Export CSV | `admin/partials/commission/affiliate-page.php` | **Sama** |
| Tombol "Pembayaran Komisi" menampilkan rekening, total, bukti transfer, lalu menandai semua komisi Belum dibayar menjadi Sudah dibayar | `confirm-affiliate-commission-modal-content.php`, `models/affiliate.php` | **Lebih:** riwayat pembayaran disimpan, dan bisa dicatat sebagai pengeluaran di Laba Rugi (D-8) |
| Aksi massal di "Data Komisi": konfirmasi pembayaran, ubah status ke Belum Dibayar | `admin/partials/commission/page.php` | **Sama** |
| Affiliate mengisi "Informasi Rekening" untuk pencairan | `admin/affiliate.php` (add_affiliate_data_fields) | **Sama** |

### 5. Referral dan jaringan

| Perilaku Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Akun baru yang dibuat saat ada data affiliate (link atau kupon) mendapat upline `_affiliate_id` | `admin/user.php` | **Sama**, berlaku saat daftar akun dan masuk pertama kali dengan Google |
| Admin dapat mengubah upline member | `admin/partials/user/user-affiliate.php` | **Sama** |
| Menu "Jaringan Anda" menampilkan pohon downline sampai kedalaman yang diatur, detail kontak hanya bila pengaturan dinyalakan | `template/affiliasi-network.php`, `json/affiliate-network.php` | **Sama**, kontak disembunyikan secara bawaan (D-9) |

### 6. Analytics

| Perilaku Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Dashboard member: Data Hari Ini, Bulan Ini, Sepanjang Waktu, masing-masing Total Lead, Total Sales, Total Omset, Total Komisi | `template/dashboard/statistic-*.php`, `json/statistic.php` | **Sama**, definisi angka di D-10 |
| Grafik bulanan dan tahunan (jumlah dan omset) | `template/dashboard/chart-*.php` | **Sama** |
| Data Akuisisi: Sumber Traffic, ID, View, Lead, Sale, Nilai | `template/dashboard/acquisition.php`, `functions/acquisition.php` | **Lebih:** klik tanpa parameter juga dihitung sebagai sumber "Langsung" (Sejoli hanya menghitung klik yang berparameter) |
| Menu "Order" affiliate: daftar order yang dibawa, kontak pembeli bila diizinkan | `template/affiliasi-order.php` | **Sama** |

### 7. Pengaturan

| Pengaturan Sejoli | Berkas Sejoli | Kita |
|---|---|---|
| Fitur affiliasi tidak diaktifkan (semua member), dibuka per member lewat User Groups, dengan pesan untuk member tanpa akses | `admin/admin.php` | **Sama**, user group diganti saklar akses per member (D-2) |
| Cookie: General Cookie, Umur Cookie, Kaitkan affiliasi | `admin/admin.php` | **Sama** |
| Tampilkan kontak affiliate di pohon jaringan, tampilkan kontak pembeli di detail pesanan | `admin/admin.php` | **Sama**, bawaan mati (D-9) |
| Batas kedalaman jaringan upline dan downline | `admin/admin.php` | **Sama** |

### 8. Email

| Email Sejoli | Judul bawaan | Kita |
|---|---|---|
| Order baru ke affiliate | "Order #{{invoice-id}} {{product-name}} baru dari {{buyer-name}}" | **Sama** |
| Komisi masuk (pesanan selesai) | "{{affiliate-name}}, Komisi untuk anda dari order #{{invoice-id}} {{product-name}}" | **Sama** |
| Komisi dibayar | "{{affiliate-name}}, Komisi untuk anda sudah dibayarkan" | **Sama** |

## Yang tidak ada di Sejoli

**Undangan email bertoken.** Kata "invit", "undang" dan "token" (selain reCAPTCHA) tidak ditemukan di kode Sejoli 1.5.4, 1.13.14, 1.14.7, maupun di nama berkas add-on resmi `sejoli-lead-gen`, `sejoli-reward`, `sejoli-jv`, `sejoli-rest-api`, `sejoli-wallet`. Fitur ini dibangun baru dan tunduk pada aturan link affiliate Sejoli: membuka undangan sama dengan mengeklik link affiliate (cookie dengan umur yang sama), dan pendaftaran dari undangan menjadikan pengundang sebagai upline.
