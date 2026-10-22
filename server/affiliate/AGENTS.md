# Program affiliate

Spesifikasi: `docs/specs/0001-program-affiliate/index.md`. PRD: `docs/02-prd.md`. Rencana uji dan hasil: `docs/08-qa-test-plan.md`.

## Aturan yang mudah rusak

- Status komisi mengikuti `orders.order_status` lewat pemicu basis data `affiliate_sinkron_status()` (migrasi 047). Jalur baru yang mengubah status pesanan tidak perlu kode affiliate, tetapi arti status pesanan yang berubah harus ikut diubah di pemicu itu.
- Email affiliate lewat antrean `affiliate_outbox`, dikirim pekerja di `server/index.js` (`prosesOutbox`). Di Vercel pekerja tidak berjalan.
- Atribusi dan komisi dibuat di dalam transaksi checkout, di dalam `savepoint affiliate`. Kegagalannya tidak boleh membatalkan pesanan.
- Aturan per produk (link produk, syarat sudah membeli) berlaku per kelompok varian: `sqlKunciKelompok` di `layanan.js`, sama dengan `kunciKelompok` di `src/lib/publicCatalog.ts`.
- Isian angka pengaturan dibaca dengan `angkaIsian` (`inti.js`, dan versi layarnya di `AffiliateAdmin.tsx`). `Number('')` bernilai 0, yang berarti umur cookie selamanya atau komisi 0%.
- Kirim undangan dan kirim ulang memegang `pg_advisory_xact_lock` per affiliate. Email dikirim setelah transaksi selesai.
- Alamat baru di aplikasi harus didaftarkan di penyelamat cangkang lama `public/kasir-config.js`, dan angka `data-cangkang` di `index.html` dinaikkan. Tanpa itu pengunjung dengan service worker versi lama dilempar ke `/toko` pada kunjungan pertama setelah deploy.
- Halaman pembuka link (`AffiliateOpen.tsx`) menampilkan pesan Sejoli hanya untuk link yang salah. Gangguan jaringan, 5xx, dan 429 tetap mengantar pengunjung ke tujuan.

## Pengujian

- Suite: `scripts/verify_affiliate_*.cjs`, terdaftar di `scripts/run_all_checks.cjs`. `verify_affiliate_stale_shell.cjs` dijalankan manual dengan dua build produksi (cara pakai di kepala berkasnya).
- Akun uji wajib berakhiran `@contoh.id`. `.env` lokal berisi token Mailketing, jadi alamat lain mengirim email sungguhan.
- Tiap suite menghapus data putarannya lewat `bersihkanUji` di `scripts/lib/affiliate.cjs`. Data uji yang tertinggal membuat `verify_pnl_math` dan `verify_mobile_tables` merah.
- Build untuk mengukur kecepatan: `NODE_ENV=production npx vite build`. `.env` lokal berisi `NODE_ENV=development`, sehingga `npm run build` biasa menghasilkan bundel mode pengembangan.
