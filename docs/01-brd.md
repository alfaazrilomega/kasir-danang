# 01 BRD: Program Affiliate GNNK Racing

Produk: Toko online GNNK Racing (store.gnnkracing.id) · Versi 0.1 · 11 Okt 2026 · Status: draft, menunggu persetujuan · Dokumen terkait: [02 PRD](02-prd.md), [03 Peta cerita](03-story-map.md), [Referensi Sejoli](sejoli-referensi.md)

## 1. Ringkasan

- **Masalah:** toko online belum punya cara membayar orang yang membawa pembeli. Klien meminta fitur affiliate yang "disamakan dengan Sejoli".
- **Usulan:** program affiliate di dalam toko online sendiri, mengikuti perilaku Sejoli 1.14.7 untuk enam bagian yang dipilih leader klien: analytics, kode/link affiliate dan dashboard affiliate, komisi, referral, undangan email bertoken, dan pengaturan affiliate (termasuk umur cookie).
- **Hasil yang diharapkan:** member bisa membagikan link, pembelian lewat link tercatat atas nama mereka, komisi terhitung otomatis mengikuti status pesanan, dan admin membayar komisi dari satu layar.
- **Sumber kebenaran perilaku:** kode Sejoli 1.14.7 berlisensi GPL v2 yang terbuka di GitHub, dibaca langsung. Akses ke akun Sejoli klien tidak dibutuhkan.

## 2. Keadaan sekarang

- Pembeli wajib punya akun untuk checkout (keputusan klien sebelumnya). Data per 6 Okt 2026: 86 pelanggan, 618 pesanan, 305 produk.
- Belum ada pencatatan siapa yang membawa pembeli, belum ada komisi, belum ada pembayaran komisi. Butir 8.1 di spreadsheet klien ("member tertentu mau jualan bisa dapat komisi") ditunda sampai tugas ini.
- Pesanan dari toko online masuk berstatus "Menunggu konfirmasi" dan baru selesai setelah staf mengonfirmasi.

## 3. Tujuan bisnis

| Kode | Tujuan | Ukuran | Target |
|---|---|---|---|
| OB-1 | Menambah penjualan toko online lewat jaringan member | Bagian pesanan website yang datang lewat affiliate | Ditentukan klien (Q-9) |
| OB-2 | Komisi dihitung tanpa kerja manual | Komisi yang dihitung atau diubah statusnya dengan tangan | 0, kecuali pembayaran |
| OB-3 | Biaya komisi terlihat di laporan | Pembayaran komisi muncul di Laba Rugi | 100% pembayaran yang dicentang "catat pengeluaran" |

## 4. Pemangku kepentingan

| Peran | Siapa | Kepentingan |
|---|---|---|
| Pemberi keputusan | Pemilik GNNK Racing dan leader klien | Kesamaan dengan Sejoli, besaran komisi, siapa boleh jadi affiliate |
| Pengguna | Member yang menjadi affiliate | Link, statistik, komisi, pembayaran |
| Pengguna | Admin toko | Pengaturan, persetujuan affiliate, pembayaran komisi |
| Terdampak | Pembeli | Kebersihan data pribadi, tidak ada perubahan harga |
| Pemelihara | Tim pengembang (kita) | Server VPS, email Mailketing |

## 5. Cakupan

**Masuk cakupan (enam bagian leader klien):**

1. Analytics: statistik affiliate (klik, lead, penjualan, omset, komisi), grafik, sumber trafik, dan ringkasan untuk admin.
2. Kode dan link affiliate serta dashboard affiliate: kode unik per affiliate, pembuat link per produk dan link seluruh toko, parameter sumber trafik, tombol salin dan bagikan, daftar order yang dibawa.
3. Komisi affiliate: komisi per produk dengan tier, status yang mengikuti status pesanan, pembayaran oleh admin dengan bukti transfer, email pemberitahuan.
4. Referral: member yang mendaftar lewat link atau undangan tercatat sebagai jaringan (downline) affiliate tersebut, ditampilkan sebagai pohon jaringan.
5. Undangan email bertoken: affiliate mengirim undangan ke email calon member, tautannya bertoken dan punya masa berlaku.
6. Pengaturan affiliate: aktif atau tidak, siapa yang boleh, umur cookie, "kaitkan affiliasi", komisi bawaan, kedalaman jaringan, tampil atau tidaknya kontak, masa berlaku undangan.

**Di luar cakupan (fitur Sejoli yang tidak diminta leader):** kupon affiliate, marketing kit (banner), bonus editor, Facebook Pixel per affiliate, halaman leaderboard, notifikasi WhatsApp dan SMS, user group dengan komisi berbeda, joint venture, dompet digital, beberapa landing page per produk.

**Nanti:** komisi untuk pesanan POS atau marketplace, impor massal pengaturan komisi produk.

## 6. Kebutuhan bisnis

