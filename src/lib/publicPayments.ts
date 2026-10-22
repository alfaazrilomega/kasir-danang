// Kanal pembayaran otomatis (Tripay) untuk checkout toko online.
//
// Selama kunci Tripay belum dipasang, endpoint menjawab active:false dan
// checkout hanya menampilkan metode manual (COD, transfer, QRIS statis).

import { loadConfig, PUBLIC_STORE_ID } from '@/lib/config';

export interface KanalBayar {
  code: string;
  name: string;
  description?: string;
  group: string;
  type?: string;
  active?: boolean;
  icon_url?: string | null;
  fee_flat?: number;
  fee_percent?: number;
  fee_customer?: number | null;
  minimum_amount?: number;
  maximum_amount?: number;
}

export interface KanalBayarResponse {
  provider?: 'tripay' | 'mayar' | 'doku' | null;
  /** Terisi bila layanan utama gangguan dan daftar ini dari layanan cadangan. */
  cadangan_dari?: string | null;
  active: boolean;
  mode: 'sandbox' | 'production' | null;
  channels: KanalBayar[];
  amount?: number | null;
  error?: string;
}

const KOSONG: KanalBayarResponse = { active: false, mode: null, channels: [] };

export async function fetchKanalBayar(amount?: number): Promise<KanalBayarResponse> {
  try {
    const { apiBaseUrl } = loadConfig();
    const res = await fetch(`${apiBaseUrl}/api/public/payment-channels?store_id=${encodeURIComponent(PUBLIC_STORE_ID)}${amount ? `&amount=${amount}` : ''}`, { cache: 'no-store' });
    const json = (await res.json()) as { data?: KanalBayarResponse; error?: string };
    if (!res.ok || !json.data) return { ...KOSONG, error: json.error || 'Pilihan pembayaran gagal dimuat. Coba lagi.' };
    return json.data;
  } catch {
    return { ...KOSONG, error: 'Tidak dapat memuat metode pembayaran. Periksa koneksi lalu coba lagi.' };
  }
}

/** Biaya kanal untuk satu nominal; dipakai menampilkan "+ Rp x" di baris kanal. */
export function biayaKanal(kanal: KanalBayar, jumlah: number): number {
  if (kanal.fee_customer != null) return Number(kanal.fee_customer);
  const flat = Number(kanal.fee_flat ?? 0);
  const percent = Number(kanal.fee_percent ?? 0);
  return Math.round(flat + (jumlah * percent) / 100);
}

export function nominalKanalSah(kanal: KanalBayar, jumlah: number): boolean {
  return jumlah >= Number(kanal.minimum_amount || 0)
    && (!kanal.maximum_amount || jumlah <= Number(kanal.maximum_amount));
}
