import { create } from 'zustand';
import type { Profile, Store } from '@/types';
import { getBackendClient } from '@/lib/api';
import { db } from '@/lib/db';
import { setCapabilityOverrides } from '@/lib/roles';
import { isUuid } from '@/lib/format';
import { pullRolePermissions } from '@/lib/sync';

interface AuthState {
  loading: boolean;
  ready: boolean;
  userId: string | null;
  /** store_id otoritatif dari sesi; dipakai agar tidak menebak dari profiles. */
  sessionStoreId: string | null;
  profile: Profile | null;
  store: Store | null;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  loading: false,
  ready: false,
  userId: null,
  sessionStoreId: null,
  profile: null,
  store: null,

  async init() {
    set({ loading: true });

    const api = getBackendClient();
    try {
      const { data } = await api.auth.getSession();
      const userId = data.session?.user.id ?? null;
      set({ userId, sessionStoreId: data.session?.user.store_id ?? null });
      if (userId) await get().refreshProfile();
      api.auth.onAuthStateChange(async (_event, session) => {
        const uid = session?.user.id ?? null;
        set({ userId: uid, sessionStoreId: session?.user.store_id ?? null });
        if (uid) await get().refreshProfile();
        else set({ profile: null, store: null });
      });
    } catch {
      set({ userId: null, profile: null, store: null });
    } finally {
      set({ loading: false, ready: true });
    }
  },

  async refreshProfile() {
    const api = getBackendClient();
    const uid = get().userId;
    if (!uid) return;

    // store_id dari sesi adalah sumber kebenaran: server memakai nilai ini
    // untuk memvalidasi setiap penulisan. Diambil dari state yang sudah diisi
    // saat login/init — TIDAK memanggil getSession() lagi di sini, karena
    // panggilan tambahan itu pernah membuat pengguna terlempar ke login saat
    // servernya sibuk.
    const sessionStoreId = get().sessionStoreId;

    let profile: Profile | null = null;
    let store: Store | null = null;

    try {
      // profiles.id bertipe uuid. Akun demo memakai id seperti
      // 'usr-cashier-001', dan mengirimnya ke server hanya menghasilkan 400
      // (22P02) berulang di konsol tanpa pernah bisa berhasil.
      if (isUuid(uid)) {
        const { data } = await api
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .maybeSingle();
        profile = (data as Profile) ?? null;
      }
    } catch {
      // offline fallback
    }

    let localStore = await db.stores.toCollection().first();
    if (!localStore) {
      localStore = {
        id: 'store-default-001',
        name: 'TokoKu',
        currency: 'IDR',
        tax_rate: 10,
        points_per_amount: 0.01,
        low_stock_threshold: 10,
        created_at: new Date().toISOString(),
      };
      await db.stores.put(localStore);
    }

    // Toko yang benar ditentukan oleh SESI, bukan oleh salinan lokal.
    //
    // Akun demo tidak punya baris di tabel profiles, jadi `profile` di atas
    // null. Dulu cabang ini ikut gagal dan toko jatuh ke 'store-default-001'
    // bawaan offline. Akibatnya seed menulis produk dengan store_id palsu itu,
    // sementara POS menyaring memakai store_id dari sesi — katalog tampak
    // kosong padahal datanya ada.
    const storeIdSesi = sessionStoreId || profile?.store_id || null;
    if (storeIdSesi) {
      try {
        const { data: remoteStore } = await api
          .from('stores')
          .select('*')
          .eq('id', storeIdSesi)
          .maybeSingle();
        store = (remoteStore as Store) ?? { ...localStore, id: storeIdSesi };
        await db.stores.put(store);
      } catch {
        // Offline: pakai salinan lokal, tapi tetap dengan id dari sesi supaya
        // data yang ditulis nanti tidak nyasar ke toko yang salah.
        store = { ...localStore, id: storeIdSesi };
      }
    } else {
      store = localStore;
    }

    const demoRoles: Record<string, { role: 'admin' | 'warehouse' | 'cashier' | 'customer'; name: string; email: string }> = {
      'usr-admin-001': { role: 'admin', name: 'Admin Kasir', email: 'admin@example.com' },
      'usr-warehouse-001': { role: 'warehouse', name: 'Staff Gudang', email: 'gudang@example.com' },
      'usr-cashier-001': { role: 'cashier', name: 'Kasir Toko', email: 'kasir@example.com' },
      'usr-customer-001': { role: 'customer', name: 'Pelanggan Toko', email: 'customer@example.com' },
    };
    const foundDemo = uid ? demoRoles[uid] : null;

    const prodCount = await db.products.count();
    if (prodCount < 20) {
      try {
        const { generate1000Data, pushSeedToServer } = await import('@/lib/seed1000');
        await generate1000Data(store.id, uid);
        // Dorong ke server supaya data demo juga ada di Postgres; tanpa ini
        // fitur yang menyentuh product_id lewat API selalu gagal.
        //
        // Sengaja TIDAK di-await: unggahannya ribuan baris dan akan menahan
        // layar login belasan detik. Data lokal sudah siap dipakai, dorongan
        // ke server berjalan di belakang.
        void pushSeedToServer()
          .then((res) => {
            if (res.failures.length) console.warn('[Seed push]', res.failures);
            else console.info(`[Seed push] ${res.pushed} baris terkirim ke server.`);
          })
          .catch((err) => console.warn('[Seed push] gagal:', err));
        store = (await db.stores.toCollection().first()) ?? store;
      } catch (err) {
        console.warn('[Seed Data Error]:', err);
      }
    }

    const resolvedProfile: Profile = {
      id: uid,
      store_id: sessionStoreId || profile?.store_id || store.id,
      full_name: profile?.full_name || foundDemo?.name || 'Admin Kasir',
      email: profile?.email || foundDemo?.email || 'admin@example.com',
      role: profile?.role || foundDemo?.role || 'admin',
    };

    // Pembatasan hak akses toko dimuat sebelum UI dirender supaya menu yang
    // dimatikan tidak sempat berkedip muncul.
    try {
      await pullRolePermissions(store.id);
      setCapabilityOverrides(await db.role_permissions.where('store_id').equals(store.id).toArray());
    } catch {
      // biarkan default kode kalau gagal
    }

    set({ profile: resolvedProfile, store });
  },

