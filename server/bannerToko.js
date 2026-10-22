// Banner beranda toko online (spec 0003).

/** Syarat banner tampil di toko: aktif dan jadwalnya (bila diisi) sedang berlaku. */
export const SYARAT_BANNER_BERLAKU = `is_active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())`;

const POLA_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Data URL gambar dari admin menjadi { mime, isi }. Hanya JPEG, PNG, dan WebP
 * yang dilayani; isi lain (svg, html) ditolak supaya alamat gambar toko tidak
 * bisa dipakai menyajikan dokumen.
 */
export function bacaGambarBanner(dataUrl) {
  const m = POLA_DATA_URL.exec(String(dataUrl ?? ''));
  if (!m) return null;
  const isi = Buffer.from(m[2], 'base64');
  return isi.length ? { mime: m[1], isi } : null;
}

/**
 * Baris banner untuk katalog publik: tanpa isi gambar, dengan versi untuk alamat gambar.
 * Versi = potongan md5 isi gambar, jadi hanya berganti saat gambarnya diganti.
 */
export function bannerPublik(r) {
  return {
    id: r.id,
    title: r.title || null,
    link_url: r.link_url || null,
    v: r.versi,
    ada_hp: !!r.ada_hp,
  };
}
