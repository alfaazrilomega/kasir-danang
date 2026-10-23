import { atribusiMeta } from './pixelToko';
// Checkout storefront dengan token akun pembeli, terpisah dari sesi staf.

import { loadConfig } from './config';
import type { PaymentMethod } from '@/types';
import type { OpsiOngkir } from './pengirimanToko';

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
  /** Wilayah tujuan; dipakai menghitung ongkir saat KiriminAja aktif. */
  delivery_province?: string;
  delivery_city?: string;
  delivery_district?: string;
  delivery_village?: string;
  /** Metode manual, dipakai saat payment_channel tidak diisi. */
  payment_method: Extract<PaymentMethod, 'cash' | 'qris' | 'transfer'>;
  /** Kode kanal Tripay (mis. BRIVA, QRIS). Bila diisi, metode manual di atas diabaikan server. */
  payment_channel?: string;
  payment_provider?: 'tripay' | 'mayar' | 'doku';
  /** Wilayah KiriminAja (spec 0002); wajib saat KiriminAja toko aktif. */
  delivery_wilayah?: { provinsi_id: number; kota_id: number; kecamatan_id: number; kelurahan_id: number };
  /** Kurir pilihan pembeli; ongkirnya diperiksa ulang server. */
  shipping?: { courier: string; service: string; ongkir: number };
  notes?: string;
  items: PublicOrderItemInput[];
  /** Kode voucher (promo toko); server memeriksa ulang dan menghitung diskonnya. */
  promo_code?: string;
}

export interface PublicOrderPayment {
  checkout_mode?: 'direct' | 'redirect';
  provider?: 'tripay' | 'mayar' | 'doku';
  /** Layanan asal bila pembayaran dipindah ke cadangan. */
  pindah_dari?: string;
  channel: string;
  channel_name?: string;
  reference?: string | null;
  checkout_url?: string | null;
  pay_code?: string | null;
  qr_url?: string | null;
  expired_time?: number | null;
  amount?: number;
  fee_customer?: number;
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
): Promise<{ data: PublicOrderResult | null; error: string | null; shippingOptions?: OpsiOngkir[] }> {
  const { apiBaseUrl } = loadConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/api/public/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ ...input, tracking: atribusiMeta() }),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { data?: PublicOrderResult; error?: string; shipping_options?: OpsiOngkir[] }) : null;
    if (!response.ok) {
      // 409 ongkir berubah: server mengirim daftar kurir terbaru (spec 0002, AC-11).
      return { data: null, error: payload?.error || 'Gagal mengirim pesanan.', shippingOptions: payload?.shipping_options };
    }
    return { data: payload?.data ?? null, error: null };
  } catch {
    return { data: null, error: 'Tidak bisa terhubung ke server. Cek koneksi internet.' };
  }
}
