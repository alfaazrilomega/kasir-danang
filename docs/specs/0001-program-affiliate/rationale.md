# 0001. Alasan desain program affiliate

Terkait: [index.md](index.md)

## Context

Toko online GNNK Racing berjalan sebagai satu aplikasi React yang dilayani server Express dengan basis data PostgreSQL di VPS. Pesanan dari toko online masuk lewat `POST /api/public/orders` berstatus menunggu konfirmasi, lalu berubah status lewat banyak jalur: tombol konfirmasi dan tolak (`/api/rpc/confirm_web_order`, `reject_web_order`), batal massal (`void_orders`), sinkron data kasir dari IndexedDB lewat `/api/query`, dan callback pembayaran Tripay. Tidak ada satu tempat di kode Node yang dilalui semua perubahan status.

Klien meminta perilaku yang sama dengan Sejoli. Di Sejoli, siapa yang membawa pembeli disimpan di cookie selama umur yang diatur, komisi dibuat saat pesanan baru, dan statusnya mengikuti status pesanan lewat kaitan (hook) WordPress. Toko ini tidak punya sistem kaitan seperti itu, dan cookie Sejoli disimpan polos sehingga bisa diubah pengunjung.

Dua hal lain membatasi desain. Pertama, pesanan toko ini bisa berisi banyak produk, sedangkan pesanan Sejoli selalu satu produk. Kedua, aplikasi juga masih hidup di Vercel sebagai fungsi tanpa server yang tidak bisa menjalankan proses latar, sehingga pekerjaan di belakang layar hanya bisa berjalan di VPS.

Tanpa keputusan ini, risiko terbesarnya adalah komisi yang tertinggal di status lama karena salah satu jalur pengubah pesanan lupa memperbaruinya, dan atribusi yang bisa dipalsukan.

## Options considered

### Option 1: Semua di kode server, cookie polos

Komisi dibuat dan diperbarui oleh kode Node di setiap endpoint yang mengubah status pesanan. Atribusi disimpan di cookie biasa atau `localStorage` yang dikirim klien saat checkout.

**Pros**:
- Semua logika di satu bahasa dan mudah diuji dengan vitest.
- Tidak ada objek basis data baru selain tabel.

**Cons**:
- Jalur `/api/query` (sinkron kasir) dan callback Tripay mengubah status tanpa melewati kode khusus, sehingga mudah ada jalur yang lupa.
- Atribusi di `localStorage` atau cookie polos bisa diubah pengunjung menjadi kode affiliate mana pun.

### Option 2: Cookie bertanda tangan, komisi dibuat server, status disinkronkan pemicu, email lewat antrean

Server menandatangani cookie atribusi. Komisi dibuat di transaksi checkout oleh kode Node (perhitungannya murni dan teruji). Pemicu PostgreSQL di tabel `orders` menyelaraskan status komisi setiap kali `order_status` berubah, dari jalur mana pun, dan menaruh tugas email di tabel antrean yang dikerjakan proses server.

**Pros**:
- Tidak ada jalur pengubah pesanan yang bisa lupa memperbarui komisi.
- Atribusi tidak bisa dipalsukan.
- Kegagalan email tidak pernah membatalkan pesanan atau pembayaran.

**Cons**:
- Sebagian logika berada di SQL, terpisah dari kode Node.
- Email bergantung pada proses server yang hidup terus.

### Option 3: Komisi dihitung saat dibaca, tanpa tabel komisi

Tidak menyimpan komisi. Setiap tampilan menghitung komisi dari pesanan, barang, dan pengaturan saat itu.

**Pros**:
- Tidak ada data turunan yang bisa basi.
- Mengubah pengaturan langsung tercermin di semua angka.

**Cons**:
- Mengubah besar komisi akan mengubah komisi yang sudah dibayar, jadi riwayat pembayaran tidak bisa dipercaya.
- Status dibayar per komisi tetap butuh tempat disimpan.
- Query dashboard menjadi berat (rantai upline dan tier dihitung ulang setiap kali).

## Rationale

Option 2 dipilih karena kekuatan yang paling menentukan di Context adalah banyaknya jalur yang mengubah status pesanan. Pemicu di basis data adalah satu-satunya titik yang dilalui semuanya, termasuk sinkron kasir yang menulis lewat `/api/query` dan callback Tripay. Perhitungan komisi tetap di kode Node karena butuh data cookie dari permintaan checkout dan lebih mudah diuji sebagai fungsi murni.

Komisi disimpan (bukan dihitung saat dibaca) karena uang yang sudah dibayar tidak boleh berubah ketika admin mengganti besar komisi. Ini sama dengan Sejoli yang menyimpan komisi per pesanan. Kolom `base_amount`, `rate_type`, dan `rate_value` disimpan bersama komisi supaya admin bisa melihat dasar perhitungannya.

Undangan email dikirim langsung saat dibuat, tidak lewat antrean, karena token aslinya hanya ada di memori saat itu. Menyimpan token di antrean akan membatalkan manfaat menyimpan sidiknya saja.

Halaman `/aff/*` dibuat sebagai rute aplikasi yang memanggil endpoint publik, bukan rute pengalihan Express, karena Vercel mengarahkan semua jalur selain `/api` ke `index.html` dan server pengembangan Vite hanya meneruskan `/api`. Satu cara berjalan di ketiga tempat.
