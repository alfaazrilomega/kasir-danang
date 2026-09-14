// Checkout storefront publik (tanpa login). Terpisah dari KasirApiClient
// karena endpoint ini TIDAK butuh (dan tidak boleh mengirim) token sesi —
// lihat POST /api/public/orders di server/index.js.

import { loadConfig } from './config';
import type { PaymentMethod } from '@/types';

export interface PublicOrderItemInput {
  product_id: string;
  qty: number;
  size?: string | null;
  note?: string | null;
}

export interface PublicOrderInput {
  store_id: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  /** Transfer & QRIS masih manual (dicek staff); kanal otomatis menunggu Tripay. */
  payment_method: Extract<PaymentMethod, 'cash' | 'qris' | 'transfer'>;
  /** Kode kanal Tripay (mis. BRIVA, QRIS). Bila diisi, metode manual di atas diabaikan server. */
  payment_channel?: string;
  notes?: string;
  items: PublicOrderItemInput[];
}

export interface PublicOrderPayment {
  channel: string;
  channel_name?: string;
  reference?: string | null;
  checkout_url?: string | null;
  pay_code?: string | null;
  qr_url?: string | null;
  expired_time?: number | null;
  error?: string;
}

export interface PublicOrderResult {
  order_id: string;
  order_number: string;
  /** Terisi bila pesanan dibayar lewat kanal otomatis Tripay. */
  payment?: PublicOrderPayment | null;
}

export async function submitPublicOrder(
  input: PublicOrderInput,
  /** Token akun pembeli; pesanan dicatat atas nama akun ini. */
  customerToken: string,
): Promise<{ data: PublicOrderResult | null; error: string | null }> {
  const { apiBaseUrl } = loadConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/api/public/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { data?: PublicOrderResult; error?: string }) : null;
    if (!response.ok) {
      return { data: null, error: payload?.error || 'Gagal mengirim pesanan.' };
    }
    return { data: payload?.data ?? null, error: null };
  } catch {
    return { data: null, error: 'Tidak bisa terhubung ke server. Cek koneksi internet.' };
  }
}
