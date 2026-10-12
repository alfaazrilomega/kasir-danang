# 05 Design system: tambahan untuk Program Affiliate

Produk: Toko online GNNK Racing · Versi 0.1 · 11 Okt 2026 · Status: draft · Terkait: [04 Wireframe](04-wireframes.md)

## 1. Arah

Tidak ada arah visual baru. Layar affiliate memakai gaya yang sudah ada:
- Toko online mengikuti halaman akun pembeli (`src/pages/public/PublicAccount.tsx`): panel putih bersudut 8 px, identitas hitam dengan strip bendera kotak, huruf Barlow Condensed miring untuk nama.
- Admin mengikuti halaman Promo (`src/pages/Promos.tsx`): kepala berwarna brand bersudut 24 px, tab pil, ubin statistik, kartu.

## 2. Bukti

Token dibaca dari `tailwind.config.js` dan `src/index.css` pada 11 Okt 2026, bukan ditebak. Kontras dihitung dengan rumus WCAG 2.1.

## 3. Token yang dipakai

| Token | Nilai | Dipakai untuk |
|---|---|---|
| brand-600 | rgb(90 65 229) | Ubin Komisi, ubin Belum dibayar, tombol utama |
| brand-500 | rgb(124 77 255) | Tombol utama toko |
| ink-500 | #5b6a82 | Teks keterangan (kontras 5,48:1 di putih) |
| ink-900 | #141826 | Identitas affiliate, judul |
| Huruf dasar | 14 px | Ukuran rem lebih kecil dari biasanya. Target sentuh ditulis dalam piksel (`h-[44px]`), bukan `h-11` (38,5 px) |

Warna status (latar 50, teks 700):

| Status | Warna | Kontras |
|---|---|---|
| Order belum selesai, Dibuka | amber | 4,84:1 |
| Belum dibayar, Terkirim | sky | 5,57:1 |
| Sudah dibayar, Selesai, Terdaftar | emerald | 5,21:1 |
| Dibatalkan, Kedaluwarsa | ink 600 di ink 100 | 6,92:1 |
| Gagal terkirim | rose | lebih dari 4,5:1 |

Teks peringatan (rekening belum diisi) memakai amber-700 (5,02:1), bukan amber-600 (3,19:1, gagal). Tautan Follow up memakai emerald-700 (5,48:1).

## 4. Komponen baru

| Komponen | Letak | Anatomi dan aturan |
|---|---|---|
| Ubin ringkasan | `PublicAffiliate.tsx` (`Ubin`), `AffiliateAdmin.tsx` (`Ubin`) | Label, angka tebal tabular, keterangan satu baris. Varian `tonjol` berwarna brand untuk satu angka terpenting per baris |
| Baris link | `PublicAffiliate.tsx` (`BarisLink`) | Label, kolom link baca saja bermonospasi, lalu Salin, WhatsApp, Bagikan. Di HP tombol menjadi 3 kolom di bawah kolom link |
| Chip saring | `Saring` (toko), `Chip` (admin) | Baris yang bisa digeser, tinggi 44 px di HP dan 36 px di desktop |
| Saklar | `AffiliateAdmin.tsx` (`Saklar`) | Kotak centang `role="switch"` tersembunyi dengan jalur 44 x 24 px, fokus keyboard terlihat lewat cincin brand |
| Tier komisi | `TierKomisi` (diekspor untuk formulir produk) | Satu baris per tier: Tipe (Persentase atau Nilai Tetap), Besar dengan akhiran % atau awalan Rp, tombol hapus. Maksimal 5 tier |
| Kartu daftar admin di HP | Pembayaran, Affiliate, Komisi | Di bawah 768 px tabel diganti kartu supaya tombol aksi selalu terlihat |
| Pilih rentang | `PilihRentang` | Preset (7 hari, 30 hari, Bulan ini, Bulan lalu, Semua) dan dua kolom tanggal yang mengisi lebar di HP |

## 5. Gerak

Hanya transisi warna 150 ms bawaan dan `active:scale-[0.97]` di tombol toko, sama seperti tombol yang ada. Tidak ada animasi masuk: layar ini dibuka berulang kali dan angkanya harus langsung terbaca.

## 6. Aksesibilitas terukur

- Target sentuh di HP: 0 elemen di bawah 44 px di 17 keadaan layar (lihat [04 Wireframe](04-wireframes.md#cara-pemeriksaannya)).
- Setiap kolom isian punya `label` yang terhubung. Galat undangan memakai `role="alert"` dan `aria-describedby`.
- Grup pilihan periode dan saring memakai `role="tablist"` dan `aria-selected`.
