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

export function nextOrderNumber(): string {
  // #YYMMDD-HHMMSS, simple and human-readable. Replaced by server-side if needed.
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    '#' +
    now.getFullYear().toString().slice(-2) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
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
