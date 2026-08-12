// Channel penjualan: offline (kasir) vs marketplace.
//
// Toko bisa menambah channel sendiri lewat Settings; daftar bawaan di bawah
// dipakai sebagai fallback supaya POS tetap jalan sebelum admin sempat
// mengatur apa pun.

import type { SalesChannel } from '@/types';

export interface ChannelSeed {
  code: string;
  name: string;
  fee_percent: number;
  default_term_days: number;
}

export const DEFAULT_CHANNELS: ChannelSeed[] = [
  { code: 'offline', name: 'Offline / Kasir', fee_percent: 0, default_term_days: 0 },
  { code: 'shopee', name: 'Shopee', fee_percent: 8, default_term_days: 14 },
  { code: 'tiktok', name: 'TikTok Shop', fee_percent: 8, default_term_days: 14 },
  { code: 'tokopedia', name: 'Tokopedia', fee_percent: 6, default_term_days: 14 },
];

export const OFFLINE_CHANNEL = 'offline';

/** Daftar channel yang dipakai UI: data toko kalau ada, kalau kosong pakai bawaan. */
export function resolveChannels(rows: SalesChannel[]): ChannelSeed[] {
  const active = rows.filter((row) => row.is_active);
  if (active.length === 0) return DEFAULT_CHANNELS;
  return [...active]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((row) => ({
      code: row.code,
      name: row.name,
      fee_percent: Number(row.fee_percent),
      default_term_days: row.default_term_days,
    }));
}

export function channelLabel(code: string | null | undefined, rows: SalesChannel[]): string {
  if (!code) return 'Offline / Kasir';
  const found = rows.find((row) => row.code === code);
  if (found) return found.name;
  return DEFAULT_CHANNELS.find((row) => row.code === code)?.name ?? code;
}

export function channelFeePercent(code: string | null | undefined, rows: SalesChannel[]): number {
  if (!code) return 0;
  const found = rows.find((row) => row.code === code);
  if (found) return Number(found.fee_percent);
  return DEFAULT_CHANNELS.find((row) => row.code === code)?.fee_percent ?? 0;
}

/** Channel non-offline dianggap marketplace: default tempo & kena potongan. */
export function isMarketplace(code: string | null | undefined): boolean {
  return Boolean(code) && code !== OFFLINE_CHANNEL;
}
