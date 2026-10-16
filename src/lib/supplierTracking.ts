// Tracking nota supplier: di tahap mana barang dan pembayarannya sekarang.
// Dipakai kartu Tracking Supplier di Dashboard dan modal Tracking di halaman
// Supplier, supaya keduanya membaca status dengan aturan yang sama.
import type { Purchase } from '@/types';

export type TahapNota = 'draft' | 'dipesan' | 'diterima' | 'lunas' | 'batal';

export interface StatusNota {
  tahap: TahapNota;
  label: string;
  /** Sisa yang belum dibayar, dalam rupiah. */
  sisa: number;
  /** Hari lewat dari perkiraan barang jadi, untuk barang yang belum diterima. */
  telatTerima: number;
  /** Hari menuju jatuh tempo (negatif = sudah lewat). null bila tidak ada tempo atau sudah lunas. */
  hariKeJatuhTempo: number | null;
}

const LABEL: Record<TahapNota, string> = {
  draft: 'Draf',
  dipesan: 'Menunggu barang',
  diterima: 'Diterima, belum lunas',
  lunas: 'Selesai',
  batal: 'Dibatalkan',
};

function awalHari(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function selisihHari(tanggal: string, hariIni: Date): number {
  const d = new Date(`${tanggal.slice(0, 10)}T00:00:00`);
  return Math.round((awalHari(hariIni).getTime() - d.getTime()) / 86400000);
}

export function statusNota(p: Purchase, hariIni = new Date()): StatusNota {
  const sisa = Math.max(0, Number(p.total) - Number(p.paid_amount ?? 0));
  if (p.status === 'canceled') {
    return { tahap: 'batal', label: LABEL.batal, sisa: 0, telatTerima: 0, hariKeJatuhTempo: null };
  }
  const diterima = !!p.received_at;
  const lunas = sisa < 1;
  const tahap: TahapNota = p.status === 'draft' ? 'draft' : !diterima ? 'dipesan' : lunas ? 'lunas' : 'diterima';
  const telatTerima = !diterima && p.expected_date ? Math.max(0, selisihHari(p.expected_date, hariIni)) : 0;
  const hariKeJatuhTempo = !lunas && p.due_date ? -selisihHari(p.due_date, hariIni) : null;
  return { tahap, label: LABEL[tahap], sisa, telatTerima, hariKeJatuhTempo };
}

export const NADA_TAHAP: Record<TahapNota, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  dipesan: 'info',
  diterima: 'warning',
  lunas: 'success',
  batal: 'neutral',
};
