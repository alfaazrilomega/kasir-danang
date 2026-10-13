# 02 PRD: Program Affiliate GNNK Racing

Produk: Toko online GNNK Racing · Versi 0.1 · 11 Okt 2026 · Status: draft · Terkait: [01 BRD](01-brd.md), [03 Peta cerita](03-story-map.md), [04 Wireframe](04-wireframes.md), [08 Rencana uji](08-qa-test-plan.md), [Referensi Sejoli](sejoli-referensi.md)

## 1. Ringkasan

Member toko online yang punya akses affiliate mendapat kode dan link. Pengunjung yang datang lewat link atau undangan email ditandai dengan cookie selama umur yang diatur toko. Pesanan mereka tercatat atas nama affiliate, komisinya dihitung per barang dan per tier, lalu statusnya bergerak sendiri mengikuti status pesanan. Admin membayar komisi per affiliate. Affiliate dan admin melihat angka kinerja. Semua perilaku mengikuti Sejoli 1.14.7 kecuali yang ditandai di [Referensi Sejoli](sejoli-referensi.md).

## 2. Tujuan dan bukan tujuan

**Tujuan:** BR-1 sampai BR-10 di [01 BRD](01-brd.md#6-kebutuhan-bisnis).

**Bukan tujuan:** kupon affiliate, marketing kit, bonus editor, pixel per affiliate, leaderboard, notifikasi WhatsApp atau SMS, komisi untuk pesanan POS dan marketplace, penyuntingan teks email oleh admin.

## 3. Pengguna dan peran

| Aksi | Pengunjung | Member tanpa akses | Affiliate | Admin | Staf lain (kasir, gudang) |
|---|---|---|---|---|---|
| Membuka link atau undangan affiliate | Ya | Ya | Ya (kliknya tidak dihitung) | Ya | Ya |
| Membuka dashboard affiliate | Diminta masuk | Melihat pesan "belum punya akses" | Ya, data sendiri saja | Lewat menu Affiliate | Tidak |
| Membuat dan membagikan link | Tidak | Tidak | Ya | Tidak | Tidak |
| Mengirim undangan email | Tidak | Tidak | Ya | Tidak | Tidak |
| Melihat jaringan | Tidak | Tidak | Downline sendiri | Semua member | Tidak |
| Mengisi informasi rekening | Tidak | Tidak | Ya | Tidak | Tidak |
| Mengatur program dan komisi bawaan | Tidak | Tidak | Tidak | Ya | Tidak |
| Mengatur komisi per produk | Tidak | Tidak | Tidak | Ya | Tidak |
| Memberi atau mencabut akses, mengubah kode dan upline | Tidak | Tidak | Tidak | Ya | Tidak |
| Melihat dan membayar komisi | Tidak | Tidak | Melihat milik sendiri | Ya | Tidak |

## 4. Alur utama

**AL-1 Membuka dashboard affiliate.** (1) Member masuk dan membuka Akun, tab Affiliate. (2) Bila program mati atau member tidak berhak, tampil pesan akses dari Pengaturan. (3) Bila berhak, kode affiliate dibuat otomatis saat pertama kali dan dashboard tampil. Gagal memuat data: pesan "Data affiliate gagal dimuat. Coba lagi." dengan tombol Coba lagi.

**AL-2 Membuat dan membagikan link.** (1) Affiliate membuka Link. (2) Memilih "Semua produk" atau mencari satu produk. (3) Link tampil, misalnya `https://store.gnnkracing.id/aff/ANDI24/<id produk>`. (4) Opsional: memilih Platform dan mengisi ID, lalu "Tambahkan parameter", link mendapat `?utm_source=fb&utm_media=story-okt`. (5) Salin atau bagikan ke WhatsApp. Produk yang affiliasinya mati tidak muncul di pilihan.

**AL-3 Pengunjung membuka link.** (1) Server memeriksa program, kode, akses affiliate, dan produk. (2) Lolos: cookie dibuat atau diperbarui, klik dicatat, pengunjung dibawa ke halaman produk atau beranda toko. (3) Gagal: halaman pesan Sejoli yang sesuai (bagian 8) dengan tombol "Ke toko", tanpa cookie. (4) Program mati: langsung dibawa ke toko tanpa cookie.

**AL-4 Pengunjung mendaftar dan membeli.** (1) Saat daftar akun (email atau Google pertama kali) dengan cookie affiliate, affiliate umum di cookie menjadi upline akun baru. (2) Saat checkout, server menentukan affiliate pesanan (aturan FR-19). (3) Pesanan tersimpan bersama affiliate, sumber, dan parameter akuisisinya, lalu komisi dibuat berstatus "Order belum selesai". (4) Affiliate tier 1 menerima email pesanan baru. Gagal menghitung komisi tidak menggagalkan pesanan: pesanan tetap tersimpan dan kesalahannya dicatat di log server.

**AL-5 Pesanan selesai atau batal.** (1) Staf mengonfirmasi pesanan, status pesanan menjadi Selesai, semua komisinya menjadi "Belum dibayar", dan tiap penerima komisi menerima email komisi masuk. (2) Staf menolak atau membatalkan pesanan, komisinya menjadi "Dibatalkan" tanpa email. Komisi yang sudah dibayar lalu batal tetap bertanda "Sudah dibayar" dan masuk daftar "Perlu ditindaklanjuti".

**AL-6 Admin membayar komisi.** (1) Admin membuka Affiliate, tab Pembayaran. (2) Baris tiap affiliate menampilkan Komisi potensial, Komisi belum dibayar, Komisi sudah dibayar dalam rentang tanggal. (3) Admin menekan "Bayar", dialog menampilkan nama, email, telepon, informasi rekening, total, kolom bukti transfer (gambar, opsional), catatan, dan centang "Catat sebagai pengeluaran" (tercentang). (4) Konfirmasi: semua komisi Belum dibayar milik affiliate itu dalam rentang menjadi Sudah dibayar, riwayat pembayaran tersimpan, pengeluaran dibuat bila dicentang, affiliate menerima email. Gagal menyimpan: tidak ada komisi yang berubah (satu transaksi).

**AL-7 Mengundang lewat email.** (1) Affiliate membuka Undang, mengisi email, nama (opsional), pesan pribadi (opsional). (2) Server memeriksa batas dan email, menyimpan undangan dengan token, lalu mengirim email. (3) Penerima membuka tautan: token sah, cookie affiliate dibuat seperti klik link, lalu dibawa ke halaman daftar dengan email terisi. (4) Penerima mendaftar: pengundang menjadi upline, undangan berstatus Terdaftar. Token kedaluwarsa atau tidak dikenal: halaman pesan dan tombol "Ke toko".

**AL-8 Melihat jaringan.** Affiliate membuka Jaringan, pohon downline tampil sampai kedalaman pengaturan. Menekan nama menampilkan detail. Kontak hanya tampil bila pengaturan mengizinkan.

**AL-9 Mengatur.** Admin mengubah Pengaturan affiliate dan bagian Affiliasi di formulir produk, lalu Simpan. Perubahan berlaku untuk klik dan pesanan berikutnya, komisi yang sudah tercatat tidak dihitung ulang.

## 5. Kebutuhan fungsional

### Pengaturan dan akses

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-1 | Admin dapat menyalakan dan mematikan program affiliate. Saat mati, link membawa ke toko tanpa cookie, pesanan baru tidak mendapat affiliate, komisi lama tetap mengikuti status pesanan dan tetap bisa dibayar. | BR-1 |
| FR-2 | Admin memilih siapa yang berhak: "Semua member" atau "Hanya member yang diizinkan". Setiap member punya akses "Ikut pengaturan", "Diizinkan", atau "Diblokir". Berhak = program aktif dan (Diizinkan, atau Ikut pengaturan dengan mode Semua member). | BR-1 |
| FR-3 | Admin dapat menulis pesan untuk member tanpa akses. | BR-1 |
| FR-4 | Admin mengatur Umur cookie (hari, 0 = selamanya), General cookie, dan Kaitkan affiliasi. | BR-3 |
| FR-5 | Admin mengatur komisi bawaan toko: 1 sampai 5 tier, tiap tier bertipe Persentase atau Nilai tetap. | BR-4 |
| FR-6 | Admin mengatur kedalaman tampilan jaringan (downline dan upline, 1 sampai 10; kedalaman downline berlaku di halaman Jaringan affiliate dan di tampilan jaringan member pada admin, kedalaman upline di tampilan admin, sama dengan Sejoli) serta saklar "Tampilkan kontak downline di pohon jaringan" dan "Tampilkan kontak pembeli di order affiliate". | BR-7 |
| FR-7 | Admin mengatur masa berlaku undangan (hari) dan batas undangan per affiliate per hari. | BR-8 |
| FR-8 | Admin mengubah daftar platform akuisisi (satu baris per platform, format `kode;Nama`). | BR-9 |
| FR-9 | Admin menyalakan atau mematikan tiap email (pesanan baru, komisi masuk, komisi dibayar) dan mengisi alamat salinan untuk admin (opsional, boleh lebih dari satu, dipisah koma). | BR-10 |

### Produk

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-10 | Formulir produk punya bagian Affiliasi: "Aktifkan fitur affiliasi pada produk ini" (bawaan aktif), "Aktifkan fitur affiliasi jika user telah membeli produk ini" (bawaan mati), dan "Komisi khusus produk" (tier seperti FR-5, kosong = memakai komisi bawaan). | BR-4 |

### Kode, link, dan klik

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-11 | Kode affiliate dibuat otomatis saat member berhak membuka dashboard pertama kali: huruf dari nama depan (maks 6, huruf besar) ditambah 2 angka, unik per toko. Hanya admin yang dapat mengubahnya. | BR-2 |
| FR-12 | Halaman Link menampilkan kode dengan tombol salin, link seluruh toko, dan pembuat link per produk dengan pencarian. Tiap link punya tombol Salin dan Bagikan ke WhatsApp (dan tombol bagikan bawaan HP bila tersedia). | BR-2 |
| FR-13 | Pembuat parameter: pilih Platform dari daftar FR-8 dan isi ID, lalu link mendapat `utm_source` dan `utm_media`. | BR-9 |
| FR-14 | Di halaman produk toko, affiliate yang sedang masuk melihat tombol "Bagikan & dapat komisi" yang menyalin link affiliate produk itu. | BR-2 |
| FR-15 | Membuka `/aff/{KODE}` atau `/aff/{KODE}/{id produk}` memeriksa program, kode, akses, dan produk, lalu membuat cookie, mencatat klik, dan mengarahkan pengunjung. Cookie menyimpan affiliate umum, affiliate per produk, dan parameter akuisisi, ditandatangani server, dan berumur sesuai pengaturan. Klik terakhir menimpa yang sebelumnya. | BR-3 |
| FR-16 | Klik dicatat dengan affiliate, produk (bila ada), sumber, ID, jenis (link atau undangan), dan waktu. Klik oleh affiliate itu sendiri saat masuk tidak dicatat. | BR-9 |

### Atribusi pesanan

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-17 | Saat daftar akun baru (email, atau Google pertama kali), affiliate umum di cookie atau pengundang menjadi upline akun itu, dengan sumber "link" atau "undangan". | BR-7 |
| FR-18 | Saat checkout dengan Kaitkan affiliasi aktif dan pembeli belum punya upline, affiliate pesanan menjadi upline pembeli dengan sumber "checkout". | BR-7 |
| FR-19 | Affiliate pesanan ditentukan berurutan: (a) Kaitkan affiliasi aktif dan pembeli punya upline: upline itu; (b) affiliate per produk di cookie untuk salah satu barang di keranjang (klik terbaru); (c) affiliate umum di cookie bila General cookie aktif. Calon yang sama dengan pembeli, tidak berhak, atau tidak berhak atas satu pun barang di pesanan, dibuang. | BR-4 |
| FR-20 | Pesanan menyimpan affiliate, sumber atribusi (kaitan, link, undangan), serta sumber dan ID akuisisi. Detail pesanan di admin menampilkan affiliate dan ringkasan komisinya. | BR-4 |

### Komisi

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-21 | Komisi dihitung per barang yang berhak dan per tier: Persentase = nilai barang setelah bagian diskon pesanan, tanpa ongkir dan pajak, dikali persen; Nilai tetap = nilai dikali jumlah barang. Dibulatkan ke bawah per rupiah. Komisi 0 tidak dicatat. | BR-4 |
| FR-22 | Penerima tier 1 adalah affiliate pesanan, tier berikutnya adalah upline dari penerima tier sebelumnya. Rantai berhenti bila tidak ada upline atau orang yang sama muncul lagi. Penerima tanpa akses dilewati untuk tier itu. | BR-7 |
| FR-23 | Status komisi mengikuti status pesanan lewat satu jalur di database: Menunggu konfirmasi atau Pending menjadi "Order belum selesai", Selesai menjadi "Belum dibayar", Dibatalkan menjadi "Dibatalkan". Berlaku dari jalur mana pun pesanan diubah. | BR-5 |
| FR-24 | Halaman Komisi affiliate menampilkan total Order belum selesai, Belum dibayar, Sudah dibayar, dan daftar komisi (tanggal, nomor pesanan, produk, tier, komisi, status) dengan filter status dan rentang tanggal. | BR-5 |
| FR-25 | Admin melihat Data Komisi (semua komisi) dengan filter nomor pesanan, rentang tanggal, status pesanan, status pembayaran, aksi massal "Konfirmasi pembayaran komisi" dan "Ubah status komisi ke Belum Dibayar", serta Export CSV. | BR-6 |
| FR-26 | Admin melihat Data Komisi per Affiliasi dan membayar per affiliate seperti AL-6, termasuk bukti transfer (JPG, PNG, atau WebP, dikecilkan sampai maks 300 KB) dan riwayat pembayaran. | BR-6 |
| FR-27 | Pembayaran yang dicentang "Catat sebagai pengeluaran" membuat satu pengeluaran berkategori "Komisi Affiliate" sebesar total pembayaran pada tanggal bayar. | BR-6 |
| FR-28 | Affiliate mengisi Informasi Rekening (bank, nomor, atas nama dalam satu kolom teks) di dashboard. Dialog bayar menampilkan peringatan bila kosong. | BR-6 |

### Referral dan jaringan

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-29 | Halaman Jaringan menampilkan "Bergabung lewat: {upline}" (bila ada) dan pohon downline sampai kedalaman pengaturan: nama, tanggal bergabung, jumlah downline langsung. Detail kontak hanya bila diizinkan pengaturan. | BR-7 |
| FR-30 | Admin dapat mengubah upline member, kecuali menjadi dirinya sendiri atau downline-nya sendiri. | BR-7 |

### Undangan email

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-31 | Affiliate mengirim undangan berisi email (wajib), nama (opsional, maks 80), pesan pribadi (opsional, maks 300). | BR-8 |
| FR-32 | Undangan ditolak bila email tidak sah, sudah terdaftar sebagai member, sudah diundang affiliate yang sama kurang dari 24 jam lalu, atau batas harian tercapai. | BR-8 |
| FR-33 | Tautan undangan berisi token acak 256 bit, server hanya menyimpan sidiknya, berlaku sesuai pengaturan. | BR-8 |
| FR-34 | Membuka undangan sah: cookie affiliate dibuat seperti FR-15 (jenis undangan), status menjadi Dibuka (sekali, waktu pertama), lalu ke halaman daftar dengan email terisi. | BR-8 |
| FR-35 | Pendaftaran dari undangan menjadikan pengundang upline dan status Terdaftar. Bila tanpa cookie tetapi email pendaftar cocok dengan undangan yang masih berlaku, undangan terlama yang berlaku dipakai. | BR-7 |
| FR-36 | Halaman Undang menampilkan daftar undangan (email, nama, tanggal, status) dan tombol "Kirim ulang" untuk undangan yang belum Terdaftar dan sudah lebih dari 24 jam. Kirim ulang memperpanjang masa berlaku. | BR-8 |

### Analytics

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-37 | Ringkasan affiliate: Hari ini, Bulan ini, Sepanjang waktu, masing-masing Klik, Lead, Sales, Omset, Komisi (definisi D-10). | BR-9 |
| FR-38 | Grafik affiliate: bulan ini per hari dan tahun ini per bulan (Sales dan Omset). | BR-9 |
| FR-39 | Tabel akuisisi affiliate per sumber dan ID: View, Lead, Sale, Nilai. Klik tanpa parameter masuk sumber "Langsung". | BR-9 |
| FR-40 | Daftar Order affiliate: nomor, tanggal, pembeli, nilai barang, status, komisi kamu, filter status dan tanggal. Kontak pembeli dan tombol WhatsApp hanya bila diizinkan pengaturan. | BR-9 |
| FR-41 | Ringkasan admin dengan rentang tanggal: jumlah affiliate berhak dan aktif (punya klik atau pesanan dalam rentang), Klik, Lead, Sales, Omset, Komisi potensial, belum dibayar, sudah dibayar, tabel per affiliate yang bisa diurutkan, dan 10 produk teratas lewat affiliate. | BR-9 |

### Email

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-42 | Email pesanan baru ke affiliate tier 1 saat pesanan dibuat (judul dan isi Sejoli, bagian 11). | BR-10 |
| FR-43 | Email komisi masuk ke tiap penerima saat komisinya menjadi Belum dibayar. | BR-10 |
| FR-44 | Email komisi dibayar ke affiliate saat pembayaran disimpan. | BR-10 |
| FR-45 | Email undangan ke calon member. | BR-8 |
| FR-46 | Email dikirim lewat antrean: gagal dicoba lagi sampai 3 kali, tidak pernah menggagalkan pesanan atau pembayaran, alamat domain uji dilewati. | BR-10 |

### Daftar affiliate untuk admin

| Kode | Kebutuhan | BR |
|---|---|---|
| FR-47 | Tab Affiliate menampilkan member: nama, email, kode, akses, status berhak, upline, jumlah downline, klik, sales, komisi belum dibayar, dengan pencarian dan filter akses. | BR-1 |
| FR-48 | Aksi per member: ubah akses, ubah kode, ubah upline, lihat jaringan (upline dan downline). | BR-1, BR-7 |

## 6. Kamus data

### Pengaturan toko (disimpan sebagai satu objek pengaturan affiliate di data toko, diubah admin)

| Kolom | Label | Tipe | Batas | Bawaan |
|---|---|---|---|---|
| enabled | Aktifkan program affiliate | ya/tidak | | tidak |
| access_mode | Siapa yang bisa menjadi affiliate | pilihan: `all` Semua member, `approved` Hanya member yang diizinkan | | `approved` |
| no_access_text | Pesan untuk member tanpa akses | teks | maks 1.000 | "Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi." |
| cookie_days | Umur cookie (hari) | angka bulat | 0 sampai 3.650, 0 = selamanya | 30 |
| general_cookie | General cookie | ya/tidak | | ya |
| permanent | Kaitkan affiliasi | ya/tidak | | tidak |
| commission | Komisi bawaan | daftar tier {type: `percentage` atau `fixed`, value} | 1 sampai 5 tier, persen 0 sampai 100, nilai tetap 0 sampai 100.000.000 | 1 tier, 10% |
| downline_depth | Kedalaman jaringan (downline) | angka | 1 sampai 10 | 1 |
| upline_depth | Kedalaman jaringan (upline) | angka | 1 sampai 10 | 1 |
| show_downline_contact | Tampilkan kontak downline di pohon jaringan | ya/tidak | | tidak |
| show_buyer_contact | Tampilkan kontak pembeli di order affiliate | ya/tidak | | tidak |
| invite_days | Masa berlaku undangan (hari) | angka | 1 sampai 90 | 7 |
| invite_daily_limit | Batas undangan per affiliate per hari | angka | 1 sampai 200 | 20 |
| platforms | Daftar platform | teks banyak baris `kode;Nama` | maks 30 baris, kode `a-z0-9_-` maks 20 | fb;Facebook, ins;Instagram, insto;Instagram Story, what;WhatsApp, email;Email, line;Line, tiktok;TikTok |
| email_new_order, email_commission, email_paid | Email pesanan baru, komisi masuk, komisi dibayar | ya/tidak | | ya |
| admin_copy_emails | Salinan email untuk admin | teks, email dipisah koma | maks 5 alamat | kosong |

### Produk (diubah admin)

| Kolom | Label | Tipe | Bawaan |
|---|---|---|---|
| affiliate_enabled | Aktifkan fitur affiliasi pada produk ini | ya/tidak | ya |
| affiliate_if_bought | Aktifkan fitur affiliasi jika user telah membeli produk ini | ya/tidak | tidak |
| affiliate_commission | Komisi khusus produk | daftar tier seperti pengaturan, kosong = bawaan | kosong |

### Member (pelanggan)

| Kolom | Label | Tipe | Diubah oleh |
|---|---|---|---|
| affiliate_code | Kode affiliate | teks `A-Z0-9`, 4 sampai 20, unik per toko | sistem, admin |
| affiliate_access | Akses affiliate | `default`, `allowed`, `blocked` | admin |
| referred_by | Upline | member lain | sistem, admin |
| referred_at, referral_source | Waktu dan sumber bergabung | waktu, `link`/`undangan`/`checkout`/`admin` | sistem |
| bank_info | Informasi Rekening | teks maks 300 | affiliate |

### Pesanan

| Kolom | Arti |
|---|---|
| affiliate_id | Affiliate tier 1 pesanan |
| affiliate_source | `kaitan`, `link`, `undangan` |
| acquisition_source, acquisition_media | Nilai `utm_source` dan `utm_media` dari klik |

### Komisi

| Kolom | Arti |
|---|---|
| order_id, order_item_id, product_id | Asal komisi |
| affiliate_id, tier | Penerima dan tingkatnya |
| base_amount, rate_type, rate_value | Dasar perhitungan yang dipakai saat komisi dibuat |
| commission | Besar komisi (rupiah bulat) |
| status | `pending`, `added`, `cancelled` |
| paid, paid_at, payout_id | Tanda dibayar dan pembayarannya |

### Pembayaran komisi

| Kolom | Arti |
|---|---|
| affiliate_id, amount, commission_count | Penerima, total, jumlah komisi |
| paid_at, paid_by | Waktu dan admin |
| proof_image | Bukti transfer, opsional |
| note | Catatan, maks 300 |
| expense_id | Pengeluaran yang dibuat, bila dicentang |

### Undangan

| Kolom | Arti |
|---|---|
| affiliate_id, email, name, message | Pengundang dan isi undangan |
| token_hash | Sidik token, token asli tidak disimpan |
| status | `sent`, `opened`, `registered`, `failed` (Kedaluwarsa dihitung dari `expires_at`) |
| sent_at, opened_at, expires_at, registered_customer_id, resend_count | Riwayat undangan |

### Klik

| Kolom | Arti |
|---|---|
| affiliate_id, product_id | Link yang diklik |
| kind | `link` atau `undangan` |
| source, media | Parameter akuisisi |
| visitor_hash | Sidik IP dan perangkat, untuk menghitung pengunjung unik |
| created_at | Waktu |

## 7. Siklus status

### Komisi

| Status | Label | Kapan | Oleh |
|---|---|---|---|
| pending | Order belum selesai | Komisi dibuat, atau pesanan kembali menunggu | Sistem |
| added, belum dibayar | Belum dibayar | Pesanan Selesai | Sistem |
| added, dibayar | Sudah dibayar | Admin membayar | Admin |
| cancelled | Dibatalkan | Pesanan Dibatalkan | Sistem |

Perpindahan yang sah: pending ke added, pending ke cancelled, added ke cancelled, cancelled ke pending atau added (pesanan dipulihkan), belum dibayar ke dibayar, dibayar ke belum dibayar (aksi admin). Komisi Dibatalkan yang bertanda dibayar masuk filter "Perlu ditindaklanjuti".

### Undangan

| Status | Label |
|---|---|
| sent | Terkirim |
| opened | Dibuka |
| registered | Terdaftar |
| failed | Gagal terkirim |
| (sent atau opened, lewat `expires_at`) | Kedaluwarsa |

### Akses member

| Akses | Label | Berhak bila program aktif |
|---|---|---|
| default | Ikut pengaturan | Ya bila mode Semua member, tidak bila mode Hanya yang diizinkan |
| allowed | Diizinkan | Ya |
| blocked | Diblokir | Tidak |

## 8. Pesan dan validasi

| Kejadian | Pesan |
|---|---|
| Produk link tidak ada | Produk tidak terdaftar di database |
| Affiliasi produk dimatikan | Produk ini sudah tidak diaffiliasikan lagi |
| Kode tidak dikenal | Affiliasi tidak terdaftar di database |
| Affiliate tidak berhak atas link atau produk | Link affiliasi ini tidak diperkenankan. Silahkan hubungi pemilik link affiliasi ini |
| Undangan tidak dikenal | Undangan tidak ditemukan. Minta pengundang mengirim ulang. |
| Undangan kedaluwarsa | Undangan ini sudah kedaluwarsa. Minta pengundang mengirim ulang. |
| Email undangan tidak sah | Email tidak valid. |
| Email sudah member | Email ini sudah terdaftar sebagai member. |
| Undangan ganda | Email ini sudah kamu undang dalam 24 jam terakhir. |
| Batas harian | Batas undangan hari ini sudah tercapai ({n} undangan). Coba lagi besok. |
| Undangan terkirim | Undangan terkirim ke {email}. |
| Kode affiliate tidak sah (admin) | Kode hanya boleh huruf besar dan angka, 4 sampai 20 karakter. |
| Kode dipakai (admin) | Kode ini sudah dipakai affiliate lain. |
| Upline tidak sah (admin) | Upline tidak boleh dirinya sendiri atau downline-nya. |
| Pembayaran tersimpan (admin) | Komisi {nama} sebesar {Rp} ditandai TELAH DIBAYAR. |
| Rekening kosong (dialog bayar) | Affiliate belum mengisi informasi rekening. |
| Tidak ada yang dibayar | Tidak ada komisi Belum dibayar untuk affiliate ini pada rentang tanggal ini. |
| Bukti transfer terlalu besar atau bukan gambar | Bukti transfer harus gambar JPG, PNG, atau WebP. |
| Link disalin | Link disalin. |
| Rekening tersimpan | Informasi rekening tersimpan. |
| Pengaturan tersimpan | Pengaturan affiliate tersimpan. |
| Persen di luar batas | Persentase komisi harus 0 sampai 100. |
| Nama atau pesan undangan memuat tautan | Nama dan pesan undangan tidak boleh memuat tautan. |
| Kirim ulang sebelum 24 jam | Undangan baru bisa dikirim ulang 24 jam setelah pengiriman terakhir. |
| Kode terlarang (admin) | Kode UNDANGAN tidak bisa dipakai. Pilih kode lain. |
| Hapus pesanan yang komisinya sudah dibayar (admin) | Pesanan {nomor} punya komisi affiliate yang sudah dibayar, jadi tidak bisa dihapus. Batalkan pesanannya, atau batalkan dulu pembayaran komisinya di menu Affiliate. |
| Daftar mencapai batas | Menampilkan {n} {order atau komisi} terbaru. Angka ringkasan tetap menghitung semuanya. |

## 9. Kriteria penerimaan

### Pengaturan dan akses

- **AC-1** (FR-1) Diberikan program mati, ketika pengunjung membuka link affiliate yang sah, maka ia dibawa ke beranda toko dan tidak ada cookie affiliate.
- **AC-2** (FR-1) Diberikan program dimatikan setelah ada komisi Belum dibayar, ketika admin membayarnya, maka pembayaran berhasil.
- **AC-3** (FR-2) Diberikan mode "Hanya member yang diizinkan", ketika member berakses "Ikut pengaturan" membuka dashboard, maka tampil pesan akses dan tidak ada kode dibuat.
- **AC-4** (FR-2) Diberikan mode "Semua member", ketika member berakses "Diblokir" membuka dashboard, maka tampil pesan akses.
- **AC-5** (FR-3) Diberikan admin mengubah pesan akses, ketika member tanpa akses membuka dashboard, maka tampil pesan yang baru.
- **AC-6** (FR-4) Diberikan umur cookie 30, ketika pengunjung membuka link, maka cookie affiliate berlaku 30 hari ±1 menit.
- **AC-7** (FR-4) Diberikan umur cookie 0, ketika pengunjung membuka link, maka cookie berlaku setidaknya 3.650 hari.
- **AC-8** (FR-5, FR-10) Diberikan persen 120 di komisi, ketika admin menyimpan, maka tampil "Persentase komisi harus 0 sampai 100." dan tidak tersimpan.

### Link dan klik

- **AC-9** (FR-11) Diberikan member berhak bernama "Andi Saputra" membuka dashboard pertama kali, maka kode berpola `ANDI` diikuti 2 angka dan unik di toko.
- **AC-10** (FR-12) Diberikan affiliate memilih satu produk, maka link `https://{toko}/aff/{KODE}/{id produk}` tampil dan tombol Salin menyalin persis teks itu.
- **AC-11** (FR-12) Diberikan produk dengan affiliasi mati, maka produk itu tidak muncul di pencarian pembuat link.
- **AC-12** (FR-13) Diberikan Platform Facebook dan ID "story-okt", maka link berakhiran `?utm_source=fb&utm_media=story-okt`.
- **AC-13** (FR-15) Diberikan link produk sah, ketika pengunjung membukanya, maka ia tiba di halaman produk itu dan cookie memuat affiliate umum dan affiliate untuk produk itu.
- **AC-14** (FR-15) Diberikan kode tidak dikenal, ketika dibuka, maka tampil "Affiliasi tidak terdaftar di database" dan tidak ada cookie.
- **AC-15** (FR-15) Diberikan produk berpengaturan "jika sudah membeli" dan affiliate belum pernah membelinya, ketika link dibuka, maka tampil "Link affiliasi ini tidak diperkenankan..." dan tidak ada cookie.
- **AC-16** (FR-15) Diberikan isi cookie diubah tangan, ketika pembeli checkout, maka pesanan tidak mendapat affiliate.
- **AC-17** (FR-16) Diberikan affiliate masuk dan membuka link miliknya, maka jumlah klik tidak bertambah.
- **AC-18** (FR-14) Diberikan affiliate masuk membuka halaman produk berhak, maka tombol "Bagikan & dapat komisi" menyalin link affiliate produk itu. Member tanpa akses tidak melihat tombol.

### Atribusi

- **AC-19** (FR-17) Diberikan cookie dari affiliate A, ketika pengunjung mendaftar akun baru, maka upline akun itu A dengan sumber "link".
- **AC-20** (FR-19) Diberikan cookie dari A dan pembeli checkout, maka pesanan tercatat atas A dengan sumber "link" dan parameter akuisisi dari klik.
- **AC-21** (FR-19) Diberikan cookie dari A dan pembeli adalah A sendiri, maka pesanan tanpa affiliate dan tanpa komisi.
- **AC-22** (FR-19) Diberikan Kaitkan affiliasi aktif, pembeli ber-upline B, dan cookie dari A, maka pesanan tercatat atas B dengan sumber "kaitan".
- **AC-23** (FR-18) Diberikan Kaitkan affiliasi aktif dan pembeli tanpa upline checkout dengan cookie A, maka upline pembeli menjadi A dengan sumber "checkout".
- **AC-24** (FR-19) Diberikan General cookie mati, cookie dari A untuk produk X, dan keranjang hanya berisi produk Y, maka pesanan tanpa affiliate.
- **AC-25** (FR-19) Diberikan cookie dari A yang aksesnya kemudian dicabut, maka pesanan tanpa affiliate.

### Komisi

- **AC-26** (FR-21) Diberikan komisi 10%, barang Rp 655.000 x1, diskon pesanan 0, ongkir Rp 15.000, pajak 0, maka komisi tier 1 Rp 65.500.
- **AC-27** (FR-21) Diberikan dua barang Rp 100.000 dan Rp 300.000 dengan diskon pesanan Rp 40.000 dan komisi 10%, maka komisi barang pertama Rp 9.000 dan kedua Rp 27.000.
- **AC-28** (FR-21) Diberikan komisi nilai tetap Rp 5.000 dan jumlah 3, maka komisi Rp 15.000.
- **AC-29** (FR-10, FR-21) Diberikan produk berkomisi khusus 5% sementara bawaan 10%, maka komisi barang itu 5%.
- **AC-30** (FR-22) Diberikan 2 tier (10%, 2%), C ber-upline B ber-upline A, dan pesanan lewat C senilai Rp 100.000, maka C mendapat Rp 10.000 tier 1 dan B Rp 2.000 tier 2, A tidak mendapat apa pun.
- **AC-31** (FR-22) Diberikan rantai upline berputar (A ke B ke A) dan 3 tier, maka tiap orang hanya menerima satu komisi.
- **AC-32** (FR-23) Diberikan komisi Order belum selesai, ketika staf mengonfirmasi pesanan, maka semua komisinya menjadi Belum dibayar dan email komisi masuk masuk antrean untuk tiap penerima.
- **AC-33** (FR-23) Diberikan komisi Belum dibayar, ketika admin membatalkan pesanan lewat aksi massal, maka komisinya Dibatalkan.
- **AC-34** (FR-24) Diberikan affiliate A dan B dengan komisi masing-masing, ketika A membuka halaman Komisi, maka hanya komisi A yang tampil dan totalnya sama dengan database.
- **AC-35** (FR-25) Diberikan admin memilih 2 komisi Belum dibayar dan memilih "Konfirmasi pembayaran komisi", maka keduanya Sudah dibayar. "Ubah status komisi ke Belum Dibayar" mengembalikannya.
- **AC-36** (FR-26, FR-27) Diberikan affiliate dengan Belum dibayar Rp 75.500, ketika admin membayar dengan bukti transfer dan centang pengeluaran, maka semua komisi itu Sudah dibayar, riwayat pembayaran Rp 75.500 tersimpan beserta buktinya, satu pengeluaran "Komisi Affiliate" Rp 75.500 muncul di Pengeluaran dan Laba Rugi, dan email komisi dibayar masuk antrean.
- **AC-37** (FR-26) Diberikan admin menekan Bayar dua kali dengan cepat, maka hanya satu pembayaran tersimpan.
- **AC-38** (FR-25) Diberikan komisi Sudah dibayar lalu pesanannya dibatalkan, maka komisi tampil di filter "Perlu ditindaklanjuti".

### Referral dan undangan

- **AC-39** (FR-29) Diberikan A ber-downline B dan B ber-downline C, dengan kedalaman 1, maka A melihat B saja. Dengan kedalaman 2, A melihat B dan C di bawah B.
- **AC-40** (FR-29) Diberikan pengaturan kontak downline mati, maka respons data jaringan tidak memuat email atau telepon downline.
- **AC-41** (FR-30) Diberikan admin mencoba menjadikan C upline A padahal C downline A, maka tampil "Upline tidak boleh dirinya sendiri atau downline-nya." dan upline tidak berubah.
- **AC-42** (FR-31, FR-33) Diberikan affiliate mengundang email baru, maka undangan berstatus Terkirim, email berisi tautan bertoken masuk antrean, dan database tidak menyimpan token asli.
- **AC-43** (FR-32) Diberikan email yang sudah terdaftar sebagai member, maka tampil "Email ini sudah terdaftar sebagai member."
- **AC-44** (FR-32) Diberikan batas harian 20 dan affiliate sudah mengirim 20 hari ini, maka undangan ke-21 ditolak dengan pesan batas.
- **AC-45** (FR-34, FR-35) Diberikan undangan sah, ketika penerima membukanya dan mendaftar, maka status Dibuka lalu Terdaftar, upline akun baru adalah pengundang dengan sumber "undangan", dan klik jenis undangan tercatat.
- **AC-46** (FR-34) Diberikan undangan lewat masa berlaku, ketika dibuka, maka tampil "Undangan ini sudah kedaluwarsa..." dan tidak ada cookie.

### Analytics

- **AC-47** (FR-37) Diberikan data uji yang diketahui (3 klik, 2 pesanan, 1 selesai Rp 100.000 nilai barang, komisi 10%), maka ringkasan affiliate menampilkan Klik 3, Lead 2, Sales 1, Omset Rp 100.000, Komisi Rp 10.000, dan sama dengan hasil query database.
- **AC-48** (FR-39) Diberikan 2 klik berparameter fb/story-okt dan 1 tanpa parameter, maka tabel akuisisi menampilkan baris Facebook story-okt View 2 dan baris Langsung View 1.
- **AC-49** (FR-40) Diberikan kontak pembeli mati, maka daftar order affiliate dan responsnya tidak memuat telepon dan email pembeli.
- **AC-50** (FR-41) Diberikan rentang tanggal, maka ringkasan admin sama dengan hasil query database untuk rentang itu.

### Email

- **AC-51** (FR-42, FR-46) Diberikan pesanan atas affiliate beralamat email asli, maka satu email "Order #{nomor} {produk} baru dari {pembeli}" terkirim. Bila Mailketing menolak, pesanan tetap tersimpan dan antrean mencoba ulang paling banyak 3 kali.
- **AC-52** (FR-46) Diberikan alamat berakhiran `contoh.id` atau domain uji lain, maka email tidak dikirim dan antrean menandainya dilewati.

### Tambahan dari tahap pembangunan

- **AC-53** (FR-19, D-19) Diberikan General cookie mati dan cookie dari A untuk varian X1, ketika pembeli membeli varian X2 dari produk yang sama, maka pesanan tercatat atas A. Produk lain yang bukan variannya tetap tanpa affiliate.
- **AC-54** (FR-15, D-19) Diberikan produk bersyarat "jika sudah membeli" dan affiliate pernah membeli varian lain produk itu, ketika linknya dibuka, maka link diterima.
- **AC-55** (FR-4, D-20) Diberikan umur cookie 30, maka cookie yang klik terakhirnya 29 hari lalu masih menghasilkan affiliate dan yang 31 hari lalu tidak. Dengan umur cookie 0, cookie berumur 400 hari tetap berlaku.
- **AC-56** (FR-15, D-21) Diberikan 40 klik produk berparameter terpanjang, maka cookie menyimpan 12 produk terakhir dan ukurannya di bawah 4.096 byte.
- **AC-57** (FR-20, D-22) Diberikan klik A berparameter lalu klik B tanpa parameter, maka pesanan atas B tidak membawa parameter A.
- **AC-58** (FR-23, D-23) Diberikan pesanan yang komisinya sudah dibayar, ketika admin menghapusnya lewat aksi massal, maka penghapusan ditolak dengan pesan yang menyebut nomor pesanan dan tidak ada yang terhapus. Setelah pembayaran komisinya dibatalkan, pesanan itu bisa dihapus.
- **AC-59** (FR-31, D-25) Diberikan nama atau pesan undangan memuat alamat web, maka undangan ditolak dengan "Nama dan pesan undangan tidak boleh memuat tautan." dan tidak tersimpan. Pesan biasa berisi titik, koma, dan harga tetap diterima.
- **AC-60** (FR-33, D-24) Diberikan undangan dikirim, maka tautan di emailnya berawalan alamat toko dari konfigurasi server.
- **AC-61** (FR-36) Diberikan undangan untuk email yang kemudian menjadi member lewat jalan lain, ketika pengundang menekan Kirim ulang, maka ditolak dengan "Email ini sudah terdaftar sebagai member."
- **AC-62** (FR-48, D-26) Diberikan admin mengisi kode `UNDANGAN`, maka ditolak dan kode lama tetap.
- **AC-63** (FR-10) Diberikan admin mengisi komisi khusus dan syarat sudah membeli di formulir produk lalu menyimpan, ketika formulir dibuka lagi, maka nilainya sama. Persen di luar 0 sampai 100 ditolak dan tidak tersimpan.
- **AC-64** (FR-42, FR-44) Diberikan dashboard affiliate dibuka dengan sesi yang sudah tidak berlaku lewat tautan ke tab tertentu, maka pengguna dibawa ke halaman masuk dan setelah masuk tiba di tab itu.
- **AC-65** (NFR-7) Diberikan lebar layar 360, 393, 768, 1024, dan 1280 px dengan nama 118 huruf, maka tidak ada layar affiliate atau admin yang bergeser ke samping, tidak ada tabel yang terpotong di wadahnya, dan tab aktif terlihat di bilah menu.
- **AC-66** (FR-15, D-28) Diberikan pengunjung yang pernah membuka toko sebelum rilis affiliate (service worker versi lama masih terpasang), ketika ia membuka link affiliate untuk pertama kali setelah deploy, maka ia tiba di halaman produk yang dibagikan, cookie terpasang, dan tepat satu klik tercatat. Hal yang sama berlaku untuk `/toko/affiliate` dan `/affiliate`. Bila server masih menyajikan index.html versi lama, pemuatan ulang terjadi satu kali saja.
- **AC-67** (FR-15, FR-34, D-29) Diberikan server menjawab 429, 5xx, atau tidak bisa dihubungi, ketika pengunjung membuka link affiliate atau undangan, maka ia tetap diantar ke halaman produk, toko, atau formulir daftar tanpa layar galat. Jaringan putus sesaat dicoba ulang satu kali dan klik tercatat tepat sekali. Link yang memang salah tetap menampilkan pesan Sejoli.
- **AC-68** (FR-32, D-30) Diberikan tiga permintaan kirim undangan untuk email yang sama datang bersamaan, maka satu undangan tersimpan dan sisanya ditolak 409.
- **AC-69** (FR-6, FR-48) Diberikan member dengan tiga tingkat upline, ketika admin membuka jaringannya dengan kedalaman upline 1, maka hanya upline langsung yang tampil, dan dengan kedalaman 2 dua tingkat. Downline di tampilan itu mengikuti kedalaman downline.

## 10. Kebutuhan non-fungsional

| Kode | Kebutuhan |
|---|---|
| NFR-1 | Dari membuka link affiliate sampai halaman tujuan tampil: LCP paling lama 2,5 detik di HP kelas menengah dengan jaringan 4G. |
| NFR-2 | API dashboard affiliate dan ringkasan admin: p95 paling lama 500 ms dengan 10.000 pesanan dan 50.000 klik. |
| NFR-3 | Isolasi data: setiap endpoint affiliate hanya mengembalikan data milik affiliate yang masuk. Diuji dengan dua akun affiliate, permintaan data milik orang lain mendapat 404. |
| NFR-4 | Cookie affiliate ditandatangani HMAC-SHA256 dengan rahasia server, `HttpOnly`, `SameSite=Lax`, `Secure` di HTTPS. |
| NFR-5 | Token undangan 256 bit acak, disimpan sebagai sidik SHA-256. |
| NFR-6 | Pembatas laju: pembukaan link dan undangan 60 per menit per IP, pengiriman undangan sesuai batas harian. |
| NFR-7 | Layar affiliate dan admin tanpa gulir horizontal di 393 px dan 1440 px. Target sentuh di HP minimal 44 px. Daftar admin tampil sebagai kartu di bawah 1.280 px, karena wadah isi admin lebih sempit dari tabelnya (718 px pada layar 1.024 px). |
| NFR-8 | Kontras teks minimal 4,5:1, setiap kolom isian punya label, fokus keyboard terlihat. |
| NFR-9 | Angka di layar sama dengan hasil query database (diuji di AC-34, AC-47, AC-50). |
| NFR-10 | Perubahan akses, kode, upline, dan pembayaran tercatat di log audit admin. |
| NFR-11 | Pengiriman email gagal tidak menggagalkan pesanan, pendaftaran, atau pembayaran. |

## 11. Isi dan nada

- Bahasa Indonesia. Affiliate disapa "kamu" seperti halaman toko yang ada. Label yang berasal dari Sejoli memakai ejaan Sejoli ("Affiliasi", "Komisi potensial").
- Rupiah: `Rp 1.234.567`. Tanggal: `06 Okt 2026, 16.41` WIB.
- Teks email memakai teks bawaan Sejoli:
  - Pesanan baru. Judul "Order #{nomor} {produk} baru dari {pembeli}". Isi "Alhamdulillah {affiliate}", "Kamu baru saja mendapatkan order sebagai berikut dari {pembeli}", rincian pesanan, "Pantau terus ya, jika perlu follow-up terus {pembeli} sampai deal ya."
  - Komisi masuk. Judul "{affiliate}, Komisi untuk anda dari order #{nomor} {produk}". Isi "Alhamdulillah, kamu baru saja mendapatkan komisi pesanan #{nomor} dari {pembeli}. Informasi detailnya sebagai berikut", rincian, "Teman-teman bisa cek list komisi disini ya {tautan dashboard}".
  - Komisi dibayar. Judul "{affiliate}, Komisi untuk anda sudah dibayarkan". Isi "Alhamdulillah {affiliate}, komisi sebesar {Rp} sudah kami cairkan ya. Silahkan cek rekening banknya ya."
  - Undangan (baru). Judul "{affiliate} mengundang kamu ke {toko}". Isi sapaan, pesan pribadi bila ada, tombol "Terima undangan", masa berlaku.

## 12. Rencana rilis

Dua irisan, lihat [03 Peta cerita](03-story-map.md). Irisan 2 dibangun setelah irisan 1 lolos rencana uji. Keduanya dikerjakan dalam satu putaran pengerjaan.

## 13. Log keputusan dan pertanyaan

### Keputusan

| Kode | Keputusan | Alasan | Tanggal | Status |
|---|---|---|---|---|
| D-1 | Affiliate adalah akun member (pembeli) yang sudah ada | Sejoli juga memakai akun member, dan checkout toko sudah wajib akun | 11 Okt 2026 | Usulan |
| D-2 | User group Sejoli diganti akses per member (Ikut pengaturan, Diizinkan, Diblokir) | Toko tidak punya user group, dan butir 8.1 meminta "member tertentu" | 11 Okt 2026 | Usulan |
| D-3 | Link memakai kode pendek dan ada link seluruh toko | ID produk dan member berupa UUID panjang, toko fisik berisi 305 produk | 11 Okt 2026 | Usulan |
| D-4 | Umur cookie 0 berarti selamanya (10 tahun), bawaan 30 | Mengikuti teks bantuan Sejoli. Kode Sejoli diam-diam memakai 30 hari, yang bertentangan dengan teksnya | 11 Okt 2026 | Usulan |
| D-5 | Komisi bawaan toko ditambah komisi khusus per produk | Mengatur 305 produk satu per satu tidak masuk akal, perilaku per produk Sejoli tetap ada | 11 Okt 2026 | Usulan |
| D-6 | Komisi per barang, dasar = nilai barang setelah bagian diskon, tanpa ongkir dan pajak, dibulatkan ke bawah | Pesanan Sejoli satu produk, pesanan kita banyak barang. Sejoli mengurangi ongkir dan PPN dari dasar komisi | 11 Okt 2026 | Usulan |
| D-7 | Menunggu konfirmasi dan Pending = Order belum selesai, Selesai = Belum dibayar, Dibatalkan = Dibatalkan | Padanan status pesanan Sejoli di status pesanan kita | 11 Okt 2026 | Usulan |
| D-8 | Pembayaran disimpan sebagai riwayat dan bisa dicatat sebagai pengeluaran "Komisi Affiliate" | Komisi adalah biaya, Laba Rugi harus memuatnya | 11 Okt 2026 | Usulan |
| D-9 | Kontak pembeli dan downline disembunyikan secara bawaan | Kebijakan privasi toko belum menyebut affiliate sebagai penerima data. Sejoli menyalakannya secara bawaan | 11 Okt 2026 | Usulan, Q-4 |
| D-10 | Klik = kunjungan lewat link atau undangan selain oleh affiliate itu sendiri. Lead = pesanan atas nama affiliate yang tidak batal. Sales = pesanan Selesai. Omset = nilai barang pesanan Selesai tanpa ongkir dan pajak. Komisi = komisi berstatus Belum dibayar dan Sudah dibayar | Sejoli tidak konsisten soal lead batal antara angka harian dan sepanjang waktu, dan menghitung omset dengan ongkir. Laba Rugi toko memakai nilai tanpa ongkir dan pajak | 11 Okt 2026 | Usulan |
| D-11 | Undangan email dibangun baru, membukanya sama dengan klik link | Tidak ada di Sejoli versi mana pun yang diperiksa | 11 Okt 2026 | Usulan |
| D-12 | Komisi hanya untuk pesanan toko online | Atribusi memakai cookie browser, yang tidak ada di POS dan marketplace | 11 Okt 2026 | Usulan |
| D-13 | Kode dibuat otomatis dan hanya admin yang dapat mengubahnya | Mengganti kode memutus link yang sudah tersebar | 11 Okt 2026 | Usulan |
| D-14 | Dashboard affiliate di toko online (`/toko/affiliate`), admin di menu Affiliate | Member area Sejoli sama dengan area akun pembeli toko | 11 Okt 2026 | Usulan |
| D-15 | Email lewat antrean yang dikirim pekerja server | Perubahan status pesanan terjadi lewat banyak jalur, antrean memastikan setiap jalur memicu email yang sama | 11 Okt 2026 | Usulan |
| D-16 | Maksimal 5 tier | Sejoli tidak membatasi, tetapi lebih dari 5 tidak lazim dan menyulitkan pengujian | 11 Okt 2026 | Usulan |
| D-17 | Penerima tier tanpa akses dilewati | Member yang diblokir tidak semestinya tetap menerima komisi | 11 Okt 2026 | Usulan |
| D-18 | Platform TikTok ditambahkan ke daftar bawaan | Toko berjualan di TikTok Shop | 11 Okt 2026 | Usulan |
| D-19 | Aturan per produk berlaku per kelompok varian (SKU Induk, atau nama produk bila SKU Induk kosong): link untuk satu varian berlaku untuk semua varian produk itu, dan syarat "sudah membeli" terpenuhi oleh varian mana pun | Di Sejoli satu produk mencakup semua variannya. Di toko ini tiap varian adalah baris produk sendiri, sehingga tanpa aturan ini pembeli yang mengeklik link varian A lalu membeli varian B tidak tercatat | 11 Okt 2026 | Dibangun |
| D-20 | Umur cookie ditegakkan server juga, dari waktu klik terakhir yang tersimpan di dalam cookie | Pengaturan Umur cookie berlaku seketika saat diubah admin, dan nilai cookie lama tidak bisa dipakai ulang | 11 Okt 2026 | Dibangun |
| D-21 | Cookie menyimpan paling banyak 12 produk terakhir. Parameter akuisisi: kode platform maks 20 karakter, ID maks 40 karakter | Browser membuang cookie di atas 4.096 byte tanpa pesan. Terukur 9.251 byte dengan 30 produk berparameter panjang, 3,3 KB dengan batas baru | 11 Okt 2026 | Dibangun |
| D-22 | Parameter akuisisi mengikuti kliknya: klik tanpa parameter menghapus parameter klik sebelumnya | Parameter milik affiliate A tidak boleh menempel ke pesanan affiliate B | 11 Okt 2026 | Dibangun |
| D-23 | Pesanan yang komisinya sudah dibayar tidak bisa dihapus, hanya dibatalkan. Pesanan yang komisinya belum dibayar bisa dihapus dan komisinya ikut hilang | Komisi yang sudah dibayar adalah catatan uang keluar. Menghapusnya membuat riwayat pembayaran tidak cocok lagi dengan komisinya | 11 Okt 2026 | Dibangun |
| D-24 | Tautan di email undangan memakai alamat toko dari konfigurasi server (`PUBLIC_STORE_URL`) | Alamat dari header permintaan bisa diisi pengirim, sehingga email resmi toko membawa tautan ke domain lain | 11 Okt 2026 | Dibangun |
| D-25 | Nama dan pesan pribadi undangan tidak boleh memuat tautan atau alamat web | Undangan dikirim dari email resmi toko ke alamat mana pun. Tanpa aturan ini fitur undangan bisa dipakai menitipkan tautan | 11 Okt 2026 | Dibangun |
| D-26 | Kode `UNDANGAN` tidak bisa dipakai sebagai kode affiliate | Bertabrakan dengan alamat undangan `/aff/undangan/{token}` | 11 Okt 2026 | Dibangun |
| D-27 | Daftar komisi dan order di dashboard affiliate menampilkan 500 komisi dan 200 order terbaru. Daftar komisi dan member admin 500 baris. Saat batas tercapai layar menyebutkannya | Daftar tanpa batas memberatkan HP. Angka ringkasan tetap menghitung semua baris | 11 Okt 2026 | Dibangun |
| D-28 | Cangkang lama diselamatkan lewat `public/kasir-config.js`. Untuk alamat yang baru ada sejak rilis affiliate (`/aff/...`, `/toko/affiliate`, `/affiliate`), service worker lama dilepas lalu alamat yang sama dimuat ulang dari server, satu kali per alamat. index.html baru membawa penanda `data-cangkang="2"` | Service worker menyajikan index.html versi lama pada kunjungan pertama setelah deploy, dan aplikasi lama melempar alamat yang tidak dikenalnya ke `/toko`. Terukur sebelum perbaikan: 0 klik, tanpa cookie, pengunjung tiba di beranda toko | 11 Okt 2026 | Dibangun |
| D-29 | Gangguan saat membuka link (jaringan putus, galat server, batas laju) tidak menahan pengunjung. Jaringan putus dan galat server dicoba ulang satu kali, lalu pengunjung diantar ke produk, toko, atau formulir daftar. Klik yang gagal tidak tercatat. Pesan Sejoli hanya untuk link yang memang salah | Halaman pembuka link ada untuk mengantar pengunjung ke produk. Layar galat karena gangguan sementara menghilangkan penjualan, bukan hanya klik | 11 Okt 2026 | Dibangun |
| D-30 | Pengiriman undangan dan kirim ulang diproses satu per satu per affiliate (kunci di basis data) | Dua permintaan bersamaan sama-sama lolos cek undangan ganda dan batas harian, sehingga penerima mendapat dua email. Terukur sebelum perbaikan: 2 undangan tersimpan dari 3 permintaan bersamaan | 11 Okt 2026 | Dibangun |

### Pertanyaan untuk klien dan user

| Kode | Pertanyaan | Usulan jawaban |
|---|---|---|
| Q-1 | Berapa komisi bawaan dan berapa tier? | Tier 1 = 10% dari nilai barang, tanpa tier 2. Bisa diubah admin kapan saja |
| Q-2 | Semua member atau hanya member yang diizinkan admin? | Hanya yang diizinkan, sesuai butir 8.1 |
| Q-3 | Umur cookie dan Kaitkan affiliasi? | 30 hari, Kaitkan affiliasi mati |
| Q-4 | Boleh affiliate melihat kontak pembeli dan downline? | Tidak, sampai kebijakan privasi toko diperbarui |
| Q-5 | Kapan dan bagaimana komisi dibayar? | Manual kapan saja, tanpa minimum, dicatat sebagai pengeluaran |
| Q-6 | Masa berlaku undangan dan batas harian? | 7 hari, 20 undangan per hari |
| Q-7 | Retur sebagian mengubah komisi? | Tidak, mengikuti Sejoli. Pembatalan pesanan tetap membatalkan komisi |
| Q-8 | Toko di Vercel tetap hidup? | Tidak. Affiliate hanya di VPS, Vercel dimatikan setelah data terakhir disalin |
| Q-9 | Ada target angka untuk OB-1? | Belum di versi ini |

## 14. Perubahan dari jawaban klien (13 Okt 2026)

Klien menjawab Q-1, Q-2, Q-4, Q-5, Q-6, Q-7, dan Q-9. Empat kalimat jawaban bisa dibaca dua arah. Tafsirnya dipilih user pada 13 Okt 2026 (kolom "Tafsir" di bawah). Keputusan lama yang berubah tidak disunting; keputusan baru menggantikannya.

| Kode | Jawaban klien | Tafsir yang dipilih user |
|---|---|---|
| Q-1 | "boleh bisa 3 tingkat 5% / 10 / 15 bisa juga disetting manual undang affiliator tujuan" | Level per affiliate: tiap affiliate mendapat satu tarif 5%, 10%, atau 15%, atau tarif manual, diatur admin saat mengundang atau mengubah member. Hanya affiliate yang membawa penjualan yang mendapat komisi |
| Q-2 | "hanya di izinkan (fitur aktifkan bagi yang memiliki undangan khusus) tidak di publik" | Hanya admin yang membuka akses: mengizinkan member, atau mengirim undangan khusus. Undangan dari affiliate ke temannya hanya membentuk jaringan |
| Q-4 | "(tidak) fitur ini hanya diakses oleh seller / gnnkracing" | Kontak pembeli dan downline tidak pernah terlihat affiliate |
| Q-5 | "saldo minimal bisa disetting manual saja jadi menentukan case pada saat running" | Minimal pencairan diatur admin. Admin tetap bisa membayar di bawah minimal setelah mengonfirmasi |
| Q-6 | "undangan affiliasi berlaku 7 hari / undangan bebas" | 7 hari, tanpa batas harian |
| Q-7 | "ya pasti akan memotong" | Retur memotong komisi. Komisi yang sudah ditransfer dipotong dari pembayaran berikutnya |
| Q-9 | "ada, target penjualan 5jt sbulan dpt tambahan komisi (atau fitur ini bisa setting manual)" | Bonus target bulanan: target dan besar bonus (persen omset atau rupiah) diatur admin |

### Keputusan baru

| Kode | Keputusan | Alasan | Menggantikan | Tanggal | Status |
|---|---|---|---|---|---|
| D-31 | Tiap affiliate punya satu tarif komisi: ikut bawaan toko, 5%, 10%, 15%, atau manual (persen, atau rupiah per barang). Urutan sumber tarif per barang: komisi khusus produk, lalu tarif affiliate, lalu komisi bawaan toko. Komisi bawaan toko tetap satu tier, jadi upline tidak mendapat komisi kecuali admin menambah tier | Q-1. Komisi khusus produk didahulukan supaya produk bermargin tipis tetap terlindungi | D-5 (urutan sumber tarif) | 13 Okt 2026 | Dibangun |
| D-32 | Akses affiliate hanya dari admin: mengizinkan member, atau undangan khusus dari admin. Penerima undangan khusus yang mendaftar langsung Diizinkan dengan tarif dari undangan, tanpa upline. Undangan dari affiliate tetap hanya membentuk jaringan | Q-2 "tidak di publik" | D-11 (sebagian) | 13 Okt 2026 | Dibangun |
| D-33 | Kontak pembeli dan downline tidak pernah dikirim ke affiliate. Dua saklar kontak dihapus dari Pengaturan. Admin tetap melihat kontak di Pesanan dan Pelanggan | Q-4 | D-9 | 13 Okt 2026 | Dibangun |
| D-34 | Minimal pencairan per affiliate (rupiah, 0 = tanpa minimal). Di bawah minimal, admin tetap bisa membayar setelah mengonfirmasi | Q-5 "menentukan case pada saat running" | FR-26 (bagian pembayaran) | 13 Okt 2026 | Dibangun |
| D-35 | Batas undangan harian 0 berarti tanpa batas, dan menjadi bawaan. Batas 10 undangan per menit per affiliate tetap (NFR-6) | Q-6. Batas per menit mencegah fitur undangan dipakai mengirim email massal | Bawaan `invite_daily_limit` 20 | 13 Okt 2026 | Dibangun |
| D-36 | Retur memotong komisi barang yang diretur sebanding jumlahnya: komisi baru = komisi awal x (1 - r), dibulatkan ke bawah, r = jumlah produk itu yang diretur dibagi jumlah produk itu di pesanan (paling besar 1). Komisi yang belum dibayar langsung berubah. Komisi yang sudah dibayar tidak berubah; selisihnya menjadi potongan yang dipotong otomatis dari pembayaran berikutnya | Q-7 | Q-7 usulan, spesifikasi 0001 "Retur sebagian tidak mengurangi komisi" | 13 Okt 2026 | Dibangun |
| D-37 | Komisi yang sudah dibayar lalu pesanannya dibatalkan menjadi potongan sebesar komisinya. Bila pesanan kembali Selesai sebelum potongan terpakai, potongan dihapus | Satu aturan untuk uang yang sudah keluar, sama dengan D-36 | AC-38 (hanya ditandai) | 13 Okt 2026 | Dibangun |
| D-38 | Bonus target bulanan: saklar, target omset (bawaan Rp 5.000.000), bonus berupa persen dari omset bulan itu atau rupiah tetap. Dihitung per affiliate per bulan kalender WIB dari pesanan yang dibuat di bulan itu, berstatus Selesai, dan dibawa affiliate itu langsung. Selama bulan berjalan bonus berstatus Berjalan dan bisa hilang bila omset turun. Setelah bulan berakhir dan target tetap tercapai, bonus menjadi Belum dibayar. Bonus yang sudah dibayar tidak dihitung ulang | Q-9 | Q-9 usulan | 13 Okt 2026 | Dibangun |
| D-39 | Omset di semua layar (ringkasan affiliate, grafik, data akuisisi, ringkasan admin, bonus) = nilai barang pesanan Selesai dikurangi nilai retur pesanan itu | Tanpa ini omset berbeda dengan komisi yang sudah dipotong retur | D-10 (definisi omset) | 13 Okt 2026 | Dibangun |
| D-40 | Satu pembayaran = komisi Belum dibayar + bonus Belum dibayar - potongan yang belum terpakai. Pembayaran ditolak bila hasilnya 0 atau kurang; potongan menunggu komisi berikutnya. Pembayaran menyimpan rinciannya. Konfirmasi massal (centang komisi) tidak memakai bonus dan potongan | Potongan otomatis butuh satu tempat yang menjumlahkannya | FR-26 | 13 Okt 2026 | Dibangun |

### Asumsi yang belum dijawab klien

| Kode | Asumsi | Pemilik | Bila salah |
|---|---|---|---|
| AS-1 | Q-3: umur cookie 30 hari, Kaitkan affiliasi mati | Klien | Satu pengaturan diubah admin |
| AS-2 | Q-8: toko Vercel belum diputuskan, push ke GitHub ditahan | Klien | Push menunggu, atau migrasi 044-047 diterapkan di Supabase |
| AS-3 | Pilihan cepat tarif 5%, 10%, 15% tetap di layar, tarif lain lewat isian manual | User | Mengubah tiga angka di layar |
| AS-4 | Bulan bonus mengikuti tanggal pesanan dibuat, bukan tanggal selesai | User | Mengubah satu kolom tanggal di perhitungan bonus |

### Kebutuhan fungsional tambahan

| Kode | Kebutuhan | Sumber |
|---|---|---|
| FR-49 | Dialog Ubah affiliate punya isian Tarif komisi: Ikut komisi bawaan, 5%, 10%, 15%, atau Manual (persen 0 sampai 100, atau rupiah per barang 0 sampai 100.000.000) | D-31 |
| FR-50 | Komisi per barang memakai tarif dengan urutan D-31 | D-31 |
| FR-51 | Admin tab Affiliate punya Undang affiliate: email (wajib), nama, pesan, tarif komisi (seperti FR-49). Ditolak bila email tidak sah, sudah member, atau sudah diundang admin kurang dari 24 jam lalu. Daftar undangan admin menampilkan email, tarif, tanggal, status, dan Kirim ulang | D-32 |
| FR-52 | Pendaftaran lewat undangan admin (membuka tautannya, atau mendaftar dengan email yang sama selama undangan berlaku, termasuk lewat Google) membuat akses Diizinkan dan tarif dari undangan, status undangan Terdaftar | D-32 |
| FR-53 | Endpoint affiliate tidak pernah mengirim nomor HP atau email pembeli dan downline | D-33 |
| FR-54 | Pengaturan punya Minimal pencairan. Tab Pembayaran menandai affiliate yang di bawah minimal, dan tombol Bayar untuknya meminta konfirmasi. Tab Komisi affiliate menyebut minimal pencairan | D-34 |
| FR-55 | Batas undangan per hari 0 sampai 200, 0 = tanpa batas. Penghitung undangan menulis "tanpa batas harian" | D-35 |
| FR-56 | Mencatat retur menghitung ulang komisi barang yang diretur sesuai D-36, dari jalur mana pun retur ditulis | D-36 |
| FR-57 | Pembatalan pesanan yang komisinya sudah dibayar membuat potongan sesuai D-37 | D-37 |
| FR-58 | Bonus target dihitung ulang paling lambat 1 menit setelah pesanan atau retur berubah, untuk bulan berjalan dan bulan lalu | D-38 |
| FR-59 | Dialog Bayar dan riwayat pembayaran menampilkan komisi, bonus, potongan, dan jumlah yang ditransfer. Pengeluaran Komisi Affiliate sebesar jumlah yang ditransfer | D-40 |
| FR-60 | Ringkasan affiliate menampilkan kartu target bila bonus aktif: omset bulan ini, target, sisa, dan bonus yang akan didapat. Tab Komisi menampilkan baris bonus dan potongan | D-38, D-36 |
| FR-61 | Omset dihitung sesuai D-39 | D-39 |

### Kamus data tambahan

| Tempat | Kolom | Tipe dan batas | Bawaan |
|---|---|---|---|
| Pengaturan toko | payout_minimum | rupiah 0 sampai 100.000.000, 0 = tanpa minimal | 0 |
| Pengaturan toko | bonus_enabled | ya/tidak | tidak |
| Pengaturan toko | bonus_target | rupiah 1 sampai 10.000.000.000 | 5.000.000 |
| Pengaturan toko | bonus_type, bonus_value | `percentage` 0 sampai 100, atau `fixed` 0 sampai 100.000.000 | `percentage`, 0 |
| Pengaturan toko | invite_daily_limit | 0 sampai 200, 0 = tanpa batas | 0 |
| Pengaturan toko | show_buyer_contact, show_downline_contact | dihapus, selalu tidak | |
| Member | affiliate_commission | daftar 1 tier seperti komisi produk, kosong = ikut bawaan | kosong |
| Undangan | dari_admin, commission | undangan admin: tanpa pengirim affiliate, tarif opsional | tidak, kosong |
| Komisi | commission_awal | komisi sebelum dipotong retur | sama dengan komisi |
| Potongan (baru) | affiliate, komisi, jenis (`retur` atau `batal`), jumlah, pembayaran yang memakainya | jumlah lebih dari 0 | |
| Bonus (baru) | affiliate, bulan, omset, target, tarif, jumlah, status (`berjalan`, `added`), dibayar, pembayaran | satu baris per affiliate per bulan | |
| Pembayaran | commission_total, bonus_total, deduction_total | rincian; `amount` = yang ditransfer | 0 |

### Pesan baru

| Saat | Pesan |
|---|---|
| Admin mengundang email yang sudah member | Email ini sudah terdaftar sebagai member. Ubah aksesnya di daftar Affiliate. |
| Admin mengundang email yang sudah diundang admin kurang dari 24 jam | Email ini sudah diundang dalam 24 jam terakhir. |
| Bayar ditolak karena potongan | Saldo komisi masih tertutup potongan Rp {jumlah}. Potongan dipotong dari pembayaran berikutnya. |
| Bayar di bawah minimal tanpa konfirmasi | Komisi belum mencapai minimal pencairan Rp {minimal}. |
| Email undangan khusus | Judul: "{toko} mengundang kamu menjadi affiliate". Isi menyebut tarif komisi bila diisi |

### Kriteria penerimaan tambahan

- **AC-70** (FR-49, FR-50) Diberikan affiliate bertarif 15%, ketika pembeli membeli produk tanpa komisi khusus lewat link-nya, maka komisinya 15% dari nilai barang. Produk dengan komisi khusus Rp 5.000 tetap Rp 5.000 per barang. Affiliate tanpa tarif memakai komisi bawaan toko.
- **AC-71** (FR-51, FR-52) Diberikan admin mengundang email baru dengan tarif 10%, ketika penerima membuka tautan dan mendaftar, maka aksesnya Diizinkan, tarifnya 10%, tanpa upline, dan undangan berstatus Terdaftar.
- **AC-72** (FR-52) Diberikan undangan admin yang masih berlaku, ketika penerima mendaftar dengan email itu tanpa membuka tautan, maka hasilnya sama dengan AC-71.
- **AC-73** (D-32) Diberikan affiliate mengundang temannya, ketika teman itu mendaftar, maka upline-nya affiliate itu dan aksesnya tetap Ikut pengaturan, sehingga dashboard affiliate menolaknya.
- **AC-74** (FR-53) Diberikan pengaturan tersimpan yang masih berisi `show_buyer_contact: true`, maka daftar order dan jaringan affiliate tetap tidak memuat nomor HP atau email.
- **AC-75** (FR-54) Diberikan minimal pencairan Rp 100.000 dan komisi Belum dibayar Rp 60.000, maka tab Pembayaran menandainya di bawah minimal, Bayar tanpa konfirmasi ditolak dengan pesan minimal, dan dengan konfirmasi berhasil.
- **AC-76** (FR-55) Diberikan batas harian 0, maka undangan ke-21 di hari yang sama diterima dan penghitung menulis "tanpa batas harian".
- **AC-77** (FR-56) Diberikan komisi Rp 20.000 Belum dibayar untuk 2 barang, ketika 1 barang diretur, maka komisinya Rp 10.000. Ketika barang kedua diretur, komisinya Rp 0 dan tertulis Dipotong retur.
- **AC-78** (FR-56, FR-59) Diberikan komisi Rp 20.000 untuk 2 barang sudah dibayar, ketika 1 barang diretur, maka muncul potongan Rp 10.000. Pembayaran berikutnya dengan komisi Belum dibayar Rp 50.000 mentransfer Rp 40.000, mencatat pengeluaran Rp 40.000, dan potongannya terpakai.
- **AC-79** (FR-57) Diberikan komisi sudah dibayar, ketika pesanannya dibatalkan, maka muncul potongan sebesar komisinya. Ketika pesanan kembali Selesai sebelum potongan terpakai, potongannya hilang.
- **AC-80** (D-40) Diberikan komisi Belum dibayar Rp 5.000 dan potongan Rp 10.000, maka Bayar ditolak dengan pesan potongan dan tidak ada yang berubah.
- **AC-81** (FR-58, FR-60) Diberikan bonus aktif, target Rp 5.000.000, bonus 2%, ketika pesanan Selesai affiliate bulan ini berjumlah Rp 5.200.000, maka muncul bonus Berjalan Rp 104.000 dan kartu target di ringkasan. Ketika retur menurunkan omset ke Rp 4.900.000, bonus itu hilang.
- **AC-82** (D-38, D-40) Diberikan bonus bulan lalu yang targetnya tercapai, maka statusnya Belum dibayar dan ikut di pembayaran berikutnya. Setelah dibayar, perubahan pesanan bulan itu tidak mengubahnya.
- **AC-83** (FR-61) Diberikan pesanan Selesai Rp 1.000.000 dengan retur Rp 200.000, maka omset di ringkasan affiliate dan admin Rp 800.000.
- **AC-84** (D-40) Diberikan pembayaran yang memakai potongan dan bonus, ketika admin membatalkan seluruh pembayaran itu, maka potongan kembali menunggu dan bonus kembali Belum dibayar.

### Pertanyaan yang masih terbuka

| Kode | Pertanyaan | Dipakai sementara |
|---|---|---|
| Q-3 | Umur cookie dan Kaitkan affiliasi? | AS-1 |
| Q-8 | Toko di Vercel tetap hidup? | AS-2 |
