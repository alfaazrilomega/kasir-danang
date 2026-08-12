import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ACCENT } from '@/lib/accents';

export type MenuDensity = 'comfy' | 'compact';
export type MenuSort = 'name' | 'price-asc' | 'price-desc' | 'popular';

interface UIState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  accent: string;
  setAccent: (a: string) => void;
  cartCollapsed: boolean;
  toggleCart: () => void;
  setCartCollapsed: (v: boolean) => void;
  navAutoHide: boolean;
  toggleNavAutoHide: () => void;
  setNavAutoHide: (v: boolean) => void;
  menuDensity: MenuDensity;
  setMenuDensity: (d: MenuDensity) => void;
  menuSort: MenuSort;
  setMenuSort: (s: MenuSort) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
      setTheme: (t) => set({ theme: t }),
      accent: DEFAULT_ACCENT,
      setAccent: (a) => set({ accent: a }),
      cartCollapsed: false,
      toggleCart: () => set({ cartCollapsed: !get().cartCollapsed }),
      setCartCollapsed: (v) => set({ cartCollapsed: v }),
      navAutoHide: false,
      toggleNavAutoHide: () => set({ navAutoHide: !get().navAutoHide }),
      setNavAutoHide: (v) => set({ navAutoHide: v }),
      menuDensity: 'comfy',
      setMenuDensity: (d) => set({ menuDensity: d }),
      menuSort: 'name',
      setMenuSort: (s) => set({ menuSort: s }),
    }),
    { name: 'kasir.ui' },
  ),
);

export function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
}
