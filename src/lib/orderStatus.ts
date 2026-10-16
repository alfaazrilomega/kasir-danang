import type { Order, OrderStatus } from '@/types';

/**
 * Pesanan yang boleh dihitung sebagai PENJUALAN NYATA di laporan, laba rugi,
 * dashboard, dan rekap shift.
 *
 * Bukan cuma "bukan canceled": pesanan dari storefront publik masuk dengan
 * status 'awaiting_confirmation' — belum dibayar, stoknya belum dipotong, dan
 * masih bisa ditolak staff. Menghitungnya sebagai penjualan membuat omzet
 * terlihat lebih besar dari kenyataan, dan labanya ikut salah karena HPP-nya
 * belum pernah tercatat.
 *
 * Kalau nanti ada status baru lagi, ubah di sini saja — jangan menyebar
 * perbandingan status ke tiap halaman.
 */
export function countsAsSale(order: Pick<Order, 'order_status'>): boolean {
  return isSaleStatus(order.order_status);
}

export function isSaleStatus(status: OrderStatus): boolean {
  return status !== 'canceled' && status !== 'awaiting_confirmation';
}

/** Pesanan web yang masih menunggu staff konfirmasi/tolak. */
export function isAwaitingConfirmation(order: Pick<Order, 'order_status'>): boolean {
  return order.order_status === 'awaiting_confirmation';
}
