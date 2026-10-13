# 0002 · Tarif per affiliate, undangan admin, retur, potongan, bonus target

**Status**: In Progress
**Date**: 13 Okt 2026
**Induk**: [index.md](index.md)
**PRD**: `docs/02-prd.md` bagian 14 (D-31 sampai D-40, FR-49 sampai FR-61, AC-70 sampai AC-84)

## Summary

Jawaban klien atas Q-1, Q-2, Q-4, Q-5, Q-6, Q-7, Q-9 mengubah aturan uang dan akses. Spesifikasi ini menambah tarif komisi per affiliate, undangan khusus dari admin yang membuka akses, pemotongan komisi oleh retur dan pembatalan sesudah dibayar (menjadi potongan pembayaran berikutnya), bonus target bulanan, minimal pencairan, undangan tanpa batas harian, dan mengunci kontak pembeli dari affiliate.

## Decision

Semua keputusan bisnis sudah dibuat di PRD D-31 sampai D-40. Keputusan teknis di sini:

1. **Potongan disimpan sebagai baris sendiri** (`affiliate_potongan`), bukan dengan mengubah komisi yang sudah dibayar. Komisi yang sudah dibayar adalah catatan uang keluar dan tidak boleh berubah angkanya. Potongan terpakai saat satu pembayaran mengisinya `payout_id`.
2. **Retur dihitung oleh pemicu basis data** pada `order_return_items`, seperti status komisi (D-15). Retur ditulis lewat `/api/query` dari layar Retur dan bisa tertunda saat luring, jadi hanya pemicu yang pasti menangkap semua jalur.
3. **Bonus disimpan sebagai baris** (`affiliate_bonuses`, satu per affiliate per bulan) yang dihitung ulang oleh server: pekerja tiap 60 detik untuk semua toko berbonus, dan langsung sebelum membaca ringkasan affiliate, ringkasan pembayaran, atau membayar (dibatasi sekali per 5 detik per toko). Bulan berjalan dan bulan lalu saja; bulan lebih tua beku.
4. **Undangan admin memakai tabel undangan yang ada** dengan `affiliate_id` kosong dan `dari_admin`. Pendaftar dikenali dari email (tautan undangan mengisi email di formulir daftar), jadi undangan admin tidak memasang cookie affiliate.

## Data model (migrasi `048_affiliate_jawaban_klien.sql`, aman diulang)

```sql
alter table public.customers add column if not exists affiliate_commission jsonb;

alter table public.affiliate_invitations alter column affiliate_id drop not null;
alter table public.affiliate_invitations add column if not exists dari_admin boolean not null default false;
alter table public.affiliate_invitations add column if not exists commission jsonb;
-- pengirim: undangan affiliate wajib punya affiliate_id, undangan admin tidak

alter table public.affiliate_commissions add column if not exists commission_awal numeric(14,2);
update public.affiliate_commissions set commission_awal = commission where commission_awal is null;
-- cek komisi menjadi >= 0: komisi yang seluruh barangnya diretur bernilai 0

create table if not exists public.affiliate_potongan (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  affiliate_id uuid not null references public.customers(id) on delete restrict,
  commission_id uuid not null references public.affiliate_commissions(id) on delete cascade,
  jenis text not null check (jenis in ('retur', 'batal')),
  amount numeric(14,2) not null check (amount > 0),
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_bonuses (
  id uuid primary key default gen_random_uuid(),
  store_id, affiliate_id (restrict), bulan date not null,       -- hari pertama bulan, WIB
  omset, target numeric(14,2), rate_type, rate_value, amount numeric(14,2) check (amount > 0),
  status text check (status in ('berjalan', 'added')),
  paid boolean default false, paid_at, payout_id (set null),
  unique (store_id, affiliate_id, bulan)
);

alter table public.affiliate_payouts add column if not exists commission_total numeric(14,2) not null default 0;
alter table public.affiliate_payouts add column if not exists bonus_total numeric(14,2) not null default 0;
alter table public.affiliate_payouts add column if not exists deduction_total numeric(14,2) not null default 0;
update public.affiliate_payouts set commission_total = amount where commission_total = 0;
```

Tabel baru masuk `REQUIRED_COLUMNS` di `server/migrate.js` dan tidak masuk `TABLES` (tidak bisa dibaca lewat `/api/query`).

## Sumber setiap nilai

