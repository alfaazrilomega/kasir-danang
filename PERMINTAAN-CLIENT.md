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

## Gelombang 6 — Biaya susulan PO masuk HPP (spreadsheet 1.10 dan 7.2, 28 Sep)

Sumber: [video A](https://drive.google.com/file/d/1IUHcRTs1_FxBNSQJAtF9o0D_cdXZvNls/view?usp=sharing),
[transkrip](docs/permintaan-client/2026-09-28_video-A_transkrip.txt). Spreadsheet:
"biaya pengiriman + pengeluaran biaya tambahan proses pengemasan" · "mas untuk yg
proses pengeluaran / ongkir dan biaya kemasan saya ada vidioin kmren lnjutan dari tlp".

| # | Permintaan (kutipan video) | Letak di aplikasi |
|---|---|---|
| 13 | "Di bagian PO ini sudah betul untuk irisan atas ya. Nah, tapi … saya order PO itu kan di awal September tanggal 1 … Pengiriman ini kan ada biaya pengiriman dari luar. Itu tidak mungkin sama di inputnya di saat berbarengan. Apakah bisa nantinya dibuatnya itu terpisah, di sini mas, di pengeluaran" · "di sini itu auto atau bisa memilih dengan opsi si PO tersebut … ada nomornya, dan auto-klem ke si bagian si pembelian supplier" · "Jadi nanti ongkos kirimnya itu menambahkan dari si harga barang. Jadi HPP-nya itu bisa full" · "Contoh dari China ke Indonesia, terus dari Indonesia dari gudang Jakarta ke tempat saya … ada biaya juga packing. Tapi inputnya itu di bagian ini, pengeluaran … Jadi nanti HPP barangnya itu nanti terperinci secara otomatis dari biaya pengiriman sama biaya pengurusan lain-lain sama juga biaya packaging" | Pengeluaran (Catat Pengeluaran), Pembelian Supplier (detail nota), Produk (Modal). Gambar: [form nota](docs/permintaan-client/2026-09-28_25.png), [pengeluaran manual "po."](docs/permintaan-client/2026-09-28_26.png), [form tanpa pilihan nota](docs/permintaan-client/2026-09-28_27.png) |

**Butir 13 berarti lima hal, semuanya wajib:**
1. Biaya dicatat di Pengeluaran pada tanggalnya sendiri, terpisah dari waktu nota dibuat.
2. Di form itu ada pilihan nota PO, dan biayanya otomatis menempel ke nota tersebut.
3. Satu nota bisa menerima beberapa biaya bertahap (kirim luar negeri, gudang ke toko, kemasan, pengurusan).
4. HPP per barang di nota itu bertambah otomatis, dengan rincian per jenis biaya.
5. Sisa pelunasan ke supplier tidak ikut berubah. Alasan client: kalau biaya dimasukkan ke nota, DP dan pelunasan harus dihitung ulang tiap kali ("harus dua kali klem").

**Cara butir 13 dijalankan (3 Okt 2026):**
- Biaya susulan adalah baris `expenses` dengan `purchase_id` terisi dan `purchase_cost_slot` kosong. Baris otomatis dari form nota tetap memakai slot `other`/`extra` (butir 12).
- HPP penuh per pcs = harga beli + bagian tiap biaya (dibagi sesuai nilai barang) − bagian diskon nota + bagian pajak nota. Rumusnya di `src/lib/hppNota.ts`.
- HPP penuh adalah angka tampilan: muncul di detail nota (bagian "HPP per barang") dan di bawah kolom Modal daftar Produk. `products.cost_price` tetap harga beli, karena biaya nota sudah dipotong sebagai pengeluaran di Laba Rugi. Memasukkannya juga ke HPP penjualan membuatnya terhitung dua kali.
- Menghapus nota melepas biaya susulan (tetap ada di Pengeluaran), tidak menghapusnya.
- Pilihan "Untuk nota PO" tidak menawarkan nota batal. Baris otomatis dari form nota terkunci ke notanya. Memilih "Bukan biaya nota PO" melepas biaya dari nota.
- Rincian per barang dibulatkan ke rupiah sehingga harga beli + jumlah bagian sama persis dengan HPP penuh yang tertulis. Persen di judul bagian sudah dikurangi diskon nota.
- Nota USD dihitung dalam rupiah (harga beli rupiah di kurs nota), sisa utang dolarnya tidak berubah.
- Di daftar Produk, "HPP penuh" ditulis dua baris pendek di bawah angka Modal supaya kolom Modal tidak melebar dan nama produk tidak terpotong di laptop 1280 sampai 1366px. Kolom Modal hanya tampil di layar 1280px ke atas, di bawah itu HPP penuh dibaca dari detail nota.

Belum diputuskan client: apakah Margin di daftar Produk dan HPP di Laba Rugi harus ikut memakai HPP penuh. Sekarang keduanya memakai harga beli.

## Gelombang 7 — Pajak per transaksi dan Riwayat Transaksi (spreadsheet 4.16, 28 Sep)

Sumber: [video B](https://drive.google.com/file/d/1UgYgkF5ZMKrC_wqOykTAn_vh526Ocklu/view?usp=sharing),
[transkrip](docs/permintaan-client/2026-09-28_video-B_transkrip.txt). Spreadsheet:
"ada fitur pajak bisa ceklist pada waktu input penjualan- kondisional penjualan pajak
meskipun di pengaturan ada setting pajak bisa 10 % ataupun 0) tapi ada opsi dibagian
manual penjualan bisa versi langsung difitur penjualan) / dan nomor urut produk di penjuallan".

