// Keranjang storefront publik (checkout tanpa login). Sengaja TIDAK memakai
// src/stores/cart.ts — itu keranjang kasir, penuh konsep POS (meja, shift,
// parked order) yang tidak relevan buat pengunjung anonim. Harga di sini
// cuma untuk tampilan; server menghitung ulang harga saat checkout, jadi
// tidak ada bahaya kalau nilainya sempat basi di localStorage pengunjung.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PublicCartLine {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  image_url?: string | null;
}

interface PublicCartState {
  lines: PublicCartLine[];
  /**
   * "Beli Sekarang" dari halaman detail produk: satu item yang mau langsung
   * dibeli TANPA menyentuh keranjang biasa (persis seperti Shopee/Lazada —
   * beli sekarang tidak ikut mengubah isi keranjang orang).
   */
  buyNow: PublicCartLine | null;
  add: (line: Omit<PublicCartLine, 'qty'>, qty?: number) => void;
  updateQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  setBuyNow: (line: PublicCartLine) => void;
  clearBuyNow: () => void;
}

export const usePublicCart = create<PublicCartState>()(
  persist(
    (set, get) => ({
      lines: [],
      buyNow: null,
      add: (line, qty = 1) => {
        const existing = get().lines.find((l) => l.product_id === line.product_id);
        if (existing) {
          set({
            lines: get().lines.map((l) =>
              l.product_id === line.product_id ? { ...l, qty: l.qty + qty } : l,
            ),
          });
          return;
        }
        set({ lines: [...get().lines, { ...line, qty }] });
      },
      updateQty: (productId, qty) => {
        if (qty <= 0) {
          set({ lines: get().lines.filter((l) => l.product_id !== productId) });
          return;
        }
        set({
          lines: get().lines.map((l) => (l.product_id === productId ? { ...l, qty } : l)),
        });
      },
      remove: (productId) => set({ lines: get().lines.filter((l) => l.product_id !== productId) }),
      clear: () => set({ lines: [] }),
      setBuyNow: (line) => set({ buyNow: line }),
      clearBuyNow: () => set({ buyNow: null }),
    }),
    { name: 'tokoku.public_cart.v1' },
  ),
);
