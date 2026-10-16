// Editor katalog barang supplier.
//
// Supplier memakai kode barangnya sendiri yang berbeda dari SKU internal kita
// (cth. internal "KAS-KOP-001" dipesan ke supplier dengan kode "SNJ-0012").
// Tabel supplier_product_mappings sudah tersimpan & tersinkron sejak fase SKU,
// tapi belum ada cara mengisinya lewat UI — modal ini yang mengisi celah itu.
//
// Manfaat langsung: nota pembelian bisa mencocokkan barang otomatis lewat kode
// supplier, dan harga modal terakhir per supplier ikut tercatat.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Barcode, Plus, Trash2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/lib/db';
import { getBackendClient } from '@/lib/api';
import { formatMoney, formatNumber, uuid, errorMessage } from '@/lib/format';
import { normalizeSku } from '@/lib/skuLookup';
import type { Supplier, SupplierProductMapping } from '@/types';

interface Draft {
  id: string;
  product_id: string;
  supplier_sku: string;
  supplier_barcode: string;
  supplier_product_name: string;
  last_cost_price: number;
  /** Mata uang harga baris ini. Tidak selalu sama dengan mata uang supplier
   *  saat ini: harga lama tetap dalam mata uang waktu ia dicatat. */
  currency: string;
}

interface Props {
  supplier: Supplier | null;
  storeId: string;
  onClose: () => void;
}

