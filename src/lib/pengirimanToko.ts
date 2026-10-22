// Wilayah dan ongkir KiriminAja untuk checkout (spec 0002). Selama toko belum
// memasang KiriminAja, server menjawab active:false dan checkout memakai daftar
// wilayah bawaan dengan keterangan "ongkir dihitung toko".

import { loadConfig, PUBLIC_STORE_ID } from './config';

export type LevelWilayah = 'provinsi' | 'kota' | 'kecamatan' | 'kelurahan';

export interface ItemWilayah {
  id: number;
  nama: string;
}

/** Wilayah tujuan versi KiriminAja; ID null berarti belum dipilih. */
export interface WilayahKirim {
  provinsi_id: number | null;
  provinsi: string;
  kota_id: number | null;
  kota: string;
  kecamatan_id: number | null;
  kecamatan: string;
  kelurahan_id: number | null;
  kelurahan: string;
}

export const WILAYAH_KOSONG: WilayahKirim = {
  provinsi_id: null, provinsi: '', kota_id: null, kota: '',
  kecamatan_id: null, kecamatan: '', kelurahan_id: null, kelurahan: '',
};

export const wilayahLengkap = (w: WilayahKirim) =>
  !!(w.provinsi_id && w.kota_id && w.kecamatan_id && w.kelurahan_id);

export interface OpsiOngkir {
  courier: string;
  service: string;
  nama: string;
  ongkir: number;
  etd: string;
  grup: string;
}

const simpanan = new Map<string, Promise<{ active: boolean; items: ItemWilayah[] }>>();

/** Daftar wilayah satu tingkat. Jawaban yang berhasil disimpan selama halaman terbuka. */
export function ambilWilayah(level: LevelWilayah, induk?: number | null): Promise<{ active: boolean; items: ItemWilayah[] }> {
  const kunci = `${level}:${induk ?? ''}`;
  const ada = simpanan.get(kunci);
  if (ada) return ada;
  const { apiBaseUrl } = loadConfig();
  const qs = new URLSearchParams({ store_id: PUBLIC_STORE_ID, level, ...(induk ? { induk: String(induk) } : {}) });
  const janji = fetch(`${apiBaseUrl}/api/public/wilayah?${qs}`)
    .then(async (res) => {
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data) {
        // aktif = KiriminAja dipakai toko walau daftarnya sedang gagal dimuat.
        throw Object.assign(new Error(json?.error || 'Daftar wilayah belum dapat dimuat.'), { aktif: json?.active === true });
      }
      return { active: !!json.data.active, items: (json.data.items ?? []) as ItemWilayah[] };
    })
    .catch((error) => {
      simpanan.delete(kunci);
      throw error;
    });
  simpanan.set(kunci, janji);
  return janji;
}

/** Pilihan kurir untuk tujuan dan isi keranjang. Berat dan ongkir dihitung server. */
export async function ambilOngkir(input: {
  kecamatan_id: number;
  kelurahan_id: number;
  items: { product_id: string; qty: number }[];
}): Promise<{ active: boolean; options: OpsiOngkir[]; error?: string }> {
  const { apiBaseUrl } = loadConfig();
  try {
    const res = await fetch(`${apiBaseUrl}/api/public/shipping-rates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: PUBLIC_STORE_ID, ...input }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.data) return { active: true, options: [], error: json?.error || 'Ongkir belum dapat dihitung. Coba lagi.' };
    return { active: !!json.data.active, options: json.data.options ?? [] };
  } catch {
    return { active: true, options: [], error: 'Tidak bisa terhubung ke server. Cek koneksi internet.' };
  }
}

/** "JNE REG · 2-3 hari" */
export function labelOpsi(o: Pick<OpsiOngkir, 'nama' | 'service' | 'etd'>) {
  const nama = o.nama.toUpperCase().includes(o.service.toUpperCase()) ? o.nama : `${o.nama} ${o.service}`;
  return o.etd ? `${nama} · ${/hari|day/i.test(o.etd) ? o.etd : `${o.etd} hari`}` : nama;
}
