/**
 * Pintu masuk konsol staf (pengamanan /login, 15 Okt 2026).
 *
 * Di produksi (build dengan VITE_ADMIN_GERBANG=true) formulir masuk staf hanya
 * tampil di alamat rahasia yang disimpan di server (ADMIN_LOGIN_PATH, bentuk
 * /pintu-<acak>). Server menandai halaman itu dengan window.KASIR_PINTU_ADMIN
 * dan memasang cookie gerbang yang diwajibkan /api/auth/signin. Alamat rahasia
 * tidak pernah ada di bundel ini, jadi tidak bisa dibaca dari JavaScript toko.
 *
 * Tanpa gerbang (pengembangan lokal, uji) /login tetap seperti biasa.
 */
export const GERBANG_ADMIN = import.meta.env.VITE_ADMIN_GERBANG === 'true';

export function diPintuAdmin(): boolean {
  return (window as { KASIR_PINTU_ADMIN?: boolean }).KASIR_PINTU_ADMIN === true;
}

/** Tujuan setelah staf keluar: toko di produksi (masuk lagi lewat alamat rahasia), /login di pengembangan. */
export const ALAMAT_SETELAH_KELUAR = GERBANG_ADMIN ? '/toko' : '/login';