export function SupplierCatalogModal({ supplier, storeId, onClose }: Props) {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  // Hasil query membawa id supplier miliknya sendiri. Menandai "siap" lewat
  // `undefined` saja tidak cukup: komponen ini tetap terpasang saat modal
  // tertutup, jadi live query sudah pernah menghasilkan [] untuk supplier
  // kosong. Nilai basi itu terbaca sebagai "katalog memang kosong" dan draft
  // terlanjur diisi kosong sebelum data supplier yang benar tiba.
  const catalog = useLiveQuery(async () => {
    if (!supplier) return { supplierId: null as string | null, rows: [] as SupplierProductMapping[] };
    const rows = await db.supplier_product_mappings
      .where('supplier_id')
      .equals(supplier.id)
      .toArray();
    return { supplierId: supplier.id as string | null, rows };
  }, [supplier?.id]);

  // Data baru dianggap siap hanya kalau memang milik supplier yang dibuka.
  const ready = Boolean(catalog) && catalog!.supplierId === (supplier?.id ?? null);
  const mappings: SupplierProductMapping[] = ready ? catalog!.rows : [];

  // Draft diisi sekali per supplier, setelah live query selesai. Sebelumnya
  // efek ini hanya bergantung pada id supplier sehingga jalan saat mappings
  // masih kosong, lalu tidak pernah jalan lagi ketika datanya tiba — katalog
  // yang sudah tersimpan selalu tampil kosong.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!supplier) {
      hydratedFor.current = null;
      return;
    }
    if (hydratedFor.current === supplier.id) return; // jangan timpa ketikan
    if (!ready) return; // tunggu data supplier ini benar-benar terbaca
    hydratedFor.current = supplier.id;
    setDrafts(
      mappings.map((m) => ({
        id: m.id,
        product_id: m.product_id,
        supplier_sku: m.supplier_sku,
        supplier_barcode: m.supplier_barcode ?? '',
        supplier_product_name: m.supplier_product_name ?? '',
        last_cost_price: Number(m.last_cost_price ?? 0),
        currency: m.currency || supplier.currency || 'IDR',
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, ready]);

  // Kurs supplier hanya untuk MENAMPILKAN padanan rupiah. Harga yang disimpan
  // tetap dalam mata uang barisnya, jadi mengubah kurs tidak mengubah data.
  const rate = Number(supplier?.exchange_rate || 0) > 0 ? Number(supplier!.exchange_rate) : 1;
  const supplierCurrency = supplier?.currency || 'IDR';
  const mismatched = drafts.filter(
    (d) => d.last_cost_price > 0 && (d.currency || 'IDR') !== supplierCurrency,
  ).length;

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  function patch(id: string, next: Partial<Draft>) {
    setDrafts((rows) => rows.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }

  function addRow() {
    setDrafts((rows) => [
      ...rows,
      {
        id: uuid(),
        product_id: '',
        supplier_sku: '',
        supplier_barcode: '',
        supplier_product_name: '',
        last_cost_price: 0,
        currency: supplier?.currency || 'IDR',
      },
    ]);
  }

  /** Pesan error baris, atau null bila valid. */
  function errorFor(row: Draft): string | null {
    if (!row.product_id) return 'Pilih produk internal dulu.';
    if (!row.supplier_sku.trim()) return 'Kode barang supplier wajib diisi.';
    const dup = drafts.find(
      (r) => r.id !== row.id && normalizeSku(r.supplier_sku) === normalizeSku(row.supplier_sku),
    );
    if (dup) return 'Kode ini dipakai dua kali untuk supplier yang sama.';
    return null;
  }

  async function save() {
    if (!supplier) return;
    // Jangan menyimpan sebelum katalog lama selesai dibaca: `removed` di bawah
    // menganggap semua baris yang tidak ada di draft sebagai dihapus, jadi
    // menyimpan terlalu dini akan menghapus seluruh katalog yang tersimpan.
    if (!ready) {
      toast.error('Katalog masih dimuat, tunggu sebentar.');
      return;
    }
    for (const row of drafts) {
      const err = errorFor(row);
      if (err) {
        toast.error(err);
        return;
      }
    }

    setBusy(true);
    try {
      const api = getBackendClient();
      const keptIds = new Set(drafts.map((d) => d.id));
      const removed = mappings.filter((m) => !keptIds.has(m.id));

      for (const row of removed) {
        if (navigator.onLine) {
          const { error } = await api.from('supplier_product_mappings').delete().eq('id', row.id);
          if (error) throw error;
        }
        await db.supplier_product_mappings.delete(row.id);
      }

      const rows: SupplierProductMapping[] = drafts.map((d) => ({
        id: d.id,
        store_id: storeId,
        supplier_id: supplier.id,
        product_id: d.product_id,
        supplier_sku: d.supplier_sku.trim(),
        supplier_barcode: d.supplier_barcode.trim() || null,
        supplier_product_name:
          d.supplier_product_name.trim() || productById.get(d.product_id)?.name || '',
        last_cost_price: Number(d.last_cost_price || 0),
        // Mata uang milik baris dipertahankan supaya mengganti mata uang supplier
        // tidak diam-diam mengubah arti harga yang sudah tercatat.
        currency: d.currency || supplier.currency || 'IDR',
      }));

      if (rows.length) {
        if (navigator.onLine) {
          const { error } = await api.from('supplier_product_mappings').upsert(rows);
          if (error) throw error;
        }
        await db.supplier_product_mappings.bulkPut(rows);
      }

      toast.success(`Katalog ${supplier.name} disimpan (${rows.length} barang).`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyimpan katalog.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(supplier)}
      onClose={onClose}
      title={supplier ? `Katalog Barang — ${supplier.name}` : 'Katalog Barang'}
      size="lg"
    >
      {supplier && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-ink-500 dark:text-ink-400">
              Kode barang versi supplier beserta harga modal terakhir. Dipakai untuk mencocokkan
              barang otomatis saat membuat nota pembelian.
            </p>
            <Button type="button" variant="secondary" onClick={addRow} disabled={!online}>
              <Plus size={14} /> Tambah
            </Button>
          </div>

          {!online && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <WifiOff size={14} className="mt-0.5 shrink-0" />
              <span>Perlu koneksi internet untuk mengubah katalog supplier.</span>
            </div>
          )}

          {/* Harga lama tetap dalam mata uang saat dicatat. Kalau mata uang
              supplier belakangan diubah, angka lama TIDAK ikut dikonversi —
              itu harus terlihat, bukan diam-diam dibaca ulang. */}
          {mismatched > 0 && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {mismatched} harga masih tercatat dalam mata uang lain, bukan{' '}
              {supplier.currency || 'IDR'}. Angkanya tidak dikonversi otomatis — periksa dan
              ketik ulang bila memang harus berubah.
            </p>
          )}

          {drafts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-200 px-3 py-6 text-center text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
              Belum ada barang terdaftar untuk supplier ini.
            </p>
          ) : (
            <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
              {drafts.map((row) => {
                const err = errorFor(row);
                return (
                  <div
                    key={row.id}
                    className={
                      err
                        ? 'rounded-xl border border-rose-300 bg-rose-50/60 px-3 py-2.5 dark:border-rose-500/40 dark:bg-rose-500/5'
                        : 'rounded-xl border border-ink-200 px-3 py-2.5 dark:border-ink-700'
                    }
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-ink-500">
                          Produk internal
                        </label>
                        <select
                          className="input"
                          value={row.product_id}
                          disabled={!online}
                          onChange={(e) => patch(row.id, { product_id: e.target.value })}
                        >
                          <option value="">Pilih produk…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku ? `${p.sku} — ${p.name}` : p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Input
                        label="Kode barang supplier"
                        value={row.supplier_sku}
                        disabled={!online}
                        onChange={(e) => patch(row.id, { supplier_sku: e.target.value })}
                        placeholder="cth. SNJ-0012"
                      />
                      <Input
                        label="Barcode supplier (opsional)"
                        value={row.supplier_barcode}
                        disabled={!online}
                        onChange={(e) => patch(row.id, { supplier_barcode: e.target.value })}
                        placeholder="Scan / ketik"
                      />
                      <Input
                        label={`Harga modal terakhir (${row.currency || 'IDR'})`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.last_cost_price}
                        disabled={!online}
                        onChange={(e) =>
                          patch(row.id, { last_cost_price: Number(e.target.value) })
                        }
                      />
                      <Input
                        label="Nama barang versi supplier (opsional)"
                        value={row.supplier_product_name}
                        disabled={!online}
                        onChange={(e) =>
                          patch(row.id, { supplier_product_name: e.target.value })
                        }
                        placeholder={productById.get(row.product_id)?.name ?? 'Ikut nama internal'}
                      />
                      <div className="flex items-end justify-between gap-2">
                        <div className="text-[11px] text-ink-500">
                          {row.last_cost_price > 0 && (
                            <>
                              <Barcode size={11} className="mr-1 inline" />
                              {formatMoney(row.last_cost_price, row.currency || 'IDR')}
                              {row.currency === 'USD' && (
                                <span className="ml-1">
                                  {'≈ '}
                                  {formatMoney(row.last_cost_price * rate, 'IDR')}
                                  <span className="ml-1 opacity-70">
                                    (kurs {formatNumber(rate)})
                                  </span>
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!online}
                          onClick={() => setDrafts((rows) => rows.filter((r) => r.id !== row.id))}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                    {err && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-300">{err}</p>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button onClick={save} disabled={busy || !online}>
              {busy ? 'Menyimpan…' : 'Simpan Katalog'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
