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
export function alamatLengkap({ alamat, kota, provinsi }: { alamat: string; kota: string; provinsi: string }): string {
  return [alamat.trim(), kota.trim(), provinsi.trim()].filter(Boolean).join(', ');
}
