// Voucher di checkout toko online: kode promo yang dibuat admin di menu Promo.
// Rumus diskon sama dengan server/voucherToko.js; server tetap menghitung ulang
// saat pesanan dibuat.

import { loadConfig } from './config';

export interface VoucherToko {
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
}

/** Diskon voucher untuk subtotal barang, dibulatkan ke rupiah, tidak melebihi subtotal. */
export function diskonVoucher(voucher: VoucherToko | null, subtotal: number): number {
  if (!voucher) return 0;
  const dasar = Math.max(0, subtotal);
  const nilai = Math.max(0, Number(voucher.value) || 0);
  const diskon = voucher.type === 'percent' ? Math.round((dasar * Math.min(nilai, 100)) / 100) : Math.round(nilai);
  return Math.min(diskon, dasar);
}

export async function cekVoucher(storeId: string, code: string): Promise<{ data: VoucherToko | null; error: string | null }> {
  const { apiBaseUrl } = loadConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/api/public/voucher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, code }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: body?.error || 'Kode voucher tidak dapat diperiksa.' };
    return { data: body.data as VoucherToko, error: null };
  } catch {
    return { data: null, error: 'Koneksi terputus. Coba lagi.' };
  }
}