| Kode | Kebutuhan |
|---|---|
| BR-1 | Toko dapat mengaktifkan atau mematikan program affiliate, dan menentukan apakah semua member atau hanya member tertentu yang boleh menjadi affiliate. |
| BR-2 | Setiap affiliate punya kode dan link yang bisa dibagikan, untuk seluruh toko maupun per produk. |
| BR-3 | Pengunjung yang datang lewat link tercatat atas nama affiliate selama umur cookie yang diatur toko. |
| BR-4 | Pesanan dari pengunjung itu tercatat atas nama affiliate dan menghasilkan komisi sesuai aturan produk. |
| BR-5 | Komisi mengikuti status pesanan tanpa campur tangan: menunggu saat pesanan baru, siap dibayar saat pesanan selesai, batal saat pesanan batal. |
| BR-6 | Admin dapat membayar komisi per affiliate, menyimpan bukti transfer, dan mencatatnya sebagai biaya. |
| BR-7 | Member yang mendaftar lewat link atau undangan menjadi jaringan affiliate tersebut, dan jaringan itu dapat menghasilkan komisi tier 2 dan seterusnya bila toko mengaturnya. |
| BR-8 | Affiliate dapat mengundang calon member lewat email dengan tautan bertoken yang kedaluwarsa. |
| BR-9 | Affiliate dan admin dapat melihat angka kinerja: klik, lead, penjualan, omset, komisi, dan sumber trafik. |
| BR-10 | Affiliate dan pihak terkait menerima email saat ada pesanan baru, komisi masuk, dan komisi dibayar. |

## 7. Aturan bisnis

- **Besar komisi:** persentase dari nilai barang (setelah diskon, tanpa ongkir dan pajak) atau nilai tetap per barang, per tier. Mengikuti Sejoli, yang mengurangi ongkir dan PPN dari dasar komisi.
- **Siapa yang dapat komisi:** affiliate pemilik link (tier 1), lalu upline-nya untuk tier 2 dan seterusnya, sebanyak tier yang diatur. Rantai berhenti bila menemukan orang yang sama dua kali.
- **Membeli lewat link sendiri:** tidak menghasilkan komisi (aturan Sejoli).
- **Kaitkan affiliasi:** bila dinyalakan, pembeli yang sudah tercatat milik satu affiliate akan selalu dicatat atas affiliate itu, link affiliate lain diabaikan.
- **Pembatalan:** pesanan batal membatalkan komisinya, termasuk bila komisi sudah dibayar (ditandai untuk ditindaklanjuti admin). Retur sebagian tidak mengubah komisi, sama seperti Sejoli (Q-7).
- **Pembayaran:** manual oleh admin, tanpa batas minimum (Sejoli juga tanpa minimum). Bisa dibatalkan kembali ke "Belum dibayar" oleh admin.
- **Spam:** undangan dibatasi per affiliate per hari, dan email yang sudah terdaftar sebagai member tidak bisa diundang.

## 8. Asumsi dan ketergantungan

| Kode | Asumsi | Pemilik | Bila salah |
|---|---|---|---|
| AS-1 | Affiliate adalah akun pembeli (member) toko online yang sudah ada | Leader klien | Perlu akun terpisah dan alur pendaftaran baru |
| AS-2 | Komisi hanya untuk pesanan dari toko online | Leader klien | Perlu cara menautkan affiliate ke pesanan POS dan marketplace |
| AS-3 | Email dikirim lewat Mailketing yang sudah aktif | Kita | Perlu SMTP lain |
| AS-4 | Fitur berjalan di server VPS (store.gnnkracing.id) | User | Vercel dan Supabase juga perlu migrasi yang sama |
| AS-5 | Komisi bawaan 10% tier 1 sampai klien menentukan angka (Q-1) | Leader klien | Admin cukup mengubah angka di Pengaturan |

## 9. Risiko

| Kode | Risiko | Kemungkinan | Dampak | Mitigasi | Pemilik |
|---|---|---|---|---|---|
| R-1 | Ekspektasi "100% Sejoli" berbeda dengan yang dibayangkan leader | Sedang | Tinggi | Pemetaan per fitur dengan rujukan berkas kode Sejoli di [Referensi Sejoli](sejoli-referensi.md), disetujui sebelum dibangun | Kita |
| R-2 | "Undangan email bertoken" tidak ada di Sejoli versi mana pun yang diperiksa (1.5.4, 1.13.14, 1.14.7) maupun add-on resminya | Pasti | Sedang | Dibangun baru mengikuti aturan link affiliate Sejoli, ditandai jelas sebagai fitur baru | Kita |
| R-3 | Data pribadi pembeli terlihat oleh affiliate | Sedang | Tinggi | Kontak pembeli dan downline disembunyikan secara bawaan, bisa dinyalakan admin (Q-4) | Klien |
| R-4 | Dua sistem hidup bersamaan (Vercel dan VPS) membuat komisi tercatat di tempat berbeda | Sedang | Tinggi | Affiliate hanya di VPS, Vercel diputuskan user (Q-8) | User |
| R-5 | Penyalahgunaan: membeli lewat link sendiri dengan akun lain | Rendah | Sedang | Komisi baru bisa dibayar setelah pesanan selesai dan dikonfirmasi staf | Admin |

## 10. Biaya

- **Pembangunan:** pekerjaan baru yang dapat ditagihkan, perkiraan 7 hari kerja (server dan database 2, dashboard affiliate 2, layar admin 1,5, uji dan QA 1,5).
- **Berjalan:** tidak ada biaya lisensi. Email memakai kuota Mailketing yang ada.
- **Waktu orang:** admin perlu waktu untuk menyetujui affiliate dan membayar komisi.

## 11. Persetujuan

| Versi | Disetujui oleh | Tanggal | Catatan |
|---|---|---|---|
| 0.1 | Belum | | Menunggu jawaban Q-1 sampai Q-9 di [02 PRD](02-prd.md#13-log-keputusan-dan-pertanyaan) |
