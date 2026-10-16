import type { ReactNode } from 'react';
import { PublicShell, tautanWhatsApp } from '@/components/layout/PublicShell';
import { useTokoPublik } from '@/components/public/KerangkaAuth';
import { Link } from '@/lib/router';

const BERLAKU = '13 September 2026';

function Halaman({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <PublicShell latar="putih">
      <article className="mx-auto max-w-[780px] py-6 text-[15px] leading-7 text-ink-700 dark:text-ink-200">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">{judul}</h1>
        <p className="mt-1 text-sm text-ink-500">Berlaku sejak {BERLAKU}</p>
        <div className="mt-6 space-y-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900 dark:[&_h2]:text-ink-100 [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}

function Kontak() {
  const toko = useTokoPublik();
  const nama = toko?.name ?? 'toko kami';
  const wa = tautanWhatsApp(toko?.shop_phone);
  return (
    <section>
      <h2>Hubungi Kami</h2>
      <p>
        Untuk pertanyaan tentang halaman ini, hubungi {nama}
        {wa ? (
          <>
            {' '}lewat WhatsApp{' '}
            <a href={wa} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
              {toko?.shop_phone}
            </a>
          </>
        ) : null}
        .
      </p>
    </section>
  );
}

/** Kebijakan privasi toko online; isinya mengikuti data yang benar-benar dipakai aplikasi. */
export function PublicKebijakanPrivasi() {
  const toko = useTokoPublik();
  const nama = toko?.name ?? 'Toko';
  return (
    <Halaman judul="Kebijakan Privasi">
      <p>
        Kebijakan ini menjelaskan data pribadi apa yang dikumpulkan {nama} saat kamu memakai toko online kami, untuk apa
        data itu dipakai, dan bagaimana kami menjaganya.
      </p>
      <section>
        <h2>1. Data yang Kami Kumpulkan</h2>
        <ul>
          <li>Saat mendaftar: nama lengkap, email, nomor HP/WhatsApp, dan kata sandi (disimpan dalam bentuk terenkripsi).</li>
          <li>Saat masuk dengan Google: nama dan alamat email dari akun Google kamu. Kami tidak pernah menerima kata sandi Google.</li>
          <li>Saat memesan: nama penerima, nomor HP, alamat pengiriman, catatan pesanan, dan barang yang dibeli.</li>
          <li>Saat menulis ulasan: nama, nilai bintang, isi ulasan, dan foto yang kamu unggah.</li>
          <li>Data teknis: isi keranjang dan status masuk disimpan di browser perangkatmu, serta alamat IP untuk membatasi percobaan masuk yang mencurigakan.</li>
        </ul>
      </section>
      <section>
        <h2>2. Penggunaan Data</h2>
        <ul>
          <li>Memproses, mengonfirmasi, dan mengirim pesanan kamu.</li>
          <li>Menghubungi kamu tentang pesanan, ongkos kirim, atau pengembalian barang.</li>
          <li>Menyediakan akun pembeli: riwayat pesanan, alamat tersimpan, ulasan, dan favorit.</li>
          <li>Mengirim kode verifikasi ke email saat kamu meminta atur ulang kata sandi.</li>
          <li>Mencegah penyalahgunaan dan menjaga keamanan layanan.</li>
        </ul>
      </section>
      <section>
        <h2>3. Berbagi Data</h2>
        <p>
          Kami tidak menjual atau menyewakan data pribadimu. Nama, nomor HP, dan alamat hanya diberikan kepada jasa
          pengiriman yang mengantar pesananmu, atau kepada pihak berwenang bila diwajibkan oleh hukum.
        </p>
      </section>
      <section>
        <h2>4. Penyimpanan dan Keamanan</h2>
        <p>
          Data disimpan di server yang hanya bisa diakses staf toko yang berwenang. Kata sandi disimpan dalam bentuk
          terenkripsi sehingga tidak bisa dibaca siapa pun, termasuk kami. Kode atur ulang kata sandi hanya berlaku 10 menit.
        </p>
      </section>
      <section>
        <h2>5. Lama Penyimpanan</h2>
        <p>
          Data akun disimpan selama akunmu aktif. Data pesanan disimpan selama diperlukan untuk catatan transaksi,
          garansi, dan kewajiban pembukuan toko.
        </p>
      </section>
      <section>
        <h2>6. Hak Kamu</h2>
        <ul>
          <li>Melihat dan mengubah nama, nomor HP, dan alamat di halaman Akun Saya.</li>
          <li>Meminta akunmu dihapus dengan menghubungi kami.</li>
          <li>Menarik persetujuan penggunaan data; pesanan baru tidak dapat diproses tanpa data pengiriman.</li>
        </ul>
      </section>
      <section>
        <h2>7. Perubahan Kebijakan</h2>
        <p>Bila kebijakan ini berubah, versi terbaru beserta tanggal berlakunya ditampilkan di halaman ini.</p>
      </section>
      <Kontak />
      <p className="text-sm text-ink-500">
        Lihat juga <Link to="/toko/syarat-ketentuan" className="text-brand-600 hover:underline">Syarat &amp; Ketentuan</Link>.
      </p>
    </Halaman>
  );
}

/** Syarat & ketentuan belanja di toko online. */
export function PublicSyaratKetentuan() {
  const toko = useTokoPublik();
  const nama = toko?.name ?? 'Toko';
  return (
    <Halaman judul="Syarat & Ketentuan">
      <p>Dengan memakai toko online {nama}, kamu menyetujui syarat dan ketentuan berikut.</p>
      <section>
        <h2>1. Akun</h2>
        <ul>
          <li>Isi data akun dengan benar dan jaga kerahasiaan kata sandimu.</li>
          <li>Kamu bertanggung jawab atas pesanan yang dibuat dari akunmu.</li>
        </ul>
      </section>
      <section>
        <h2>2. Produk dan Harga</h2>
        <ul>
          <li>Harga tercantum dalam Rupiah dan dapat berubah sewaktu-waktu sebelum pesanan dikonfirmasi.</li>
          <li>Foto produk dapat sedikit berbeda dari barang asli karena pencahayaan atau layar.</li>
          <li>Pastikan ukuran dan tipe barang sesuai motormu sebelum memesan.</li>
        </ul>
      </section>
      <section>
        <h2>3. Pemesanan</h2>
        <ul>
          <li>Setiap pesanan dikonfirmasi toko terlebih dahulu. Stok baru dipotong setelah pesanan dikonfirmasi.</li>
          <li>Toko dapat menolak atau membatalkan pesanan bila stok habis atau data pengiriman tidak lengkap.</li>
        </ul>
      </section>
      <section>
        <h2>4. Pembayaran dan Ongkos Kirim</h2>
        <ul>
          <li>Pembayaran dengan tunai di tempat (COD), QRIS, atau transfer sesuai pilihan saat checkout.</li>
          <li>Ongkos kirim dan perkiraan tiba dikonfirmasi toko sebelum pembayaran.</li>
        </ul>
      </section>
      <section>
        <h2>5. Pengiriman</h2>
        <p>Barang dikirim ke alamat yang kamu isi. Waktu tiba adalah perkiraan dan dapat berubah karena jasa pengiriman.</p>
      </section>
      <section>
        <h2>6. Pengembalian dan Garansi</h2>
        <p>
          Pengembalian dan garansi mengikuti ketentuan yang tercantum di halaman produk. Barang yang dikembalikan harus
          lengkap dan dalam kondisi seperti saat diterima. Hubungi kami untuk mengajukan pengembalian.
        </p>
      </section>
      <section>
        <h2>7. Ulasan</h2>
        <p>
          Ulasan harus jujur dan berdasarkan pembelian sendiri. Toko dapat menyembunyikan ulasan yang mengandung SARA,
          kata kasar, promosi, atau informasi pribadi orang lain.
        </p>
      </section>
      <section>
        <h2>8. Data Pribadi</h2>
        <p>
          Penggunaan data pribadimu dijelaskan di{' '}
          <Link to="/toko/kebijakan-privasi" className="text-brand-600 hover:underline">Kebijakan Privasi</Link>.
        </p>
      </section>
      <section>
        <h2>9. Perubahan Ketentuan</h2>
        <p>Bila ketentuan ini berubah, versi terbaru beserta tanggal berlakunya ditampilkan di halaman ini.</p>
      </section>
      <Kontak />
    </Halaman>
  );
}