| # | Permintaan (kutipan video) | Letak di aplikasi |
|---|---|---|
| 14a | "saya ada temuan mengenai pajak. Di bagian pajak ini kan ada diatur pajak ditanggung oleh penjual sama pajak ditanggung oleh pembeli … Pajak ini, menu-nya checklist … mau pakai pajak ataupun tidak, itu disini bisa di checklist … opsinya disesuaikan dari proses transaksi" | POS Kasir, panel pesanan. Gambar: [kasir menambahkan pajak](docs/permintaan-client/2026-09-28_28.png), [pengaturan bilang termasuk pajak](docs/permintaan-client/2026-09-28_29.png) |
| 14b | "di 2-digit SKU-nya lumayan banyak, 20-30-an. Disini bagian kiri ditambahkan nomor. Nomor saja titik atau nomor satu-satu sampai berikutnya … Jadi, bisa pengecekan seperti itu" | Faktur A4. Gambar: [faktur tanpa nomor](docs/permintaan-client/2026-09-28_30.png) |
| 14c | "tanda tangan itu ukuran berapa? Saya harus crop sama di halaman si logo tersebut … Ini ukurannya ukuran berapa sih" · "Atau memang langsung aja di crop?" | Store Settings, logo dan tanda tangan faktur A4 |
| 14d | "duplikat … di bagian si riwayat … disamaan kayak produk … kalau untuk di produk kan bisa duplikat … Disini ada fitur itu duplikat … Atau mulai dari checklist ini … Ataupun dari si sebelah sini … Ketika kondisinya casenya sudah lumayan tinggi. Jadi kan nggak buat satu-satu … saya tinggal duplikat si penjualannya" | Riwayat Transaksi: bilah centang dan ikon aksi baris. Gambar: [Salin di Produk](docs/permintaan-client/2026-09-28_31.png), [bilah centang](docs/permintaan-client/2026-09-28_32.png) |

**Temuan pajak yang terlihat di video (14a):** dua pesanan Aldo pada malam yang
sama dihitung berbeda. Data produksi: "ORDER ALDO - 28 SEPT" 20.10
`tax_inclusive=false` (pajak ditambahkan), "#260928-202933-GNNKRacing-Offline"
20.30 `tax_inclusive=true` (pajak termasuk harga). Pukul 20.37 jendela Aplikasi
Kasir masih menambahkan pajak padahal pengaturan pukul 20.39 mencentang "Harga
sudah termasuk pajak". Penyebab di kode: pengaturan toko hanya dimuat saat
aplikasi dibuka atau login.

**Cara butir 14 dijalankan (3 Okt 2026):**
- 14a: centang "Pajak N%" di panel pesanan kasir, berlaku per transaksi dan ikut order yang di-park. Tarif dan cara hitung (termasuk harga atau ditambahkan) tetap dari Store Settings. Pengaturan toko sekarang dimuat ulang saat jendela kembali dipakai dan tiap 60 detik selama terlihat.
  - Saklar "Pajak tercentang otomatis tiap penjualan" di Store Settings menentukan keadaan awal centang. Dimatikan berarti penjualan mulai tanpa pajak dan kasir mencentang saat transaksi memang berpajak, itulah "kondisional" yang diminta.
  - Centang hanya muncul kalau "Pajak (%)" di Store Settings lebih dari 0. Per 3 Okt tarif produksi 0%, jadi client perlu mengisi tarifnya dulu.
  - Pengaturan toko dimuat ulang tanpa kolom gambar (logo, tanda tangan, QRIS, banner), dan jawaban untuk toko lain diabaikan: saat database putus server menjawab dengan toko contoh berpajak 10%, yang tidak boleh menimpa kasir yang sedang berjualan.
