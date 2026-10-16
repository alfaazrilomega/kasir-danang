import { create } from 'zustand';
import type { Profile, Store } from '@/types';
import { getBackendClient } from '@/lib/api';
import { db } from '@/lib/db';
import { setCapabilityOverrides } from '@/lib/roles';
import { isUuid } from '@/lib/format';
import { pullRolePermissions } from '@/lib/sync';

/**
 * Kolom toko yang diambil ulang tiap menit oleh refreshStore. Empat kolom
 * gambar (logo, tanda tangan, QRIS, banner) sengaja tidak ikut: isinya base64,
 * baris toko produksi 69 KB karenanya, dan gambar cukup dimuat saat login.
 */
const KOLOM_TOKO_RINGAN = [
  'id', 'name', 'address', 'currency', 'tax_rate', 'receipt_header', 'receipt_footer',
  'points_per_amount', 'low_stock_threshold', 'industry', 'features', 'created_at',
  'invoice_signer_name', 'shop_phone', 'return_policy', 'warranty_info', 'shop_city',
  'bank_name', 'bank_account_number', 'bank_account_name',
  'social_facebook', 'social_instagram', 'social_tiktok', 'social_youtube',
  'footer_links', 'chat_enabled',
  'meta_pixel_id', 'tiktok_pixel_id', 'google_ads_id', 'google_ads_purchase_label',
].join(',');

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
  /** Ambil ulang baris toko (pajak, struk, fitur) tanpa memuat ulang profil. */
  refreshStore: () => Promise<void>;
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

    // Masuk lewat server: katalog, shift, dan transaksi selalu diambil dari server.
    // Data demo acak TIDAK lagi dibuat otomatis di perangkat baru. Dulu seed ini
    // ikut didorong ke server sehingga toko asli terisi produk & pesanan palsu,
    // dan shift demo yang tidak ada di server membuat penjualan kasir ditolak.

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

  // Pengaturan toko dulu hanya dimuat saat aplikasi dibuka atau login. Jendela
  // kasir yang terbuka seharian tetap menghitung pajak dengan cara lama setelah
  // admin mengubah "Harga sudah termasuk pajak" di perangkat lain (video client
  // 28 Sep: dua pesanan malam yang sama dihitung berbeda).
  async refreshStore() {
    const current = get().store;
    // Toko belum termuat berarti login atau refreshProfile masih berjalan dan
    // dialah yang memuat baris lengkapnya. Di sini hanya kolom ringan yang
    // diambil, jadi tanpa baris awal hasilnya toko tanpa logo dan tanda tangan.
    if (!current) return;
    const storeId = get().sessionStoreId || current.id || null;
    if (!get().userId || !storeId || !isUuid(storeId)) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const { data, error } = await getBackendClient()
        .from('stores')
        .select(KOLOM_TOKO_RINGAN)
        .eq('id', storeId)
        .maybeSingle();
      if (error || !data) return;
      const terbaru = data as Partial<Store>;
      // Saat database tidak terjangkau, server menjawab kueri stores dengan
      // toko contoh (id lain, pajak 10%) tanpa galat. Jawaban untuk toko lain
      // tidak boleh menimpa pengaturan toko yang sedang berjualan.
      if (terbaru.id !== storeId) return;
      // Jawaban yang lambat tidak boleh menimpa toko yang sementara itu sudah
      // berganti: disimpan dari Pengaturan, atau sesinya keluar.
      if (get().store !== current || (get().sessionStoreId || current.id || null) !== storeId) return;
      const fresh = { ...current, ...terbaru } as Store;
      // Tanpa perubahan tidak perlu memicu render ulang seluruh aplikasi.
      if (JSON.stringify(current) === JSON.stringify(fresh)) return;
      await db.stores.put(fresh);
      set({ store: fresh });
    } catch {
      // Offline atau server sibuk: pakai salinan yang ada.
    }
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
