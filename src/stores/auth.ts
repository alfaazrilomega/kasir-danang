import { create } from 'zustand';
import type { Profile, Store } from '@/types';
import { getBackendClient } from '@/lib/api';
import { db } from '@/lib/db';

interface AuthState {
  loading: boolean;
  ready: boolean;
  userId: string | null;
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
  profile: null,
  store: null,

  async init() {
    set({ loading: true });

    const api = getBackendClient();
    try {
      const { data } = await api.auth.getSession();
      const userId = data.session?.user.id ?? null;
      set({ userId });
      if (userId) await get().refreshProfile();
      api.auth.onAuthStateChange(async (_event, session) => {
        const uid = session?.user.id ?? null;
        set({ userId: uid });
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

    const { data: profile } = await api
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    set({ profile: (profile as Profile) ?? null });

    if (profile?.store_id) {
      const { data: store } = await api
        .from('stores')
        .select('*')
        .eq('id', profile.store_id)
        .maybeSingle();
      set({ store: (store as Store) ?? null });
      if (store) {
        await db.stores.put(store as Store);
      }
    } else {
      set({ store: null });
    }
  },

  async signIn(email, password) {
    const api = getBackendClient();
    const { data, error } = await api.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    // Set userId synchronously so refreshProfile + ProtectedRoute see the
    // session immediately, instead of racing the async onAuthStateChange event.
    set({ userId: data.user?.id ?? null });
    await get().refreshProfile();
    return {};
  },

  async signOut() {
    // Clear local session/state first so the UI signs out even if the
    // network call to revoke the token fails (offline or expired session).
    set({ userId: null, profile: null, store: null });
    try {
      await getBackendClient().auth.signOut();
    } catch {
      // ignore — local sign-out already applied
    }
  },
}));
