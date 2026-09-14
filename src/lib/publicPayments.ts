// Kanal pembayaran otomatis (Tripay) untuk checkout toko online.
//
// Selama kunci Tripay belum dipasang, endpoint menjawab active:false dan
// checkout hanya menampilkan metode manual (COD, transfer, QRIS statis).

import { loadConfig } from '@/lib/config';

export interface KanalBayar {
  code: string;
  name: string;
  group: string;
  icon_url?: string | null;
  fee_flat?: number;
  fee_percent?: number;
  minimum_amount?: number;
  maximum_amount?: number;
}

export interface KanalBayarResponse {
  active: boolean;
  mode: 'sandbox' | 'production' | null;
  channels: KanalBayar[];
}

const KOSONG: KanalBayarResponse = { active: false, mode: null, channels: [] };

export async function fetchKanalBayar(): Promise<KanalBayarResponse> {
  try {
    const { apiBaseUrl } = loadConfig();
    const res = await fetch(`${apiBaseUrl}/api/public/payment-channels`);
    if (!res.ok) return KOSONG;
    const json = (await res.json()) as { data?: KanalBayarResponse };
    return json.data ?? KOSONG;
  } catch {
    return KOSONG;
  }
}

/** Biaya kanal untuk satu nominal; dipakai menampilkan "+ Rp x" di baris kanal. */
export function biayaKanal(kanal: KanalBayar, jumlah: number): number {
  const flat = Number(kanal.fee_flat ?? 0);
  const percent = Number(kanal.fee_percent ?? 0);
  return Math.round(flat + (jumlah * percent) / 100);
}