- 14b: kolom "No" paling kiri di faktur A4, barang diurutkan menurut SKU (baris pesanan tidak menyimpan urutan input). Total, tanda tangan, dan footer pindah halaman bersama, tidak terbelah. Struk thermal tidak diubah.
- 14c: jawaban ukuran. Logo persegi 1:1, ideal 600×600 px (struk dan faktur memotongnya jadi persegi). Tanda tangan PNG transparan sekitar 600×200 px (3:1), tampil dalam kotak setinggi 70px tanpa dipotong. Keterangannya ditulis di Store Settings. Fitur potong gambar di dalam aplikasi tidak dibuat.
- 14d: Duplikat menyalin barang, jumlah, harga per baris, pelanggan, channel, tempo, dan pilihan pajak ke kasir. Pesanan baru baru tersimpan saat kasir menekan Place Order. Tersedia di ikon baris, bilah centang (tepat satu pesanan), dan detail pesanan.
  - Baris salinan diurutkan menurut SKU. Tempo disalin dengan lama tempo yang sama, dihitung dari tanggal hari ini (kalender lokal).
  - Tidak disalin, tetapi kasir diberi tahu: promo dan diskon pesanan asal, barang yang sudah tidak dijual (disebut namanya), dan barang yang stoknya kurang dari jumlah pesanan asal (disebut SKU, stok, dan jumlahnya).
  - Produk set mengikuti aturan kasir: stok dihitung dari isinya dan modal salinan memakai modal isinya saat ini.

## Gelombang 8 — Pelacakan iklan di toko online (spreadsheet 8.1, 18 Sep)

| # | Permintaan (kutipan) | Letak di aplikasi |
|---|---|---|
| 15 | "bt fitu pixel meta, tiktok, google ads bisa ada tanam kode bt di shop nya / jadi pelacakan nya skalian di store.gnnkracing.id" | Store Settings → Toko Online, semua halaman /toko |

**Cara butir 15 dijalankan (3 Okt 2026):**
- Yang diisi admin hanya ID (Meta Pixel ID, TikTok Pixel ID, Google Ads ID, label konversi pembelian Google Ads), bukan potongan kode bebas. Aplikasi satu halaman butuh event dikirim tiap pindah halaman dan saat pembelian; potongan kode tempel hanya jalan sekali saat halaman dimuat.
- Event: lihat halaman, lihat produk (ViewContent), tambah ke keranjang (AddToCart), mulai checkout (InitiateCheckout), pembelian (Purchase) bernilai subtotal barang dalam rupiah. Halaman admin dan kasir tidak dilacak.
- Per 3 Okt belum ada ID yang diisi di produksi, jadi belum ada yang terlacak sampai client mengisinya.

