export function formatMoney(value: number, currency = 'IDR'): string {
  try {
    return new Intl.NumberFormat(currency === 'IDR' ? 'id-ID' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'IDR' ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value);
}

export function formatDate(input: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opts,
  }).format(d);
}

export function formatDateTime(input: string | Date): string {
  return formatDate(input, { hour: '2-digit', minute: '2-digit' });
}

export interface OrderNumberOptions {
  id?: string;
  storeName?: string;
  platform?: string;
}

export function nextOrderNumber(opts?: OrderNumberOptions): string {
  // Format: [ID]-[NamaToko]-[Platform(website/TikTok/WhatsApp/dll)]
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestampId =
    now.getFullYear().toString().slice(-2) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());

  const idPart = opts?.id ? opts.id.trim() : timestampId;
  const rawStore = (opts?.storeName || 'Toko').trim().replace(/[^a-zA-Z0-9]+/g, '');
  const storePart = rawStore || 'Toko';
  const rawPlatform = (opts?.platform || 'Offline').trim().replace(/[^a-zA-Z0-9]+/g, '');
  const platformPart = rawPlatform || 'Offline';

  return `#${idPart}-${storePart}-${platformPart}`;
}

/**
 * Cek id benar-benar UUID. Dipakai sebelum mengirim kolom yang punya foreign
 * key ke server: data demo/offline memakai id buatan seperti 'shift-030' atau
 * 'usr-admin-001' yang tidak pernah ada di Postgres. Karena /api/query menelan
 * error database, id semacam itu akan membuat baris gagal tersimpan diam-diam.
 */
/**
 * Ambil pesan yang bisa dibaca dari apa pun yang dilempar.
 * Perlu karena api.from(...) mengembalikan objek biasa {message,status,code},
 * bukan instance Error — jadi `e instanceof Error ? e.message : 'gagal'` selalu
 * jatuh ke pesan generik dan menyembunyikan sebab aslinya dari pengguna.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

export function isUuid(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

export function convertCurrency(amount: number, exchangeRate: number): number {
  return amount * (exchangeRate > 0 ? exchangeRate : 1);
}

export function uuid(): string {
  // Browsers support crypto.randomUUID() in all PWA targets.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (RFC4122 v4)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
