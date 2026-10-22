// Kategori pengeluaran tambahan milik toko (permintaan 26). Kategori bawaan
// tetap ada; yang ditambah di sini ikut muncul di pilihan kategori halaman
// Pengeluaran, biaya lain nota pembelian, dan impor pengeluaran.

import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { db } from '@/lib/db';
import {
  EXPENSE_CATEGORIES,
  MAKS_PANJANG_KATEGORI,
  cekKategoriBaru,
  kategoriTambahanToko,
} from '@/lib/expenseCategories';
import type { Store } from '@/types';

export function KategoriPengeluaranPanel() {
  const store = useAuth((s) => s.store);
  const refreshProfile = useAuth((s) => s.refreshProfile);
  const tambahan = kategoriTambahanToko(store);
  const [nama, setNama] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Disimpan langsung per tambah/hapus, terpisah dari tombol simpan formulir
  // pengaturan, supaya kategori baru bisa dipakai tanpa langkah kedua. Daftar
  // dibaca ulang dari server sebelum diubah: halaman yang terbuka lama tidak
  // boleh menimpa kategori yang baru ditambah dari perangkat lain.
  async function simpan(ubah: (daftar: string[]) => string[] | { galat: string }): Promise<boolean> {
    if (!store) return false;
    setBusy(true);
    try {
      const api = getBackendClient();
      let terkini = tambahan;
      if (api) {
        const { data, error } = await api.from('stores').select('expense_categories').eq('id', store.id).maybeSingle();
        if (error) {
          toast.error(error.message);
          return false;
        }
        terkini = kategoriTambahanToko(data as Pick<Store, 'expense_categories'> | null);
      }
      const daftar = ubah(terkini);
      if (!Array.isArray(daftar)) {
        setGalat(daftar.galat);
        return false;
      }
      if (api) {
        const { error } = await api.from('stores').update({ expense_categories: daftar }).eq('id', store.id);
        if (error) {
          toast.error(error.message);
          return false;
        }
      }
      await db.stores.put({ ...store, expense_categories: daftar });
      await refreshProfile();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function tambah(e: FormEvent) {
    e.preventDefault();
    const bersih = nama.trim();
    const alasan = cekKategoriBaru(bersih, tambahan);
    if (alasan) {
      setGalat(alasan);
      return;
    }
    const tersimpan = await simpan((d) => {
      const galatTerkini = cekKategoriBaru(bersih, d);
      return galatTerkini ? { galat: galatTerkini } : [...d, bersih];
    });
    if (tersimpan) {
      toast.success(`Kategori "${bersih}" ditambahkan.`);
      setNama('');
      setGalat(null);
    }
  }

  async function hapus(label: string) {
    if (await simpan((d) => d.filter((t) => t !== label))) {
      toast.success(`Kategori "${label}" dihapus. Pengeluaran yang sudah tercatat tetap memakai nama ini.`);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">Kategori tambahan</div>
        {tambahan.length === 0 ? (
          <p className="text-sm text-ink-500" data-kategori-kosong>
            Belum ada. Tambahkan jenis pengeluaran yang tidak ada di daftar bawaan.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-kategori-tambahan>
            {tambahan.map((t) => (
              <li
                key={t}
                className="inline-flex max-w-full items-center rounded-full bg-brand-50 pl-3 text-sm text-brand-700 dark:bg-brand-950/40 dark:text-brand-200"
              >
                <span className="truncate">{t}</span>
                <button
                  type="button"
                  onClick={() => void hapus(t)}
                  disabled={busy}
                  aria-label={`Hapus kategori ${t}`}
                  className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full transition-colors duration-150 hover:text-rose-600 disabled:opacity-50 sm:h-9 sm:w-9"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={(e) => void tambah(e)} noValidate>
        <label htmlFor="kategori-pengeluaran-baru" className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-200">
          Nama kategori baru
        </label>
        <div className="flex gap-2">
          <input
            id="kategori-pengeluaran-baru"
            className="input min-h-[44px] min-w-0 flex-1 sm:min-h-0"
            value={nama}
            maxLength={MAKS_PANJANG_KATEGORI}
            placeholder="cth. Ongkir Ekspedisi"
            onChange={(e) => {
              setNama(e.target.value);
              setGalat(null);
            }}
            aria-invalid={galat ? true : undefined}
            aria-describedby={galat ? 'kategori-pengeluaran-galat' : undefined}
          />
          <Button type="submit" disabled={busy || !nama.trim()} className="min-h-[44px] shrink-0 sm:min-h-0">
            <Plus size={15} /> Tambah
          </Button>
        </div>
        {galat && (
          <p id="kategori-pengeluaran-galat" className="mt-1 text-xs text-red-500" role="alert">
            {galat}
          </p>
        )}
      </form>

      <p className="text-xs text-ink-500">
        Kategori bawaan: {EXPENSE_CATEGORIES.map((c) => c.label).join(', ')}.
      </p>
    </div>
  );
}
