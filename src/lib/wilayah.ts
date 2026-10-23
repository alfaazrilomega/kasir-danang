// Daftar provinsi dan kota/kabupaten Indonesia.
//
// Datanya ikut dibundel (25 KB) alih-alih diambil dari API luar saat halaman
// dibuka: checkout harus tetap jalan walau jaringan pembeli buruk, dan daftar
// wilayah nyaris tidak pernah berubah. Sumbernya api-wilayah-indonesia
// (MIT, data Kemendagri): 38 provinsi, 514 kota/kabupaten.

import data from '@/data/wilayah.json';

export interface Kota {
  kode: string;
  nama: string;
}

export interface Kecamatan extends Kota {
  desa: Kota[];
}

const cacheKecamatan = new Map<string, Promise<Kecamatan[]>>();

/** Data lokal dimuat per kota agar daftar desa seluruh Indonesia tidak masuk bundel utama. */
export function kecamatanDari(provinsi: string, kota: string): Promise<Kecamatan[]> {
  const kode = kotaDari(provinsi).find((k) => k.nama === kota)?.kode;
  if (!kode) return Promise.resolve([]);
  const cached = cacheKecamatan.get(kode);
  if (cached) return cached;
  const promise = fetch(`${import.meta.env.BASE_URL}wilayah/${kode}.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error('Gagal memuat daftar wilayah.');
      const rows: Kecamatan[] = await res.json();
      if (!Array.isArray(rows) || !rows.length || rows.some((r) => !r.nama || !Array.isArray(r.desa))) {
        throw new Error('Data wilayah tidak tersedia.');
      }
      return rows.map((r) => ({ ...r, desa: [...r.desa].sort((a, b) => a.nama.localeCompare(b.nama, 'id')) }))
        .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    })
    .catch((error) => {
      cacheKecamatan.delete(kode);
      throw error;
    });
  cacheKecamatan.set(kode, promise);
  return promise;
}

export interface Provinsi {
  kode: string;
  nama: string;
  kota: Kota[];
}

export const PROVINSI: Provinsi[] = (data as Provinsi[]).map((p) => ({
  ...p,
  kota: [...p.kota].sort((a, b) => a.nama.localeCompare(b.nama, 'id')),
})).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));

/** Kota/kabupaten milik satu provinsi; kosong bila provinsinya belum dipilih. */
export function kotaDari(namaProvinsi: string): Kota[] {
  if (!namaProvinsi) return [];
  return PROVINSI.find((p) => p.nama === namaProvinsi)?.kota ?? [];
}

/** Provinsi pemilik sebuah kota; dipakai memulihkan pilihan dari data lama. */
export function provinsiDariKota(namaKota: string): string {
  if (!namaKota) return '';
  return PROVINSI.find((p) => p.kota.some((k) => k.nama === namaKota))?.nama ?? '';
}

/** Alamat satu baris untuk struk, WhatsApp, dan daftar pesanan. */
export function alamatLengkap({ alamat, kelurahan, kecamatan, kota, provinsi }: {
  alamat: string; kelurahan?: string; kecamatan?: string; kota: string; provinsi: string;
}): string {
  return [alamat.trim(), kelurahan?.trim(), kecamatan?.trim() ? `Kec. ${kecamatan.trim()}` : '', kota.trim(), provinsi.trim()]
    .filter(Boolean).join(', ');
}