Bagian kedua baris 8.1, fitur afiliasi ("ketika member ada yang bisa tertentu mau
jualan bisa dpatin komisi"), **ditunda atas instruksi user**: dikerjakan paling
akhir, digabung dengan tugas afiliasi yang akan diberikan kemudian.

## Gelombang 9 — Riwayat Transaksi: label kirim dan asal pesanan (spreadsheet 6,3 dan 6.4, 3 Okt)

Sumber: [video C](https://drive.google.com/file/d/1pt93ohErtU0C0jNF7UHZdRDlGJsP1fOT/view?usp=sharing)
([transkrip](docs/permintaan-client/2026-10-03_video-C_transkrip.txt)) dan
[video D](https://drive.google.com/file/d/1h0M_jIkryEpzvoaFw6oOV86TFU4-tKNK/view?usp=drive_link)
([transkrip](docs/permintaan-client/2026-10-03_video-D_transkrip.txt)).

| # | Permintaan (kutipan) | Letak di aplikasi |
|---|---|---|
| 16 | Spreadsheet: "jika ada orderan masuk, untuk proses pengirimannya ( label alamat print bisa proses dari fitur khusus / ditransaksi masuk ada proses ini) karena labelin alamat pengiriman proses penting untuk kirimkan barang". Video: "di sini untuk label pengiriman mas, jadi labeling itu produk atau alamat tujuan yang saya kirimkan. Di sini kan belum ada … alamat untuk tujuan si pengiriman barangnya itu kan belum muncul di sini. Apakah nanti dibikinkan di fitur lain atau tetap di sini … Jadi cetak label alamat tujuan" | Riwayat Transaksi, detail pesanan. Gambar: [pesanan web menunggu konfirmasi](docs/permintaan-client/2026-10-03_33.png), [detail dengan alamat kirim](docs/permintaan-client/2026-10-03_34.png) |
| 17 | Spreadsheet: "terkait layar dibagian riwayat transaksi - bisa dimunculkan dari import asal orderan - tiktok - shopee - whatsapp official". Video: "di bagian channel atau TikToknya tidak terlihat ya. Terlihat ini itu ketika dibuka di bagian detail … di bagian sini dimunculkan di saluran tersebut. Adanya pun muncul orderan dari Shopee, TikTok, WhatsApp, ataupun dari website … Biar nantinya ada pemisahan sendiri terlihat di sini" | Riwayat Transaksi, daftar pesanan. Gambar: [daftar tanpa channel](docs/permintaan-client/2026-10-03_35.png), [channel hanya di detail](docs/permintaan-client/2026-10-03_36.png) |

**Cara butir 16 dijalankan (4 Okt 2026):**
- Tombol "Cetak Label Kirim" di detail pesanan, di sebelah tombol cetak yang client tunjuk di video. Muncul kalau pesanan punya alamat kirim, atau pelanggannya punya alamat utama (pesanan WhatsApp yang dicatat di kasir). Tidak muncul untuk pesanan batal, pesanan tanpa alamat, dan pesanan web yang masih "Menunggu konfirmasi" (di video client mengonfirmasi dulu, baru mencari label).
- Nama dan telepon penerima mengikuti sumber alamatnya: untuk alamat dari pesanan dipakai "Nama Penerima" yang diketik pembeli di checkout (pembeli boleh mengirim ke orang lain), untuk alamat dari pelanggan dipakai data pelanggannya.
- Label 100 × 150 mm, ukuran resi marketplace untuk printer label atau thermal. Isinya penerima (nama, telepon, alamat, kota dan provinsi kalau belum tertulis di alamat), pengirim (nama, telepon, alamat toko dari Store Settings), catatan pesanan, dan isi paket ber-SKU tanpa harga karena label ditempel di luar paket.
- Pesanan banyak barang tetap satu label: daftar barang dipangkas sampai muat dan sisanya ditulis "+ N barang lain (M pcs), rinciannya di faktur". Alamat tidak pernah dipotong; kalau sangat panjang hurufnya dikecilkan (paling kecil 9pt). Catatan dibatasi tiga baris.

**Cara butir 17 dijalankan (4 Okt 2026):**
- Kolom "Channel" di daftar Riwayat untuk layar 1440px ke atas, berisi nama channel dari Store Settings (Shopee Official, TikTok Shop, WhatsApp Direct Order, Website Resmi, dan seterusnya). Di bawah 1440px nama channel ditulis di bawah nomor pesanan: di 1024px kolom tambahan membuat tabel melebar 71px, dan di 1280 sampai 1366px menjepit kolom Tanggal jadi tiga baris begitu ada pesanan menunggu konfirmasi.
- Warna penanda mengikuti keluarga platformnya, jadi channel buatan toko seperti "Shopee gnnk 1" ikut berwarna Shopee. Filter Channel yang sudah ada tetap dipakai untuk memisahkan daftarnya.

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
| Domain store.gnnkracing.id | Per 3 Okt domain ini mengarah ke server lain (103.160.62.131) yang hanya menampilkan "Hello World", dan belum terpasang di proyek Vercel. Pixel butir 15 baru berjalan di domain itu setelah DNS-nya diarahkan ke Vercel |
| Afiliasi (sisa 8.1) | Ditunda user, digabung tugas afiliasi berikutnya |

---

## Catatan cara kerja

- Bukti sebuah butir selesai bukan "suite hijau", melainkan butir itu terlihat
  bekerja di layar produksi. Sebutkan angkanya.
- Perbaikan teknis di satu bagian bisa membatalkan permintaan di bagian yang
  sama. Sesudah mengubah apa pun yang disebut berkas ini, buka lagi barisnya
  dan buktikan masih berlaku.
