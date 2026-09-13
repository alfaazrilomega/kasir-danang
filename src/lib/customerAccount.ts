// Akun pelanggan storefront (keputusan client: pelanggan memakai akun).
//
// Sengaja terpisah dari sesi staf (lib/api.ts): staf dan pembeli bisa memakai
// browser yang sama, dan token pembeli tidak boleh ikut terkirim ke /api/query
// milik staf, begitu juga sebaliknya.

import { create } from 'zustand';
import { loadConfig } from './config';

const TOKEN_KEY = 'tokoku.customer.token.v1';

export interface CustomerMe {
  email: string;
  name: string;
  phone: string | null;
  address: string | null;
}

export interface CustomerOrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface CustomerOrder {
  id: string;
  order_number: string;
  created_at: string;
  order_status: string;
  payment_status: string;
  total: number;
  shipping_cost: number;
  delivery_address: string | null;
  items: CustomerOrderItem[];
}

function bacaToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function simpanToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Mode privat: sesi hanya bertahan selama halaman terbuka.
  }
}

type Hasil<T> = { data: T | null; error: string | null; status: number };

async function panggil<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<Hasil<T>> {
  const { apiBaseUrl } = loadConfig();
  try {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as { data?: T; error?: string }) : null;
    if (!res.ok) return { data: null, error: payload?.error || 'Permintaan gagal.', status: res.status };
    return { data: (payload?.data ?? null) as T | null, error: null, status: res.status };
  } catch {
    return { data: null, error: 'Tidak bisa terhubung ke server. Cek koneksi internet.', status: 0 };
  }
}

interface CustomerState {
  token: string | null;
  me: CustomerMe | null;
  /** true setelah sesi tersimpan selesai diperiksa. */
  ready: boolean;
  masuk: (token: string, me?: CustomerMe | null) => void;
  muat: () => Promise<void>;
  keluar: () => void;
  setMe: (me: CustomerMe) => void;
}

export const useCustomer = create<CustomerState>((set, get) => ({
  token: bacaToken(),
  me: null,
  ready: !bacaToken(),
  masuk: (token, me = null) => {
    simpanToken(token);
    set({ token, me, ready: !!me });
    if (!me) void get().muat();
  },
  muat: async () => {
    const token = get().token;
    if (!token) {
      set({ ready: true });
      return;
    }
    const { data, status } = await panggil<CustomerMe>('/api/customer/me', { token });
    if (status === 401 || status === 403) {
      // Sesi kedaluwarsa atau bukan akun pembeli: keluarkan dengan bersih.
      simpanToken(null);
      set({ token: null, me: null, ready: true });
      return;
    }
    set({ me: data, ready: true });
  },
  keluar: () => {
    simpanToken(null);
    set({ token: null, me: null, ready: true });
  },
  setMe: (me) => set({ me }),
}));

type Sesi = { token: string; me: CustomerMe };

export function customerSignup(input: {
  store_id: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  privacy_accepted: boolean;
}) {
  return panggil<Sesi>('/api/customer/signup', { method: 'POST', body: input });
}

/** `identifier` boleh email atau nomor HP akun. */
export function customerSignin(input: { store_id: string; identifier: string; password: string }) {
  return panggil<Sesi>('/api/customer/signin', { method: 'POST', body: input });
}

/** Lupa kata sandi, langkah 1: kirim kode 6 digit ke email akun. */
export function lupaSandiKirimKode(input: { store_id: string; identifier: string }) {
  return panggil<{ ok: true }>('/api/customer/password/forgot', { method: 'POST', body: input });
}

/** Langkah 2: periksa kode tanpa memakainya. */
export function lupaSandiCekKode(input: { store_id: string; identifier: string; code: string }) {
  return panggil<{ ok: true }>('/api/customer/password/verify', { method: 'POST', body: input });
}

/** Langkah 3: simpan kata sandi baru; hasilnya langsung masuk. */
export function lupaSandiAturUlang(input: { store_id: string; identifier: string; code: string; password: string }) {
  return panggil<Sesi>('/api/customer/password/reset', { method: 'POST', body: input });
}

export function customerGoogle(input: { store_id: string; credential: string }) {
  return panggil<Sesi>('/api/customer/google', { method: 'POST', body: input });
}

export function fetchCustomerConfig() {
  return panggil<{ google_client_id: string | null }>('/api/customer/config');
}

export function updateCustomerMe(token: string, input: { name: string; phone: string; address: string }) {
  return panggil<CustomerMe>('/api/customer/me', { method: 'PATCH', body: input, token });
}

export function fetchCustomerOrders(token: string) {
  return panggil<CustomerOrder[]>('/api/customer/orders', { token });
}

export interface ReviewableItem {
  order_id: string;
  order_number: string;
  created_at: string;
  product_id: string;
  name: string;
  image_url: string | null;
  variant_name: string | null;
  reviewed: boolean;
}

export function fetchReviewable(token: string) {
  return panggil<ReviewableItem[]>('/api/customer/reviewable', { token });
}

export function submitReview(
  token: string,
  input: { order_id: string; product_id: string; rating: number; body: string; images: string[]; tags: string[] },
) {
  return panggil<{ ok: boolean }>('/api/customer/reviews', { method: 'POST', body: input, token });
}

/** Tag ulasan yang bisa dipilih pembeli (sama dengan daftar di server). */
export const TAG_ULASAN = [
  'Barang bagus',
  'Dikemas dengan baik',
  'Penjual ramah',
  'Kualitas tinggi',
  'Performa bagus',
  'Tiba lebih awal',
];
