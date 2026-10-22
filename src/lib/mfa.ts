import { loadConfig } from '@/lib/config';

/**
 * Verifikasi dua langkah staf (TOTP), 15 Okt 2026. Endpoint ada di server
 * (/api/auth/mfa/*). Modul ini terpisah dari lib/api.ts supaya tidak mengubah
 * klien API bersama.
 */

// Sama dengan TOKEN_KEY di lib/api.ts (tidak diekspor): sesi hasil langkah kedua
// disimpan di tempat yang sama dengan sesi hasil signInWithPassword.
const KUNCI_TOKEN = 'kasir.auth.token.v1';

export interface StatusMfa {
  available: boolean;
  enabled: boolean;
  recovery_left: number;
}

export interface SesiMfa {
  user: { id: string; email: string; store_id?: string | null; role?: string | null };
  session: { access_token: string };
}

async function panggil<T>(jalur: string, opsi: { method?: string; body?: unknown; masuk?: boolean } = {}): Promise<{ data: T | null; error: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opsi.masuk ? null : localStorage.getItem(KUNCI_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(`${loadConfig().apiBaseUrl}${jalur}`, {
      method: opsi.method ?? 'GET',
      headers,
      body: opsi.body === undefined ? undefined : JSON.stringify(opsi.body),
    });
    const teks = await r.text();
    const isi = teks ? (JSON.parse(teks) as Record<string, unknown>) : {};
    if (!r.ok) return { data: null, error: String(isi.error ?? 'Permintaan gagal.') };
    return { data: ('data' in isi ? isi.data : isi) as T, error: null };
  } catch {
    return { data: null, error: 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.' };
  }
}

export const mfaApi = {
  status: () => panggil<StatusMfa>('/api/auth/mfa'),
  setup: () => panggil<{ secret: string; otpauth: string }>('/api/auth/mfa/setup', { method: 'POST', body: {} }),
  enable: (code: string) => panggil<{ recovery_codes: string[] }>('/api/auth/mfa/enable', { method: 'POST', body: { code } }),
  disable: (password: string, code: string) => panggil<{ enabled: false }>('/api/auth/mfa/disable', { method: 'POST', body: { password, code } }),
  verify: (mfaToken: string, code: string) => panggil<SesiMfa>('/api/auth/mfa/verify', { method: 'POST', body: { mfa_token: mfaToken, code }, masuk: true }),
  resetUser: (userId: string) => panggil<{ enabled: false }>(`/api/admin/users/${encodeURIComponent(userId)}/mfa/reset`, { method: 'POST', body: {} }),
};

export function simpanTokenSesi(token: string) {
  localStorage.setItem(KUNCI_TOKEN, token);
}
