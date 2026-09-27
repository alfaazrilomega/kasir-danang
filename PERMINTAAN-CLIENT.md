# Permintaan Client GNNK Racing

Berkas ini adalah sumber kebenaran untuk apa yang diminta client dan leader.
Dibuat karena permintaan pernah hilang dari ingatan di tengah pekerjaan, lalu
sebuah perbaikan teknis membatalkan fitur yang sebenarnya diminta.

**Aturan pakai:** baca berkas ini sebelum menyentuh bagian mana pun yang
disebut di dalamnya. Sebelum menyatakan sebuah perbaikan selesai, cocokkan
lagi dengan kalimat permintaan aslinya, bukan dengan tujuan teknis perbaikan
itu. Kalau sebuah perbaikan membuat salah satu baris di sini tidak lagi
berlaku, perbaikan itu belum selesai.

Kutipan ditulis apa adanya seperti yang dikirim client atau leader lewat
WhatsApp.

---

## Gelombang 1 — Flash sale

| # | Permintaan | Letak di aplikasi |
|---|---|---|
| 1 | Flash sale dengan kuota, penanda di produk, dan laporannya ([referensi](docs/permintaan-client/2026-09-25_13.png)) | Admin Promo tab Flash Sale, toko online, Laporan |

## Gelombang 2 — Nota pembelian (PO)

| # | Permintaan (kutipan) | Letak di aplikasi |
|---|---|---|
| 2 | "terkait halaman total usd dan jumlah rupiah kmren blm sinkron" — nota USD ditulis dalam dollar | Pembelian Supplier, cetak nota |
| 3 | DP dihitung dari nilai barang, bukan dari total setelah biaya | Pembelian Supplier, form nota |
| 4 | Baris biaya kedua yang bisa diberi nama sendiri | Pembelian Supplier, form nota |
| 5 | "dibagian menu produk bagian multi sku blm muncul" — satu nama produk, banyak SKU ([tangkapan layar](docs/permintaan-client/2026-09-25_11.png)) | POS Kasir, Daftar Produk, toko online |
| 6 | "di proses pembuatan po bisa uplod templete juga mas" | Pembelian Supplier, impor item |

## Gelombang 3 — Toko online bagian bawah

| # | Permintaan (kutipan) | Letak di aplikasi |
|---|---|---|
| 7 | "Bagian bawah ada media sosial FB / IG / Tiktok / Ytb" ([tangkapan layar](docs/permintaan-client/2026-09-26_14.png)) | Kaki halaman toko online |
| 8 | "bagian jelajahi GNNK Racing apa bisa buat jadi links artikel" ([tangkapan layar](docs/permintaan-client/2026-09-26_14.png)) | Kaki halaman toko online |
| 9 | "Fitur chat bisa di nonaktifkan / dan aktifkan manual tergantung kondisi. Jd bisa kondisional" ([tangkapan layar](docs/permintaan-client/2026-09-26_15.png)) | Pengaturan → Toko Online, tombol chat di toko |
| 10 | **"Ouh, jadi ga di show semua langsung bagian deskripsi"** → leader: **"Iya mas, trus nanti ada tombol lihat lebih banyak trus nanti baru menampilkan penuh"** | Halaman produk toko online, bagian Deskripsi |

**Butir 10 itu dua hal sekaligus, dan keduanya wajib:**
1. Deskripsi TIDAK boleh tampil penuh begitu halaman dibuka.
2. Harus ada tombol "Lihat lebih banyak" yang membuka isinya sampai penuh.

**Referensi yang client tunjuk sendiri: [halaman Lazada](docs/permintaan-client/2026-09-26_16.png)**,
tombol "LIHAT LEBIH BANYAK" dilingkari biru. Bukti pernah salah dua kali:
[tombol yang cuma menyembunyikan dua baris](docs/permintaan-client/2026-09-26_21.png)
dan [deskripsi tampil penuh tanpa tombol](docs/permintaan-client/2026-09-27_24.png).

Kalau deskripsi tampil penuh tanpa tombol, butir ini gagal — sekalipun
alasannya "isinya sudah pendek". Klem sekarang lima baris, 96px.
Bukti kegagalannya pernah terjadi: [tangkapan layar produksi](docs/permintaan-client/2026-09-27_24.png).

## Gelombang 4 — Detail produk yang menumpuk

| # | Permintaan (kutipan) | Letak di aplikasi |
|---|---|---|
| 11 | "Tampilan bagian bawah produk detail bagian bawah bisa klik muncul sesuai kebutuhan / Tp memanjang ke bawah full tampilan stak" · "Atas sdh sesuai. Tp di bagian bawah ada detail produk yg stak. Bisa ada klik muncul dan hide sesuaikan kebutuhan" | Halaman produk toko online, bagian Detail Produk. Referensi: [Lazada HP terlipat](docs/permintaan-client/2026-09-26_17.png), [terbuka](docs/permintaan-client/2026-09-26_18.png); keluhan: [punya kita menumpuk](docs/permintaan-client/2026-09-26_20.png) |

## Gelombang 5 — Biaya PO masuk pengeluaran

| # | Permintaan (kutipan) | Letak di aplikasi |
|---|---|---|
| 12 | Client: "jika ada ongkir dan biaya pengurusan lain lain untuk PO barang tersebut enaknya masuknya dibedain di pengeluaran atau di gabung ke proses PO" · "tp kondisinya akan berbeda waktu" · Leader: "Jadi mas itu biaya cost lain2 seperti ongkir, pengemasan dll mas" | Pembelian Supplier → Pengeluaran → Laba Rugi |

Keputusan yang diambil bersama user: tanggal tiap biaya diisi sendiri, jadi
satu nota bisa melahirkan beberapa pengeluaran dengan tanggal berbeda.

Tangkapan layar aslinya ada di [docs/permintaan-client/](docs/permintaan-client/)
berikut indeksnya.

---

## Masih menunggu client

| Hal | Yang ditunggu |
|---|---|
| Ongkir dropdown di checkout | Token KiriminAja |
| Notifikasi WhatsApp | Keputusan vendor: tetap Fonnte atau pindah ke OneSender |
| WhatsApp API resmi | Akun WhatsApp Business Cloud API milik client |
| Pembayaran Tripay | Kunci produksi dan whitelist IP |
| Katalog | Data SKU/varian baru berikut fotonya |

---

## Catatan cara kerja

- Bukti sebuah butir selesai bukan "suite hijau", melainkan butir itu terlihat
  bekerja di layar produksi. Sebutkan angkanya.
- Perbaikan teknis di satu bagian bisa membatalkan permintaan di bagian yang
  sama. Sesudah mengubah apa pun yang disebut berkas ini, buka lagi barisnya
  dan buktikan masih berlaku.
