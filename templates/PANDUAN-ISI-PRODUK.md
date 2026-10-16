# Panduan Pengisian Data Produk

Berkas `template-produk-kasir.csv` dipakai untuk memasukkan seluruh katalog produk
ke Aplikasi Kasir sekaligus. Isi berkas ini, lalu serahkan kembali untuk diimpor.

Buka dengan **Excel**, **Google Sheets**, atau **LibreOffice**. Jangan mengubah
baris judul kolom dan jangan menghapus kolom.

Baris paling atas berbunyi `sep=;`. Itu petunjuk untuk Excel supaya kolom
langsung terpisah rapi. Biarkan saja, jangan dihapus dan jangan diisi.
Pemisah antar kolom adalah **titik koma (`;`)**, bukan koma, sehingga nama
produk yang mengandung koma seperti `Gear Depan, Racing` tetap utuh.

## Arti setiap kolom

| Kolom | Wajib | Isi | Contoh |
|---|---|---|---|
| `sku` | **Ya** | Kode unik produk. Tidak boleh sama antar baris. Ini kunci utama, dipakai saat memperbarui data. | `GD-WR155-13T` |
| `barcode` | Tidak | Barcode yang tercetak di kemasan, untuk discan kasir. | `8991234567890` |
| `nama_produk` | **Ya** | Nama yang tampil di kasir dan struk. | `Gear Depan WR155 520 13T` |
| `kategori` | Tidak | Nama kategori. **Dibuat otomatis** bila belum ada. Kosong = "Tanpa Kategori". | `Gear & Rantai` |
| `deskripsi` | Tidak | Keterangan tambahan. | `Gear depan racing 13 mata` |
| `harga_jual` | **Ya** | Harga jual ke pembeli, angka saja. | `175000` |
| `harga_modal` | Tidak | Harga beli / HPP. **Dipakai menghitung laba** — kosongkan hanya bila memang belum tahu. | `120000` |
| `stok` | Tidak | Jumlah stok saat ini. Kosong dianggap `0`. | `25` |
| `stok_minimum` | Tidak | Batas peringatan stok menipis. | `5` |
| `lacak_stok` | Tidak | `ya` bila stok dikurangi otomatis saat terjual. Kosong dianggap `ya`. | `ya` |
| `aktif` | Tidak | `ya` bila produk tampil di kasir. Kosong dianggap `ya`. | `ya` |
| `sku_shopee` | Tidak | Kode produk ini **di Shopee**, bila berbeda dari SKU internal. | `SHP-GD-WR155-13T` |
| `sku_tiktok` | Tidak | Kode produk ini di TikTok Shop. | `TT-GD-WR155-13T` |
| `sku_tokopedia` | Tidak | Kode produk ini di Tokopedia. | `TKPD-GD-WR155-13T` |
| `sku_website` | Tidak | Kode produk di website sendiri. | `WEB-GD-WR155-13T` |

## Aturan pengisian

**Angka** ditulis tanpa `Rp` dan tanpa satuan. Pemisah ribuan boleh ada atau tidak —
`175000` dan `175.000` sama-sama diterima. Untuk pecahan gunakan koma: `1500,50`.

**Ya / tidak** boleh ditulis `ya`, `yes`, `true`, atau `1`. Selain itu dianggap tidak.

**Kolom SKU marketplace** hanya diisi bila kode di marketplace **berbeda** dari
`sku`. Kalau sama, biarkan kosong. Kolom inilah yang membuat pesanan Shopee/TikTok
otomatis dikenali sebagai produk yang benar.

**Baris contoh** (tiga baris di bawah judul kolom) **harus dihapus** sebelum
diserahkan, kecuali memang produk Anda.

## Yang terjadi saat diimpor

Sebelum data masuk, sistem memeriksa seluruh berkas lebih dulu dan menampilkan
ringkasan: berapa produk baru, berapa yang diperbarui, dan **baris mana** yang
bermasalah lengkap dengan nomor barisnya. Tidak ada data yang ditulis sampai
ringkasan itu disetujui.

Tersedia dua cara:

- **Ganti total** — seluruh produk yang ada dihapus, lalu diganti isi berkas.
  Dipakai saat pertama kali menyiapkan sistem.
- **Gabung per SKU** — produk dengan `sku` sama diperbarui, `sku` baru ditambahkan,
  produk lain dibiarkan. Dipakai untuk pembaruan berkala.

Riwayat transaksi, shift, dan pembelian **tidak terpengaruh** oleh impor produk.

## Kesalahan yang sering terjadi

| Masalah | Akibat | Perbaikan |
|---|---|---|
| `sku` kosong | Baris dilewati | Isi kode unik |
| `sku` kembar | Baris kedua dilewati | Pastikan setiap kode hanya sekali |
| Harga ditulis `Rp 175.000` | Baris dilewati | Tulis `175000` |
| Kolom dihapus atau namanya diubah | Berkas ditolak | Gunakan template asli |
| Berkas disimpan sebagai `.xlsx` | Tidak bisa dibaca | Simpan sebagai **CSV** |
| Baris `sep=;` dihapus | Excel menumpuk semua isi di satu kolom | Biarkan baris itu apa adanya |
| Berkas dipisah koma dan ada nama produk bermuatan koma | Nama terpotong jadi dua kolom | Simpan dengan pemisah `;`, atau apit nama itu dengan tanda kutip |
