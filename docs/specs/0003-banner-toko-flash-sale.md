# 0003. Banner Toko di beranda dan tampilan Flash Sale ala Lazada

**Date**: 2026-10-18
**Status**: In Progress

## Summary

Client menulis (18 Okt 2026) bahwa dua hal terlewat: banner beranda yang bisa diganti dari menu di dashboard, dan tampilan flash sale yang dibahas sejak memilih tema Lazada. Banner memang belum ada: karosel beranda hanya memakai satu gambar dari Pengaturan (banner halaman produk) dan slide produk terlaris. Flash sale sebenarnya sudah ada (menu Promo, tab Flash Sale), tetapi produksi belum pernah punya sesi, jadi bloknya tidak pernah tampil; bentuknya juga belum seperti referensi Lazada yang client tunjuk. Spec ini menambah menu Banner Toko dan merapikan blok Flash Sale.

## Requirements

**User stories**:
- Sebagai admin, saya ingin mengunggah beberapa banner dan mengatur urutan, tautan, dan jadwalnya dari satu menu, supaya promo di beranda bisa diganti tanpa developer.
- Sebagai pembeli, saya ingin melihat flash sale yang sedang berjalan atau yang akan dimulai dengan hitung mundur yang jelas, supaya tidak ketinggalan harga promo.

**Acceptance criteria**:

Banner (keputusan user 18 Okt: menu sendiri di sidebar; gambar, gambar HP opsional, tautan, urutan, aktif, jadwal opsional):
- **AC-1**: Menu "Banner Toko" ada di sidebar admin (hak `managePromos`). Admin bisa menambah, mengubah, menghapus, menyalakan atau mematikan, dan menaikkan atau menurunkan urutan banner.
- **AC-2**: Tiap banner punya gambar desktop (wajib), gambar HP (opsional), judul untuk teks alternatif (opsional), tautan (opsional: alamat di toko yang diawali `/`, atau `https://`), jadwal mulai dan selesai (opsional). Gambar diperkecil di browser sebelum disimpan.
- **AC-3**: Formulir menampilkan pratinjau potongan gambar di bingkai HP dan desktop, sesuai ukuran karosel beranda, dan menyebut ukuran yang disarankan.
- **AC-4**: Bila ada banner aktif yang jadwalnya berlaku, karosel beranda hanya menampilkan banner itu sesuai urutan; gambar HP dipakai di layar di bawah 640px bila ada. Bila tidak ada banner, karosel tetap seperti sekarang.
- **AC-5**: Banner bertautan bisa diklik: tautan `/...` membuka halaman toko, tautan `https://` membuka tab baru.
- **AC-6**: Gambar banner untuk pembeli dilayani dari alamat sendiri yang bisa disimpan lama di cache, bukan ikut di respons katalog.

Flash sale (keputusan user: rapikan seperti Lazada, client membuat sesinya sendiri):
- **AC-7**: Saat sesi berjalan, kepala blok menampilkan "Dijual Sekarang", "Berakhir dalam", hitung mundur tiga kotak merah (jam, menit, detik), dan tombol "Belanja Semua Produk".
- **AC-8**: "Belanja Semua Produk" membuka daftar produk yang sedang flash sale (`/toko?flash=1`).
- **AC-9**: Bila tidak ada sesi berjalan tetapi ada sesi aktif yang akan dimulai dalam 7 hari, blok tampil dengan label "Segera Dimulai", hitung mundur "Mulai dalam", dan kartu produknya bertanda "Segera" dengan harga flash yang akan berlaku. Begitu waktunya tiba, blok berganti ke sesi berjalan tanpa muat ulang.
- **AC-10**: Di HP 393px kepala blok tidak terpotong, hitung mundur terbaca, tombol setinggi minimal 44px.

## Decision

Tabel baru `store_banners` lewat lapisan query admin (pola `flash_sales`, hanya admin); gambar disimpan sebagai data URL hasil kompres (pola gambar produk dan banner lama) dan dilayani ke pembeli lewat `GET /api/public/banners/:id/gambar` dengan versi di alamatnya. Flash sale: endpoint `/api/public/flash-sale` menambah `berikutnya`.

## Feature design