  async signIn(email, password) {
    const api = getBackendClient();
    try {
      const { data, error } = await api.auth.signInWithPassword({ email, password });
      if (!error && data?.user) {
        set({ userId: data.user.id, sessionStoreId: data.user.store_id ?? null });
        await get().refreshProfile();
        return {};
      }
    } catch {
      // fallback to offline local accounts
    }

    // Demo / Offline fallback accounts for all 4 roles
    const normalized = email.trim().toLowerCase();
    const demoRoles: Record<string, { role: 'admin' | 'warehouse' | 'cashier' | 'customer'; name: string; id: string }> = {
      'admin@example.com': { role: 'admin', name: 'Admin Kasir', id: 'usr-admin-001' },
      'gudang@example.com': { role: 'warehouse', name: 'Staff Gudang', id: 'usr-warehouse-001' },
      'kasir@example.com': { role: 'cashier', name: 'Kasir Toko', id: 'usr-cashier-001' },
      'customer@example.com': { role: 'customer', name: 'Pelanggan Toko', id: 'usr-customer-001' },
    };

    const demo = demoRoles[normalized] ?? {
      role: 'admin' as const,
      name: normalized.split('@')[0] || 'User Kasir',
      id: 'usr-' + (normalized.split('@')[0] || 'admin'),
    };

    let store: Store | undefined = await db.stores.toCollection().first();
    if (!store) {
      const newStore: Store = {
        id: 'store-default-001',
        name: 'TokoKu',
        currency: 'IDR',
        tax_rate: 10,
        points_per_amount: 0.01,
        low_stock_threshold: 10,
        created_at: new Date().toISOString(),
      };
      await db.stores.put(newStore);
      store = newStore;
    }

    const prodCount = await db.products.count();
    if (prodCount < 20) {
      const { generate1000Data } = await import('@/lib/seed1000');
      await generate1000Data(store.id, demo.id);
      store = (await db.stores.toCollection().first()) ?? store;
    }

    const profile: Profile = {
      id: demo.id,
      store_id: store.id,
      full_name: demo.name,
      email: normalized,
      role: demo.role,
    };

    set({ userId: demo.id, sessionStoreId: store.id, profile, store });
    return {};
  },

  async signOut() {
    set({ userId: null, sessionStoreId: null, profile: null, store: null });
    try {
      await getBackendClient().auth.signOut();
    } catch {
      // ignore
    }
  },
}));
