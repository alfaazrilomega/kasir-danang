# Dokumen produk GNNK Racing

Toko online dan kasir GNNK Racing (store.gnnkracing.id). Folder ini menyimpan dokumen untuk fitur besar. Fitur pertama yang didokumentasikan dengan cara ini adalah Program Affiliate, yang meniru Sejoli untuk enam bagian yang diminta leader klien.

**Status 11 Okt 2026:** semua dokumen Program Affiliate masih draft. Sedang dibangun di lokal, belum dipasang di VPS. Daftar permintaan klien yang lain tetap di `../PERMINTAAN-CLIENT.md`.

## Urutan baca

| No | Dokumen | Menjawab | Pembaca utama |
|---|---|---|---|
| 01 | [BRD](01-brd.md) | Kenapa dibangun, untung dan risikonya | Pemilik toko, leader klien |
| 02 | [PRD](02-prd.md) | Apa yang dilakukan, kolom per kolom, dan cara mengujinya | Leader klien, pengembang |
| 03 | [Peta cerita](03-story-map.md) | Siapa melakukan apa, di irisan mana | Semua |
| 04 | [Wireframe](04-wireframes.md) | Setiap layar dan keadaannya | Leader klien, pengembang |
| 05 | [Design system](05-design-system.md) | Tampilan dan aturan komponen | Pengembang |
| 06 | [Spesifikasi teknis](specs/0001-program-affiliate/index.md) | Cara membangunnya | Pengembang |
| 08 | [Rencana uji](08-qa-test-plan.md) | Cara membuktikan setiap kriteria | Pengembang, QC |
| | [Referensi Sejoli](sejoli-referensi.md) | Perilaku Sejoli mana yang disalin dan dari berkas kode mana | Leader klien |

Dokumen 07 (API untuk aplikasi lain) tidak dibuat karena tidak ada aplikasi lain yang memanggil fitur ini. Dokumen 09 (catatan rilis) dibuat saat rilis.

## Keputusan

Daftar lengkap ada di [log keputusan PRD](02-prd.md#13-log-keputusan-dan-pertanyaan).

| Kode | Ringkas |
|---|---|
| D-1 | Affiliate adalah akun member yang sudah ada |
| D-2 | Akses per member menggantikan user group Sejoli |
| D-3 | Link memakai kode pendek, ada link seluruh toko |
| D-4 | Umur cookie 0 berarti selamanya |
| D-5 | Komisi bawaan toko ditambah komisi khusus produk |
| D-6 | Komisi per barang tanpa ongkir dan pajak |
| D-7 | Padanan status pesanan ke status komisi |
| D-8 | Pembayaran disimpan dan bisa dicatat sebagai pengeluaran |
| D-9 | Kontak pembeli dan downline disembunyikan secara bawaan |
| D-10 | Definisi Klik, Lead, Sales, Omset, Komisi |
| D-11 | Undangan email dibangun baru |
| D-12 | Komisi hanya untuk pesanan toko online |
| D-13 | Kode hanya bisa diubah admin |
| D-14 | Dashboard di toko online, admin di menu Affiliate |
| D-15 | Email lewat antrean |
| D-16 | Maksimal 5 tier |
| D-17 | Penerima tier tanpa akses dilewati |
| D-18 | TikTok ditambahkan ke daftar platform |
