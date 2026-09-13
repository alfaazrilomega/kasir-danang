import { create } from 'zustand';

export type ModeMasuk = 'masuk' | 'daftar' | 'lupa';

/**
 * Pop-up masuk/daftar/lupa sandi di layar lebar: dibuka dari tautan mana pun
 * di toko tanpa berpindah halaman. `next` = tujuan setelah berhasil masuk
 * (kosong = tetap di halaman yang sedang dibuka).
 */
interface ModalMasukState {
  buka: boolean;
  mode: ModeMasuk;
  next: string | null;
  /** Nomor HP / email yang dibawa ke langkah berikutnya (mis. dari Masuk ke Lupa Sandi). */
  idAwal: string;
  bukaModal: (mode?: ModeMasuk, next?: string | null) => void;
  setMode: (mode: ModeMasuk, idAwal?: string) => void;
  tutup: () => void;
}

export const useModalMasuk = create<ModalMasukState>((set) => ({
  buka: false,
  mode: 'masuk',
  next: null,
  idAwal: '',
  bukaModal: (mode = 'masuk', next = null) => set({ buka: true, mode, next, idAwal: '' }),
  setMode: (mode, idAwal = '') => set({ mode, idAwal }),
  tutup: () => set({ buka: false }),
}));
