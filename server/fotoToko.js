// Foto produk lama yang diimpor dari WordPress client (gnnkracing.id/wp-content/uploads).
// Server WordPress itu kadang butuh 3 sampai 30 detik per foto, jadi pembeli menerima
// alamat salinannya di server toko (/foto/wp/...), yang dilayani nginx dari disk dan
// diambil dari WordPress sekali saja bila belum ada. Data produk tidak diubah: admin
// tetap melihat dan menyimpan alamat aslinya.

const AWALAN_WP = 'https://gnnkracing.id/wp-content/uploads/';
// Sama dengan pola lokasi nginx /foto/wp/: hanya berkas gambar di folder tahun/bulan.
const POLA_BERKAS = /^[0-9]{4}\/[0-9]{2}\/[A-Za-z0-9._()+-]+\.(?:jpe?g|png|webp|gif|JPE?G|PNG|WEBP)$/;

/** Alamat foto WordPress jadi alamat salinan di toko; alamat lain dikembalikan apa adanya. */
export function fotoLewatToko(url) {
  if (typeof url !== 'string' || !url.startsWith(AWALAN_WP)) return url;
  const berkas = url.slice(AWALAN_WP.length);
  return POLA_BERKAS.test(berkas) ? `/foto/wp/${berkas}` : url;
}

/** Ganti semua nilai teks berupa alamat foto WordPress di dalam data JSON. */
export function gantiFotoDalam(nilai) {
  if (typeof nilai === 'string') return fotoLewatToko(nilai);
  if (Array.isArray(nilai)) return nilai.map(gantiFotoDalam);
  // Hanya objek biasa yang ditelusuri; Date, Buffer, dan objek lain dikirim apa adanya.
  // fromEntries membuat properti sendiri, jadi kunci seperti "__proto__" tidak hilang.
  const proto = nilai && typeof nilai === 'object' ? Object.getPrototypeOf(nilai) : undefined;
  if (proto === Object.prototype || proto === null) {
    return Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, gantiFotoDalam(v)]));
  }
  return nilai;
}

/** Middleware: respons JSON untuk pembeli (/api/public, /api/customer) memakai alamat salinan. */
export function fotoPembeli(req, res, next) {
  if (req.path.startsWith('/api/public/') || req.path.startsWith('/api/customer/')) {
    const json = res.json.bind(res);
    res.json = (badan) => json(gantiFotoDalam(badan));
  }
  next();
}