**Data model** (migrasi `058_banner_toko.sql`): `store_banners(id uuid pk, store_id fk stores, title text null, image_data text not null, image_mobile_data text null, link_url text null, sort_order int default 0, is_active bool default true, starts_at timestamptz null, ends_at timestamptz null, created_at, updated_at)`; batas panjang data URL 3.000.000 karakter; `ends_at > starts_at` bila keduanya ada; tautan harus `/...` (bukan `//...`) atau `https://...`, tanpa spasi, karakter kontrol, atau `\`.

**API surface**:
| Endpoint | Method | Keterangan |
|---|---|---|
| `/api/query` tabel `store_banners` | select/insert/upsert/update/delete | admin saja |
| `/api/public/catalog` | GET | menambah `banners: [{ id, title, link_url, v, ada_hp }]` yang aktif dan berlaku, urut `sort_order` |
| `/api/public/banners/:id/gambar` | GET | `?jenis=desktop|hp&v=`; biner gambar, `Cache-Control: public, max-age=31536000, immutable`; 404 bila tidak aktif |
| `/api/public/flash-sale` | GET | menambah `berikutnya: { flash_sale, items } | null` |

**Value sourcing**: urutan dari `sort_order`; berlaku = `is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())`; versi gambar `v` = `updated_at` dalam milidetik; ukuran saran desktop 1980 × 690 px (karosel desktop sekitar 2,9:1), HP 1080 × 600 px (sekitar 1,8:1).

## Build plan

1. Migrasi 058 dan pendaftaran tabel (TABLES, izin peran, REQUIRED_COLUMNS, tipe), satisfies **AC-1**, **AC-2**
2. Endpoint publik banner (katalog dan gambar) dan `berikutnya` flash sale, plus uji unit, satisfies **AC-4**, **AC-6**, **AC-9**
3. Halaman admin Banner Toko dan menu sidebar, satisfies **AC-1**, **AC-2**, **AC-3**
4. Karosel beranda memakai banner, satisfies **AC-4**, **AC-5**
5. Blok Flash Sale baru dan filter `?flash=1`, satisfies **AC-7**, **AC-8**, **AC-9**, **AC-10**
6. Uji Playwright lokal 393 dan 1440, QC sub agen, pasang ke produksi, satisfies semua AC

## Consequences

- Banner halaman produk di Pengaturan tetap terpisah dan tetap dipakai sebagai cadangan karosel bila belum ada banner.
- Flash sale tetap harus dibuat client sendiri di menu Promo; tanpa sesi, blok tidak tampil.
- Hitung mundur memakai `server_time` dari `/api/public/flash-sale`, jadi jam HP pembeli yang maju atau mundur tidak membuat blok hilang. Setelah hitungan habis, toko meminta data baru tiap 5 detik sampai server berganti sesi.

## Follow-up

Tayang 18 Okt 2026 sebagai rilis `20261018-banner-flash`, cadangan database `pra-banner-flash-20261018.dump`, migrasi 058 diterapkan.

- [x] Uji Playwright lokal 393 dan 1440: 28/28, dua putaran berturut turut bersih.
- [x] Uji unit server 180/180.
- [x] QC sub agen: AC-1 sampai AC-10 lolos. Temuan C1 (jam HP maju menghilangkan blok), C2 (simpan dua kali saat offline menggandakan banner), C3 (teks daftar flash kosong dan kedip saat memuat), C5 (tautan `/\domain` dan spasi lolos aturan), C7 (karosel tetap berputar saat titik difokus keyboard) diperbaiki dan dikunci uji.
- [x] Uji asap produksi tanpa login: 6/6 (karosel lama tetap tampil, 0 penolakan CSP, 0 galat konsol, `/api/query store_banners` tanpa login 401).
- [x] Alur admin Banner Toko di produksi 11/11 (19 Okt 2026, akun admin sementara, sudah dihapus): menu, keadaan kosong, simpan banner NONAKTIF (JPEG, tautan flash sale), lencana Nonaktif, tidak masuk katalog pembeli, gambar 404, hapus lewat daftar, 0 penolakan CSP.
- [ ] Gambar banner AKTIF lewat nginx produksi belum dilihat (banner uji sengaja nonaktif supaya pembeli tidak melihatnya). Terbukti saat client memasang banner pertama.
- [ ] Dibiarkan, nilainya kecil: C4 (blok beranda menghitung per varian, daftar "Belanja Semua Produk" per produk), C6 (ubah judul saja mengganti versi gambar sehingga gambar diunduh ulang sekali), C8 (`store_banners` belum masuk `TABLE_CAPABILITY`, sama seperti `flash_sales`; akses tetap admin saja).
