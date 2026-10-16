// Penyusun isi produk set.
//
// Client menjual "Gear Set" yang isinya gear depan, gear belakang, dan rantai —
// dan ketiganya juga dijual satuan. Tanpa konsep set, satu barang fisik harus
// dicatat sebagai dua produk berbeda, dan stoknya langsung meleset: menjual
// satu set tidak mengurangi stok satuannya padahal barangnya keluar dari rak
// yang sama.
//
// Karena itu set tidak punya stok sendiri. Yang ditampilkan di sini adalah
// berapa set yang masih bisa dirakit dari stok isinya.

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProductPicker } from '@/components/data/ProductPicker';
import { formatNumber } from '@/lib/format';
import type { Product } from '@/types';

export interface SetComponentDraft {
  key: string;
  component_product_id: string;
  qty: string;
}

/**
 * Berapa set yang bisa dirakit dari stok isinya.
 *
 * Ditentukan oleh isi yang paling sedikit — persis seperti merakit barangnya:
 * punya 100 rantai tidak menolong kalau gearnya tinggal 2.
 */
export function hitungStokSet(
  isi: { component_product_id: string; qty: number }[],
  produkById: Map<string, Product>,
): number {
  if (!isi.length) return 0;
  let paling = Infinity;
  for (const bagian of isi) {
    const p = produkById.get(bagian.component_product_id);
    if (!p) return 0;
    if (!p.track_stock) continue;
    const takaran = Number(bagian.qty || 0);
    if (takaran <= 0) return 0;
    paling = Math.min(paling, Math.floor(Number(p.stock_qty ?? 0) / takaran));
  }
  return Number.isFinite(paling) ? Math.max(0, paling) : 0;
}

interface Props {
  /** Produk yang sedang diedit; kosong saat membuat produk baru. */
  productId: string | null;
  value: SetComponentDraft[];
  onChange: (next: SetComponentDraft[]) => void;
  products: Product[];
  /** Id produk yang sudah dipakai sebagai isi set mana pun. */
  dipakaiSebagaiIsi: Set<string>;
  /** Id produk yang punya isi, artinya dia sendiri sebuah set. */
  produkSet: Set<string>;
}

export function ProductSetSection({
  productId,
  value,
  onChange,
  products,
  dipakaiSebagaiIsi,
  produkSet,
}: Props) {
  const produkById = new Map(products.map((p) => [p.id, p]));
  const terpakai = new Set(value.map((v) => v.component_product_id).filter(Boolean));

  // Set tidak boleh berisi set lain, tidak boleh berisi dirinya sendiri, dan
  // produk yang sudah menjadi isi set lain tidak boleh dijadikan set. Aturan
  // yang sama ditegakkan database (migrasi 019); di sini hanya supaya pilihan
  // yang salah tidak sempat muncul.
  const bolehJadiIsi = (p: Product) =>
    p.id !== productId && !produkSet.has(p.id) && p.is_active;

  const iniDipakaiSebagaiIsi = productId ? dipakaiSebagaiIsi.has(productId) : false;

  const stok = hitungStokSet(
    value
      .filter((v) => v.component_product_id)
      .map((v) => ({ component_product_id: v.component_product_id, qty: Number(v.qty || 0) })),
    produkById,
  );

  function ubah(key: string, patch: Partial<SetComponentDraft>) {
    onChange(value.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  }

  if (iniDipakaiSebagaiIsi) {
    return (
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Produk Set
        </div>
        <p className="rounded-xl border border-ink-200 px-3 py-2 text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
          Produk ini sudah dipakai sebagai isi dari set lain, jadi tidak bisa dijadikan set.
          Satu barang hanya boleh berada di satu tingkat supaya angka stoknya tetap bisa
          dijelaskan.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Produk Set (opsional)
        </div>
        {value.length > 0 && (
          <span className="text-xs text-ink-500 dark:text-ink-400">
            Bisa dirakit: <strong>{formatNumber(stok)}</strong> set
          </span>
        )}
      </div>

      <p className="mb-2 text-[11px] text-ink-500 dark:text-ink-400">
        Isi daftar ini bila produk ini gabungan dari barang lain. Set tidak punya stok
        sendiri — menjual satu set memotong stok tiap isinya sesuai takaran di bawah.
      </p>

      <div className="space-y-2">
        {value.map((baris) => (
          <div key={baris.key} className="flex items-center gap-2">
            <ProductPicker
              className="flex-1"
              products={products.filter(bolehJadiIsi)}
              value={baris.component_product_id}
              onChange={(id) => ubah(baris.key, { component_product_id: id })}
              excludeIds={[...terpakai].filter((id) => id !== baris.component_product_id)}
              placeholder="Cari barang isi set (nama atau SKU)..."
              showStock
            />
            <input
              type="number"
              min={1}
              step="1"
              className="input !py-1.5 w-20"
              value={baris.qty}
              onChange={(e) => ubah(baris.key, { qty: e.target.value })}
              title="Berapa banyak barang ini dipakai dalam satu set"
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v.key !== baris.key))}
              className="rounded-lg p-2 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
              title="Hapus isi ini"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <Button
        variant="secondary"
        className="mt-2"
        onClick={() =>
          onChange([
            ...value,
            { key: `isi-${Date.now()}-${value.length}`, component_product_id: '', qty: '1' },
          ])
        }
      >
        <Plus size={14} /> Tambah isi set
      </Button>
    </div>
  );
}