| Nilai | Sumber |
|---|---|
| Tarif komisi per barang | `products.affiliate_commission` bila diisi, lalu `customers.affiliate_commission` milik affiliate tier 1, lalu `affiliate_settings.commission` (D-31) |
| r retur | jumlah `order_return_items.qty` untuk produk itu pada semua retur pesanan itu, dibagi jumlah `order_items.qty` produk itu di pesanan, paling besar 1 |
| Komisi setelah retur | `floor(commission_awal x (1 - r))` |
| Potongan retur untuk komisi dibayar | `commission_awal - komisi setelah retur - potongan retur yang sudah terpakai`; potongan retur yang belum terpakai dihitung ulang (dihapus lalu ditulis) |
| Potongan batal | `commission - semua potongan retur komisi itu`, bila lebih dari 0 |
| Retur per pesanan (omset) | jumlah `order_returns.refund_amount` per `order_id` |
| Omset | `subtotal - discount - retur` pesanan Selesai (D-39) |
| Bonus bulan B | omset pesanan affiliate itu yang dibuat di bulan B (WIB), Selesai; bonus = `floor(omset x value / 100)` atau `value`; ada bila omset >= target dan affiliate masih berhak |
| Status bonus | `berjalan` bila B bulan ini, `added` bila B sudah lewat |
| Pembayaran bersih | komisi `added` belum dibayar (dalam rentang tanggal) + bonus `added` belum dibayar (bulan dalam rentang) - semua potongan belum terpakai |

## Alur

- **Pemicu retur** `affiliate_potong_retur()` setelah insert atau delete pada `order_return_items`: cari `order_id` dari `order_returns`, lalu `affiliate_hitung_retur(order, produk)` menerapkan rumus di atas ke tiap komisi pesanan itu untuk produk itu. Komisi belum dibayar diubah angkanya; komisi sudah dibayar mendapat potongan.
- **Pemicu status** `affiliate_sinkron_status()` diperluas: pesanan menjadi `canceled` membuat potongan `batal` untuk komisi yang sudah dibayar; pesanan keluar dari `canceled` menghapus potongan `batal` yang belum terpakai.
- **Bayar** (`POST /api/admin/affiliate/payouts`): kunci baris komisi, bonus, dan potongan affiliate itu; hitung bersih; tolak 409 bila bersih <= 0 (pesan potongan) atau bila di bawah `payout_minimum` tanpa `abaikan_minimal: true`; simpan rincian; tandai komisi dan bonus dibayar, isi `payout_id` potongan; pengeluaran sebesar bersih.
- **Batal bayar** (aksi massal Belum Dibayar): bila pembayaran tidak lagi punya komisi, atau bersihnya menjadi <= 0, pembayaran dihapus dan bonus serta potongannya dilepas (`paid = false`, `payout_id` kosong). Selain itu jumlah dan `commission_total` dikurangi.
- **Undangan admin**: `GET/POST /api/admin/affiliate/invitations`, `POST /api/admin/affiliate/invitations/:id/resend`. Membuka tautan undangan admin menandai Dibuka dan membawa ke daftar dengan email terisi, tanpa cookie. `catatReferralDaftar` memeriksa undangan admin berlaku untuk email pendaftar: akses Diizinkan, tarif dari undangan, status Terdaftar. Pencocokan email undangan affiliate mengabaikan undangan admin.
- **Kontak**: `show_buyer_contact` dan `show_downline_contact` keluar dari pengaturan; endpoint affiliate tidak pernah mengirim kontak.

## Build plan

1. Migrasi 048 dan daftar kolomnya. Uji: `npm run db:migrate`, dua kali jalan di dalam transaksi yang dibatalkan.
2. Fungsi murni di `inti.js` dengan uji unit lebih dulu: pengaturan baru, `tarifBarang`, `komisiSetelahRetur`, `hitungBonus`, `rincianBayar`.
3. Server: tarif di `catatAtribusiPesanan`, omset bersih, bonus (`layanan.js`), endpoint baru dan perubahan bayar (`rute.js`), pekerja bonus (`server/index.js`), email undangan admin (`pekerja.js`).
4. Layar admin: Pengaturan (minimal, bonus, batas harian, tanpa saklar kontak), Affiliate (Undang affiliate, daftar undangan admin, tarif di dialog member), Pembayaran (rincian, tanda minimal, konfirmasi), Komisi (tanda dipotong retur).
5. Layar affiliate: kartu target, bonus dan potongan di Komisi, minimal pencairan, tarif sendiri di Link, catatan retur di Order, penghitung tanpa batas.
6. Suite `scripts/verify_affiliate_klien.cjs` untuk AC-70 sampai AC-84, suite lama disesuaikan dengan D-33 dan D-35, QC sub-agent, regresi penuh.

## Consequences

- Batal bayar untuk pembayaran yang hanya berisi bonus belum punya tombol: aksi massal bekerja dari daftar komisi. Bila dibutuhkan, tambahkan "Batalkan pembayaran" di riwayat.
- Pembayaran yang sudah memakai potongan lalu pesanannya kembali Selesai tidak mengembalikan potongan itu. Kasusnya jarang; admin membayar selisihnya dengan konfirmasi massal.
- Produk terlaris di ringkasan admin tetap memakai nilai barang kotor; omset lain sudah bersih dari retur.
