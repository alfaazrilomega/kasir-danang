# 03 Peta cerita: Program Affiliate

Produk: Toko online GNNK Racing · Versi 0.1 · 11 Okt 2026 · Status: draft · Terkait: [02 PRD](02-prd.md)

## 1. Pengguna dan tujuan

| Pengguna | Tujuan |
|---|---|
| Admin | Menjalankan program dengan aturan sendiri dan membayar komisi tanpa hitung manual |
| Affiliate | Membagikan link, melihat hasilnya, dan menerima komisi |
| Pengunjung atau pembeli | Belanja seperti biasa. Program tidak mengubah harga |

## 2. Tulang punggung

Urutan kegiatan dari kiri ke kanan:

1. Admin menyiapkan program
2. Affiliate bergabung
3. Affiliate membagikan
4. Pengunjung datang dan mendaftar
5. Pengunjung membeli
6. Pesanan diproses
7. Affiliate memantau
8. Admin membayar

## 3. Cerita per kegiatan

Penanda irisan: **[1]** irisan 1, **[2]** irisan 2.

### K1 Admin menyiapkan program
- [1] Sebagai admin, saya ingin menyalakan program dan memilih siapa yang berhak, supaya hanya member pilihan yang bisa berjualan. (FR-1, FR-2, FR-3)
- [1] Sebagai admin, saya ingin mengatur umur cookie dan General cookie, supaya atribusi sesuai kebijakan toko. (FR-4)
- [1] Sebagai admin, saya ingin mengatur komisi bawaan tier 1, supaya semua produk langsung bisa diaffiliasikan. (FR-5)
- [1] Sebagai admin, saya ingin mengizinkan atau memblokir member tertentu. (FR-47, FR-48)
- [2] Sebagai admin, saya ingin mengatur Kaitkan affiliasi, tier 2 sampai 5, kedalaman jaringan, tampil kontak, undangan, platform, dan email. (FR-4 sampai FR-9)
- [2] Sebagai admin, saya ingin komisi khusus dan syarat "sudah membeli" per produk. (FR-10)

### K2 Affiliate bergabung
- [1] Sebagai member berhak, saya ingin dashboard dengan kode saya, supaya bisa langsung berjualan. (FR-11)
- [1] Sebagai affiliate, saya ingin mengisi informasi rekening, supaya komisi bisa ditransfer. (FR-28)
- [1] Sebagai member tanpa akses, saya ingin pesan yang jelas. (FR-3)

### K3 Affiliate membagikan
- [1] Sebagai affiliate, saya ingin link seluruh toko dan link per produk dengan tombol salin dan WhatsApp. (FR-12)
- [2] Sebagai affiliate, saya ingin menambahkan Platform dan ID ke link, supaya tahu asal pembeli. (FR-13)
- [2] Sebagai affiliate, saya ingin tombol bagikan di halaman produk. (FR-14)
- [2] Sebagai affiliate, saya ingin mengundang calon member lewat email dan melihat status undangan. (FR-31 sampai FR-36)

### K4 Pengunjung datang dan mendaftar
- [1] Sebagai pengunjung, saya dibawa ke produk yang dibagikan, dan kunjungan saya tercatat untuk affiliate. (FR-15, FR-16)
- [2] Sebagai pengunjung yang mendaftar lewat link atau undangan, saya tercatat sebagai jaringan affiliate itu. (FR-17, FR-34, FR-35)

### K5 Pengunjung membeli
- [1] Sebagai affiliate, saya ingin pesanan dari pengunjung saya tercatat atas nama saya dan komisinya terhitung, dan saya mendapat email pesanan baru. (FR-19, FR-20, FR-21, FR-42)
- [2] Sebagai admin, saya ingin Kaitkan affiliasi menjaga pembeli tetap milik affiliate pertamanya. (FR-18, FR-19)
- [2] Sebagai upline, saya ingin komisi tier 2 dari penjualan downline. (FR-22)

### K6 Pesanan diproses
- [1] Sebagai affiliate, saya ingin komisi menjadi Belum dibayar saat pesanan selesai dan mendapat email, atau Dibatalkan saat pesanan batal. (FR-23, FR-43)

### K7 Affiliate memantau
- [1] Sebagai affiliate, saya ingin ringkasan Klik, Lead, Sales, Omset, Komisi untuk hari ini, bulan ini, dan sepanjang waktu. (FR-37)
- [1] Sebagai affiliate, saya ingin daftar order dan daftar komisi saya. (FR-24, FR-40)
- [2] Sebagai affiliate, saya ingin grafik dan tabel sumber trafik. (FR-38, FR-39)
- [2] Sebagai affiliate, saya ingin melihat pohon jaringan saya. (FR-29)

### K8 Admin membayar
- [1] Sebagai admin, saya ingin melihat komisi per affiliate dan membayar dengan bukti transfer, dan pembayaran tercatat sebagai pengeluaran. (FR-26, FR-27, FR-44)
- [2] Sebagai admin, saya ingin daftar semua komisi dengan filter, aksi massal, dan Export CSV. (FR-25)
- [2] Sebagai admin, saya ingin ringkasan kinerja semua affiliate. (FR-41)
- [2] Sebagai admin, saya ingin mengubah upline dan melihat jaringan member. (FR-30, FR-48)

## 4. Irisan rilis

| Irisan | Isi | Hasil yang bisa dipakai |
|---|---|---|
| 1 | Semua cerita [1] | Admin menyalakan program, member pilihan membagikan link, pembelian tercatat, komisi bergerak mengikuti pesanan, admin membayar. Satu tier |
| 2 | Semua cerita [2] | Sejoli lengkap untuk enam bagian: referral dan tier, undangan, sumber trafik, grafik, komisi per produk, alat admin |

## 5. Di luar peta

| Cerita | Alasan |
|---|---|
| Kupon affiliate | Tidak diminta leader. Checkout toko juga belum punya kolom kupon |
| Marketing kit, bonus editor, pixel per affiliate, leaderboard | Tidak diminta leader |
| Notifikasi WhatsApp | Tidak diminta leader. Penyedia WhatsApp toko belum diputuskan klien |
| Komisi pesanan POS dan marketplace | Atribusi memakai cookie browser (D-12) |
| Admin menyunting teks email | Tidak diminta. Teks bawaan Sejoli dipakai |
