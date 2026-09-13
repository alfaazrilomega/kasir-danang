// Produk favorit pembeli (ikon hati di halaman produk), disimpan di perangkat.
import { create } from 'zustand';

const KEY = 'tokoku.wishlist.v1';

function baca(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface WishlistState {
  ids: string[];
  /** Balik status favorit; hasilnya true bila sekarang jadi favorit. */
  toggle: (id: string) => boolean;
}

export const useWishlist = create<WishlistState>((set, get) => ({
  ids: baca(),
  toggle: (id) => {
    const ada = get().ids.includes(id);
    const ids = ada ? get().ids.filter((x) => x !== id) : [...get().ids, id];
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      // Mode privat: favorit hanya bertahan selama halaman terbuka.
    }
    set({ ids });
    return !ada;
  },
}));
