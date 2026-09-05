import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BoxIcon,
  Copy,
  Download,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullInventoryReference, adjustStock, writeThrough } from '@/lib/sync';
import {
  ChannelSkuSection,
  validateChannelDrafts,
  type ChannelMappingDraft,
} from '@/components/products/ChannelSkuSection';
import {
  ProductSetSection,
  hitungStokSet,
  type SetComponentDraft,
} from '@/components/products/ProductSetSection';
import { findSkuConflict } from '@/lib/skuLookup';
import { channelLabel } from '@/lib/channels';
import { cn, formatMoney, uuid } from '@/lib/format';
import { CATEGORY_ICONS, getCategoryIcon } from '@/lib/categoryIcons';
import { formatBytes, resizeImageToDataUrl } from '@/lib/imageUpload';
import { resolveFeatures } from '@/lib/industries';
import type {
  Category,
  Product,
  ProductChannelMapping,
  ProductComponent,
  ProductSize,
  SalesChannel,
} from '@/types';

interface FormState {
  id?: string;
  name: string;
  category_id: string | null;
  sku: string;
  barcode: string;
  base_price: number;
  cost_price: number;
  image_url: string;
  description: string;
  is_active: boolean;
  track_stock: boolean;
  stock_qty: number;
  min_stock: number;
  sizes: ProductSize[];
  channelMappings: ChannelMappingDraft[];
  setComponents: SetComponentDraft[];
}

const emptyForm: FormState = {
  name: '',
  category_id: null,
  sku: '',
  barcode: '',
  base_price: 0,
  cost_price: 0,
  image_url: '',
  description: '',
  is_active: true,
  track_stock: true,
  stock_qty: 0,
  min_stock: 5,
  sizes: [
    { label: 'S', price_modifier: 0 },
    { label: 'M', price_modifier: 5000 },
    { label: 'L', price_modifier: 10000 },
  ],
  channelMappings: [],
  setComponents: [],
};

/**
 * Buang mapping kembar untuk (channel, SKU) yang sama.
 * Data lama bisa mengandung duplikat karena seed demo pernah dijalankan dua
 * kali dengan id acak; tanpa ini form produk terkunci oleh error validasi yang
 * tidak bisa diperbaiki user.
 */
function dedupeMappings<T extends { channel_code: string; external_sku: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((m) => {
    const key = `${m.channel_code.toUpperCase()}|${m.external_sku.trim().toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function Products() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState<Product | null>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (storeId) pullInventoryReference(storeId);
  }, [storeId]);

  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const categories =
    useLiveQuery(() => db.categories.where('store_id').equals(storeId).sortBy('sort_order'), [storeId]) ?? [];
  const channelMappings =
    useLiveQuery(
      () => db.product_channel_mappings.where('store_id').equals(storeId).toArray(),
      [storeId],
    ) ?? [];
  const channelRows =
    useLiveQuery(
      () => db.sales_channels.where('store_id').equals(storeId).sortBy('sort_order'),
      [storeId],
    ) ?? [];
  const setComponents =
    useLiveQuery(
      () => db.product_components.where('store_id').equals(storeId).toArray(),
      [storeId],
    ) ?? [];

  // Dua himpunan ini menjaga aturan satu tingkat: set tidak boleh berisi set,
  // dan barang yang sudah jadi isi tidak boleh dijadikan set.
  const produkSet = useMemo(
    () => new Set(setComponents.map((c) => c.parent_product_id)),
    [setComponents],
  );
  const dipakaiSebagaiIsi = useMemo(
    () => new Set(setComponents.map((c) => c.component_product_id)),
    [setComponents],
  );
  const isiByParent = useMemo(() => {
    const map = new Map<string, typeof setComponents>();
    for (const c of setComponents) {
      const list = map.get(c.parent_product_id);
      if (list) list.push(c);
      else map.set(c.parent_product_id, [c]);
    }
    return map;
  }, [setComponents]);

  const mappingsByProduct = useMemo(() => {
    const map = new Map<string, ProductChannelMapping[]>();
    for (const m of channelMappings) {
      const list = map.get(m.product_id);
      if (list) list.push(m);
      else map.set(m.product_id, [m]);
    }
    return map;
  }, [channelMappings]);

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (!q) return true;
        const t = q.toLowerCase();
        return (
          p.name.toLowerCase().includes(t) ||
          (p.sku ?? '').toLowerCase().includes(t) ||
          (p.barcode ?? '').toLowerCase().includes(t)
        );
      }),
    [products, q],
  );

  const lowStock = useMemo(
    () =>
      products.filter(
        (p) =>
          p.track_stock &&
          Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0),
      ),
    [products],
  );

  function startNew() {
    const features = resolveFeatures(store?.industry, store?.features as never);
    setForm({
      ...emptyForm,
      category_id: categories[0]?.id ?? null,
      track_stock: features.defaultTrackStock,
      sizes: features.useSizes ? emptyForm.sizes : [],
    });
    setOpen(true);
  }
  function startEdit(p: Product) {
    setForm({
      id: p.id,
      name: p.name,
      category_id: p.category_id,
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      base_price: Number(p.base_price),
      cost_price: Number(p.cost_price ?? 0),
      image_url: p.image_url ?? '',
      description: p.description ?? '',
      is_active: p.is_active,
      track_stock: p.track_stock ?? false,
      stock_qty: Number(p.stock_qty ?? 0),
      min_stock: Number(p.min_stock ?? 0),
      sizes: p.sizes ?? [],
      channelMappings: dedupeMappings(channelMappings.filter((m) => m.product_id === p.id))
        .map((m) => ({
          id: m.id,
          channel_code: m.channel_code,
          external_sku: m.external_sku,
          external_url: m.external_url ?? '',
          is_synced: m.is_synced,
          last_synced_at: m.last_synced_at,
        })),
      setComponents: (isiByParent.get(p.id) ?? []).map((c, i) => ({
        key: `isi-${c.id}-${i}`,
        component_product_id: c.component_product_id,
        qty: String(c.qty ?? 1),
      })),
    });
    setOpen(true);
  }

  /**
   * Salin produk jadi produk BARU.
   *
   * Client sering punya barang yang sama persis tapi berbeda SKU — misalnya
   * varian warna atau kode dari supplier berbeda. Mengetik ulang nama, harga,
   * kategori, dan foto dari nol tiap kali hanya menambah peluang salah ketik.
   *
   * SKU dan barcode sengaja DIKOSONGKAN, bukan disalin: keduanya unik per
   * produk, dan salinan yang membawa SKU asal akan ditolak saat disimpan.
   * Pemetaan channel juga tidak ikut — satu SKU platform hanya boleh menunjuk
   * ke satu produk, jadi menyalinnya berarti dua produk berebut SKU yang sama.
   * Stok diawali dari nol karena salinan ini barang yang belum pernah dihitung
   * fisik, bukan barang yang stoknya sudah diketahui.
   */
  function startDuplicate(p: Product) {
    const isiSet = isiByParent.get(p.id) ?? [];
    setForm({
      name: `${p.name} (Salinan)`,
      category_id: p.category_id,
      sku: '',
      barcode: '',
      base_price: Number(p.base_price),
      cost_price: Number(p.cost_price ?? 0),
      image_url: p.image_url ?? '',
      description: p.description ?? '',
      is_active: p.is_active,
      track_stock: p.track_stock ?? false,
      stock_qty: 0,
      min_stock: Number(p.min_stock ?? 0),
      sizes: p.sizes ?? [],
      channelMappings: [],
      // Kalau produk asalnya sebuah set, susunan isinya ikut tersalin — itu
      // bagian yang paling lama diketik ulang. Kalau bukan set, biarkan kosong.
      setComponents: isiSet.map((c, i) => ({
        key: `salin-${i}-${uuid()}`,
        component_product_id: c.component_product_id,
        qty: String(c.qty ?? 1),
      })),
    });
    setOpen(true);
    toast.info('Produk disalin. Isi SKU baru sebelum menyimpan — stok diawali dari 0.');
  }

  /**
   * Simpan mapping SKU platform setelah produknya tersimpan.
   * Hanya jalan saat online: seluruh pullX melakukan destructive replace,
   * jadi baris yang dibuat offline akan terhapus diam-diam saat sync berikutnya.
   */
  async function saveChannelMappings(productId: string) {
    if (!navigator.onLine) return;
    const api = getBackendClient();

    const previous = channelMappings.filter((m) => m.product_id === productId);
    const keptIds = new Set(form.channelMappings.map((d) => d.id));
    const removed = previous.filter((m) => !keptIds.has(m.id));

    for (const row of removed) {
      const { error } = await api.from('product_channel_mappings').delete().eq('id', row.id);
      if (error) throw error;
      await db.product_channel_mappings.delete(row.id);
    }

    if (!form.channelMappings.length) return;

    const rows: ProductChannelMapping[] = form.channelMappings.map((d) => ({
      id: d.id,
      store_id: storeId,
      product_id: productId,
      channel_code: d.channel_code,
      external_sku: d.external_sku.trim(),
      external_url: d.external_url.trim() || null,
      // Status sinkronisasi dibawa apa adanya, bukan di-reset tiap edit.
      is_synced: d.is_synced,
      last_synced_at: d.last_synced_at,
    }));

    const { error } = await api.from('product_channel_mappings').upsert(rows);
    if (error) throw error;
    await db.product_channel_mappings.bulkPut(rows);
  }

  /**
   * Simpan isi produk set.
   *
   * Sama seperti pemetaan channel, hanya jalan saat online: seluruh pullX
   * melakukan destructive replace, jadi baris yang dibuat offline akan terhapus
   * diam-diam pada sinkronisasi berikutnya.
   */
  async function saveSetComponents(productId: string) {
    if (!navigator.onLine) return;
    const api = getBackendClient();

    const sebelumnya = setComponents.filter((c) => c.parent_product_id === productId);
    const isiBaru = form.setComponents.filter((d) => d.component_product_id);

    // Baris lama dibuang lebih dulu supaya isi yang dihapus di layar benar-benar
    // hilang, bukan sekadar tidak ditimpa.
    for (const lama of sebelumnya) {
      const { error } = await api.from('product_components').delete().eq('id', lama.id);
      if (error) throw error;
      await db.product_components.delete(lama.id);
    }

    if (!isiBaru.length) return;

    const rows: ProductComponent[] = isiBaru.map((d) => ({
      id: uuid(),
      store_id: storeId,
      parent_product_id: productId,
      component_product_id: d.component_product_id,
      qty: Math.max(1, Number(d.qty || 1)),
    }));

    const { error } = await api.from('product_components').insert(rows);
    if (error) throw error;
    await db.product_components.bulkPut(rows);
  }

  async function save() {
    if (!form.name.trim() || !storeId) {
      toast.error('Nama wajib diisi.');
      return;
    }

    // Isi set yang belum dipilih barangnya cuma baris kosong; yang sudah
    // dipilih wajib punya takaran yang masuk akal.
    const isiSet = form.setComponents.filter((d) => d.component_product_id);
    if (isiSet.some((d) => Number(d.qty || 0) <= 0)) {
      toast.error('Takaran isi set harus lebih dari nol.');
      return;
    }
    const ganda = new Set<string>();
    for (const d of isiSet) {
      if (ganda.has(d.component_product_id)) {
        toast.error('Satu barang hanya boleh muncul sekali dalam isi set.');
        return;
      }
      ganda.add(d.component_product_id);
    }

    // Keunikan HARUS dicek di sini: /api/query menelan error database, jadi
    // pelanggaran unique index Postgres tidak akan muncul sebagai error.
    const skuTrimmed = form.sku.trim();
    if (skuTrimmed) {
      const clash = findSkuConflict(skuTrimmed, products, form.id);
      if (clash) {
        toast.error(`SKU "${skuTrimmed}" sudah dipakai produk "${clash.name}".`);
        return;
      }
    }

    const otherMappings = channelMappings.filter((m) => m.product_id !== form.id);
    const draftError = validateChannelDrafts(form.channelMappings, otherMappings);
    if (draftError) {
      toast.error(draftError);
      return;
    }

    setBusy(true);
    const api = getBackendClient();
    const row: Product = {
      id: form.id ?? uuid(),
      store_id: storeId,
      category_id: form.category_id,
      name: form.name,
      description: form.description || null,
      image_url: form.image_url || null,
      base_price: form.base_price,
      sizes: form.sizes,
      is_active: form.is_active,
      sku: form.sku || null,
      barcode: form.barcode || null,
      cost_price: form.cost_price,
      stock_qty: form.stock_qty,
      min_stock: form.min_stock,
      track_stock: form.track_stock,
    };
    try {
      // writeThrough: kalau offline, perubahan masuk antrean dan dikirim saat
      // online lagi. Sebelumnya panggilan API dilewati begitu saja sehingga
      // edit offline hilang tanpa pemberitahuan saat data ditarik ulang.
      const { queued } = await writeThrough('products', 'upsert', row);
      await db.products.put(row);
      await saveChannelMappings(row.id);
      await saveSetComponents(row.id);
      toast.success(
        queued
          ? 'Produk disimpan lokal. Akan dikirim ke server saat online.'
          : form.id
            ? 'Produk diperbarui.'
            : 'Produk ditambahkan.',
      );
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Product) {
    if (!confirm(`Hapus produk "${p.name}"?`)) return;
    const api = getBackendClient();
    if (navigator.onLine) {
      const { error } = await api.from('products').delete().eq('id', p.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    await db.products.delete(p.id);
    toast.success('Produk dihapus.');
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="opacity-80 text-sm">{products.length} produk · {lowStock.length} stok menipis</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <Search size={14} />
            <input
              className="bg-transparent placeholder:text-white/70 focus:outline-none"
              placeholder="Cari nama / SKU / barcode"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            onClick={() => setCatManagerOpen(true)}
            variant="onBrand"
          >
            <Layers size={16} /> Kategori ({categories.length})
          </Button>
          <Button
            onClick={async () => {
              const { exportProductsBySKU } = await import('@/lib/exportUtils');
              const count = await exportProductsBySKU(filtered, categories);
              toast.success(`${count} produk diekspor.`);
            }}
            variant="onBrand"
            disabled={filtered.length === 0}
          >
            <Download size={16} /> Export CSV
          </Button>
          <Button
            onClick={async () => {
              const { exportChannelMappings } = await import('@/lib/exportUtils');
              const count = await exportChannelMappings();
              if (!count) {
                toast.message('Belum ada mapping SKU platform untuk diekspor.');
                return;
              }
              toast.success(`${count} mapping SKU platform diekspor.`);
            }}
            variant="onBrand"
          >
            <Link2 size={16} /> Export SKU Platform
          </Button>
          <Button onClick={startNew} variant="onBrand">
            <Plus size={16} /> Tambah Produk
          </Button>
        </div>
      </div>

      {lowStock.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4 dark:bg-amber-500/10 dark:border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-600 shrink-0" size={20} />
            <div className="flex-1">
              <div className="font-semibold text-amber-900 dark:text-amber-200">
                Stok menipis ({lowStock.length} produk)
              </div>
              <div className="text-xs text-amber-800/80 dark:text-amber-200/80">
                {lowStock.slice(0, 5).map((p) => `${p.name} (${p.stock_qty})`).join(', ')}
                {lowStock.length > 5 ? ` +${lowStock.length - 5} lainnya` : ''}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        {filtered.length === 0 ? (
          <EmptyState
            title="Belum ada produk"
            description="Tambahkan menu pertama Anda."
            action={<Button onClick={startNew}><Plus size={16} /> Tambah Produk</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Produk</th>
                  <th className="py-2">SKU / Barcode</th>
                  <th className="py-2">Kategori</th>
                  <th className="py-2">Harga</th>
                  <th className="py-2">Modal</th>
                  <th className="py-2">Margin</th>
                  <th className="py-2">Stok</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const low = p.track_stock && Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0);
                  const price = Number(p.base_price);
                  const cost = Number(p.cost_price ?? 0);
                  const marginAbs = price - cost;
                  const marginPct = price > 0 ? (marginAbs / price) * 100 : 0;
                  const marginTone =
                    cost === 0 ? 'text-ink-400' : marginAbs < 0 ? 'text-rose-600' : marginPct < 20 ? 'text-amber-600' : 'text-emerald-600';
                  return (
                    <tr key={p.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-lg bg-ink-100 dark:bg-ink-800">
                            {p.image_url && <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />}
                          </div>
                          <div className="font-semibold">{p.name}</div>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="text-xs font-mono font-semibold text-ink-800 dark:text-ink-200">{p.sku ?? '—'}</div>
                        <div className="text-[10px] text-ink-500 font-mono">{p.barcode ?? '—'}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {(mappingsByProduct.get(p.id) ?? []).map((m) => (
                            <span
                              key={m.id}
                              title={m.external_sku}
                              className="inline-flex items-center rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                            >
                              {channelLabel(m.channel_code, channelRows)}
                            </span>
                          ))}
                          {!(mappingsByProduct.get(p.id) ?? []).length && (
                            <span className="inline-flex items-center rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                              Toko fisik
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3">{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</td>
                      <td className="py-3">{formatMoney(price, store?.currency)}</td>
                      <td className="py-3 text-ink-500">{formatMoney(cost, store?.currency)}</td>
                      <td className={cn('py-3 font-semibold', marginTone)}>
                        {cost === 0 ? (
                          '—'
                        ) : (
                          <>
                            <div>{marginPct.toFixed(0)}%</div>
                            <div className="text-[10px] font-normal text-ink-500">
                              {formatMoney(marginAbs, store?.currency)}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-3">
                        {p.track_stock ? (
                          <div className={cn('flex items-center gap-1.5', low && 'text-amber-600 font-semibold')}>
                            {low && <AlertTriangle size={12} />}
                            {Number(p.stock_qty ?? 0)}
                            <button
                              onClick={() => setStockOpen(p)}
                              className="ml-1 text-xs rounded-md bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 hover:bg-ink-200"
                            >
                              +/-
                            </button>
                          </div>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        <Badge tone={p.is_active ? 'success' : 'warning'}>
                          {p.is_active ? 'Aktif' : 'Nonaktif'}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => startEdit(p)} className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800" title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => startDuplicate(p)} className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800" title="Duplikat">
                            <Copy size={14} />
                          </button>
                          <button onClick={() => remove(p)} className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Hapus">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Produk' : 'Tambah Produk'} size="lg">
        <ProductForm
          form={form}
          setForm={setForm}
          categories={categories}
          currency={store?.currency ?? 'IDR'}
          existingSkus={products.filter((p) => p.id !== form.id).map((p) => p.sku ?? '')}
          channelRows={channelRows}
          otherMappings={channelMappings.filter((m) => m.product_id !== form.id)}
          products={products}
          dipakaiSebagaiIsi={dipakaiSebagaiIsi}
          produkSet={produkSet}
          onCancel={() => setOpen(false)}
          onSave={save}
          busy={busy}
        />
      </Modal>

      <StockAdjustModal product={stockOpen} onClose={() => setStockOpen(null)} storeId={storeId} />
      <CategoryManagerModal
        open={catManagerOpen}
        onClose={() => setCatManagerOpen(false)}
        storeId={storeId}
        categories={categories}
        products={products}
      />
    </div>
  );
}

function ProductForm({
  form, setForm, categories, currency, existingSkus, channelRows, otherMappings,
  products, dipakaiSebagaiIsi, produkSet, onCancel, onSave, busy,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  categories: Category[];
  currency: string;
  existingSkus: string[];
  channelRows: SalesChannel[];
  otherMappings: { id: string; channel_code: string; external_sku: string }[];
  products: Product[];
  dipakaiSebagaiIsi: Set<string>;
  produkSet: Set<string>;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const price = Number(form.base_price);
  const cost = Number(form.cost_price);
  const marginAbs = price - cost;
  const marginPct = price > 0 ? (marginAbs / price) * 100 : 0;
  const marginTone =
    cost === 0 ? 'text-ink-400' : marginAbs < 0 ? 'text-rose-600' : marginPct < 20 ? 'text-amber-600' : 'text-emerald-600';
  const category = categories.find((c) => c.id === form.category_id);
  const CategoryIcon = getCategoryIcon(category?.icon);
  const firstSize = form.sizes?.[0];
  const previewPrice = price + Number(firstSize?.price_modifier ?? 0);

  function generateSku() {
    // Pattern: prefix from name (first 3 letters uppercased), running number derived from existing SKUs.
    const prefix = form.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'SKU';
    let n = 1;
    const set = new Set(existingSkus.filter(Boolean).map((s) => s.toUpperCase()));
    let candidate = `${prefix}-${String(n).padStart(4, '0')}`;
    while (set.has(candidate.toUpperCase())) {
      n++;
      candidate = `${prefix}-${String(n).padStart(4, '0')}`;
    }
    setForm({ ...form, sku: candidate });
  }

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_220px]">
      {/* Form ============================================================ */}
      <div className="space-y-4">
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">Info dasar</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nama produk"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="cth. Iced Latte"
            />
            <div>
              <label className="block text-sm font-medium mb-1.5">Kategori</label>
              <div className="flex items-center gap-2 rounded-xl border border-ink-200 dark:border-ink-700 px-2 py-1.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/40 shrink-0">
                  <CategoryIcon size={14} />
                </span>
                <select
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  value={form.category_id ?? ''}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
                >
                  <option value="">(tanpa kategori)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">SKU</label>
              <div className="flex gap-1.5">
                <input
                  className="input"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="SKU-0001"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={generateSku}
                  title="Generate SKU otomatis"
                  disabled={!form.name.trim()}
                >
                  <Sparkles size={12} />
                </Button>
              </div>
            </div>
            <Input
              label="Barcode"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="Scan / ketik"
            />
            <Input
              label="Deskripsi"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Opsional"
            />
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-1.5">Gambar produk</label>
              <ImagePicker
                value={form.image_url}
                onChange={(v) => setForm({ ...form, image_url: v })}
              />
            </div>
          </div>
        </section>

        <section>
          <ChannelSkuSection
            internalSku={form.sku}
            value={form.channelMappings}
            onChange={(next) => setForm({ ...form, channelMappings: next })}
            channelRows={channelRows}
            otherMappings={otherMappings}
          />
        </section>

        <section>
          <ProductSetSection
            productId={form.id ?? null}
            value={form.setComponents}
            onChange={(next) => setForm({ ...form, setComponents: next })}
            products={products}
            dipakaiSebagaiIsi={dipakaiSebagaiIsi}
            produkSet={produkSet}
          />
        </section>

        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">Harga</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={`Harga jual (${currency})`}
              type="number"
              step="0.01"
              value={form.base_price}
              onChange={(e) => setForm({ ...form, base_price: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label={`Harga modal (${currency})`}
              type="number"
              step="0.01"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl bg-ink-50 dark:bg-ink-900 px-3 py-2 text-sm">
            <span className="text-ink-500">Margin</span>
            <span className={cn('font-semibold', marginTone)}>
              {cost === 0
                ? 'Isi modal untuk lihat margin'
                : `${marginPct.toFixed(1)}% · ${formatMoney(marginAbs, currency)}`}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-ink-100 dark:border-ink-800 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={form.track_stock}
                onChange={(e) => setForm({ ...form, track_stock: e.target.checked })}
              />
              <Package size={14} className="text-ink-500" /> Lacak stok
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-500">Stok awal</span>
              <input
                disabled={!form.track_stock}
                className="input !w-24 !py-1.5"
                type="number"
                value={form.stock_qty}
                onChange={(e) => setForm({ ...form, stock_qty: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-500">Min. stok</span>
              <input
                disabled={!form.track_stock}
                className="input !w-24 !py-1.5"
                type="number"
                value={form.min_stock}
                onChange={(e) => setForm({ ...form, min_stock: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
        </section>

        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
            Varian ukuran (opsional)
          </div>
          <div className="space-y-2">
            {form.sizes.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  placeholder="Label (S/M/L)"
                  value={s.label}
                  onChange={(e) => {
                    const sizes = [...form.sizes];
                    sizes[i] = { ...sizes[i], label: e.target.value };
                    setForm({ ...form, sizes });
                  }}
                />
                <Input
                  type="number"
                  placeholder="+ Modifier harga"
                  value={s.price_modifier}
                  onChange={(e) => {
                    const sizes = [...form.sizes];
                    sizes[i] = { ...sizes[i], price_modifier: parseFloat(e.target.value) || 0 };
                    setForm({ ...form, sizes });
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => setForm({ ...form, sizes: form.sizes.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setForm({ ...form, sizes: [...form.sizes, { label: '', price_modifier: 0 }] })}
            >
              <Plus size={14} /> Tambah varian
            </Button>
          </div>
        </section>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Aktif (tampilkan di POS)
        </label>
      </div>

      {/* Preview pane ===================================================== */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Preview di Menu
        </div>
        <Card className="overflow-hidden">
          <div className="aspect-[5/4] bg-ink-100 dark:bg-ink-800 relative">
            {form.image_url ? (
              <img
                src={form.image_url}
                alt={form.name || 'Preview'}
                className="h-full w-full object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-ink-400">
                <CategoryIcon size={28} />
              </div>
            )}
            {form.track_stock && (
              <div className="absolute top-2 left-2">
                <Badge
                  tone={
                    Number(form.stock_qty) <= 0
                      ? 'danger'
                      : Number(form.stock_qty) <= Number(form.min_stock)
                      ? 'warning'
                      : 'neutral'
                  }
                >
                  Stok {Number(form.stock_qty)}
                </Badge>
              </div>
            )}
            {!form.is_active && (
              <div className="absolute inset-0 grid place-items-center bg-black/50 text-xs text-white font-semibold">
                NONAKTIF
              </div>
            )}
          </div>
          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {form.name || 'Nama produk'}
                </div>
                <div className="text-xs text-ink-500 font-mono truncate">
                  {form.sku || form.barcode || (form.sizes?.length ? 'Cup Size' : '—')}
                </div>
              </div>
              <div className="text-sm font-bold whitespace-nowrap">
                {formatMoney(previewPrice, currency)}
              </div>
            </div>
            {form.sizes?.length ? (
              <div className="mt-2 flex gap-1.5">
                {form.sizes.map((s, i) => (
                  <span
                    key={i}
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full text-xs font-semibold border',
                      i === 0
                        ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40'
                        : 'border-ink-200 dark:border-ink-700 text-ink-600',
                    )}
                  >
                    {s.label || '?'}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
        <p className="text-[11px] text-ink-500">
          {category ? (
            <>
              Tampil di kategori <span className="font-semibold">{category.name}</span>.
            </>
          ) : (
            'Belum punya kategori — produk tetap muncul di "All Menu".'
          )}
        </p>

        <div className="hidden md:flex flex-col gap-2 pt-3 border-t border-ink-100 dark:border-ink-800">
          <Button onClick={onSave} disabled={busy}>Simpan</Button>
          <Button variant="secondary" onClick={onCancel}>Batal</Button>
        </div>
      </div>

      {/* Mobile actions (preview pane stacks; show actions at bottom too) */}
      <div className="md:hidden flex justify-end gap-2 pt-3 border-t border-ink-100 dark:border-ink-800">
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button onClick={onSave} disabled={busy}>Simpan</Button>
      </div>
    </div>
  );
}

function ImagePicker({
  value, onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [info, setInfo] = useState<{ bytes: number; w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDataUrl = value.startsWith('data:');

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const result = await resizeImageToDataUrl(file);
      onChange(result.dataUrl);
      setInfo({ bytes: result.bytes, w: result.width, h: result.height });
      toast.success(`Gambar diunggah · ${result.width}×${result.height} · ${formatBytes(result.bytes)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses gambar.');
    } finally {
      setUploading(false);
    }
  }

  function onPick() {
    inputRef.current?.click();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function clearImage() {
    onChange('');
    setInfo(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {value ? (
        <div className="flex items-stretch gap-3 rounded-xl border border-ink-200 dark:border-ink-700 p-2">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-ink-100 dark:bg-ink-800">
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img src={value} alt="Preview gambar" className="h-full w-full object-cover" />
          </div>
          <div className="flex flex-1 flex-col justify-between min-w-0">
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-semibold',
                  isDataUrl
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
                )}
              >
                {isDataUrl ? 'Upload lokal' : 'URL'}
              </span>
              {info && (
                <span className="text-ink-500">
                  {info.w}×{info.h} · {formatBytes(info.bytes)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={onPick} disabled={uploading}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                Ganti
              </Button>
              <button
                onClick={clearImage}
                className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                title="Hapus gambar"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-6 transition',
            dragging
              ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
              : 'border-ink-200 dark:border-ink-700 hover:border-brand-400 hover:bg-ink-50 dark:hover:bg-ink-800',
          )}
        >
          {uploading ? (
            <Loader2 size={20} className="animate-spin text-brand-600" />
          ) : (
            <ImagePlus size={20} className="text-ink-400" />
          )}
          <div className="text-sm font-semibold">
            {uploading ? 'Memproses…' : 'Upload dari komputer'}
          </div>
          <div className="text-[11px] text-ink-500">
            Drag &amp; drop file di sini, atau klik untuk pilih · auto-resize ke maks 900px
          </div>
        </button>
      )}

      <details className="text-xs text-ink-500">
        <summary className="cursor-pointer select-none hover:text-ink-700 dark:hover:text-ink-300">
          Atau pakai URL gambar
        </summary>
        <input
          type="url"
          value={isDataUrl ? '' : value}
          onChange={(e) => {
            onChange(e.target.value);
            setInfo(null);
          }}
          placeholder="https://…"
          className="input !py-1.5 mt-1.5"
        />
      </details>
    </div>
  );
}

function StockAdjustModal({
  product, onClose, storeId,
}: { product: Product | null; onClose: () => void; storeId: string }) {
  const [type, setType] = useState<'restock' | 'adjust'>('restock');
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDelta(0);
    setReason('');
    setType('restock');
  }, [product?.id]);
  if (!product) return null;

  async function submit() {
    if (delta === 0) {
      toast.error('Masukkan jumlah perubahan.');
      return;
    }
    setBusy(true);
    try {
      await adjustStock({
        storeId,
        product: product!,
        delta: type === 'restock' ? Math.abs(delta) : delta,
        type,
        reason: reason || undefined,
      });
      toast.success('Stok diperbarui.');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!product} onClose={onClose} title={`Penyesuaian Stok — ${product.name}`}>
      <div className="space-y-3">
        <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 flex items-center gap-3">
          <BoxIcon className="text-ink-500" />
          <div className="text-sm">
            Stok saat ini <span className="font-semibold">{Number(product.stock_qty ?? 0)}</span>{' '}
            (min {Number(product.min_stock ?? 0)})
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Tipe</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setType('restock')}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm font-semibold',
                type === 'restock' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-700',
              )}
            >
              Restock (+)
            </button>
            <button
              onClick={() => setType('adjust')}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm font-semibold',
                type === 'adjust' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-700',
              )}
            >
              Penyesuaian (+/-)
            </button>
          </div>
        </div>
        <Input
          label={type === 'restock' ? 'Jumlah tambahan' : 'Delta (negatif untuk pengurangan)'}
          type="number"
          value={delta}
          onChange={(e) => setDelta(parseFloat(e.target.value) || 0)}
        />
        <Input label="Catatan" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pengiriman supplier, opname, dll" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy}>Simpan</Button>
        </div>
      </div>
    </Modal>
  );
}

interface CatRowDraft {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  dirty?: boolean;
  isNew?: boolean;
}

function CategoryManagerModal({
  open, onClose, storeId, categories, products,
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  categories: Category[];
  products: Product[];
}) {
  const [drafts, setDrafts] = useState<CatRowDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const productCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      if (!p.category_id) continue;
      m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    }
    return m;
  }, [products]);

  useEffect(() => {
    if (open) {
      setDrafts(
        categories.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon ?? 'coffee',
          sort_order: c.sort_order ?? 0,
        })),
      );
    }
  }, [open, categories]);

  function addRow() {
    setDrafts((d) => [
      ...d,
      {
        id: uuid(),
        name: '',
        icon: 'coffee',
        sort_order: d.length,
        dirty: true,
        isNew: true,
      },
    ]);
  }

  function setRow(idx: number, patch: Partial<CatRowDraft>) {
    setDrafts((d) => {
      const next = [...d];
      next[idx] = { ...next[idx], ...patch, dirty: true };
      return next;
    });
  }

  function move(idx: number, dir: -1 | 1) {
    setDrafts((d) => {
      const target = idx + dir;
      if (target < 0 || target >= d.length) return d;
      const next = [...d];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((r, i) => ({ ...r, sort_order: i, dirty: true }));
    });
  }

  async function removeRow(idx: number) {
    const row = drafts[idx];
    const used = productCount.get(row.id) ?? 0;
    if (!row.isNew && used > 0) {
      const ok = confirm(
        `${used} produk masih memakai kategori "${row.name}". Jika dihapus, produk-produk itu kehilangan kategori. Lanjut?`,
      );
      if (!ok) return;
    }
    if (!row.isNew) {
      // Delete on backend + local, plus clear category_id on affected products.
      try {
        const api = getBackendClient();
        if (navigator.onLine) {
          await api.from('products').update({ category_id: null }).eq('category_id', row.id);
          const { error } = await api.from('categories').delete().eq('id', row.id);
          if (error) throw error;
        }
        const affected = products.filter((p) => p.category_id === row.id);
        for (const p of affected) {
          await db.products.put({ ...p, category_id: null });
        }
        await db.categories.delete(row.id);
        toast.success('Kategori dihapus.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menghapus kategori.');
        return;
      }
    }
    setDrafts((d) => d.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sort_order: i })));
  }

  async function saveAll() {
    // Validate
    const cleaned: CatRowDraft[] = [];
    for (const r of drafts) {
      const name = r.name.trim();
      if (!name) {
        toast.error('Nama kategori tidak boleh kosong.');
        return;
      }
      cleaned.push({ ...r, name });
    }
    setBusy(true);
    const api = getBackendClient();
    try {
      const rows: Category[] = cleaned.map((r) => ({
        id: r.id,
        store_id: storeId,
        name: r.name,
        icon: r.icon,
        sort_order: r.sort_order,
      }));
      if (navigator.onLine) {
        const { error } = await api.from('categories').upsert(rows);
        if (error) throw error;
      }
      await db.categories.bulkPut(rows);
      toast.success('Kategori tersimpan.');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Kelola Kategori" size="lg">
      <div className="space-y-3">
        <p className="text-xs text-ink-500">
          Kategori muncul sebagai tile di halaman <span className="font-semibold">Menu</span>.
          Pilih ikon yang merepresentasikan kategori — semua perangkat kasir akan menampilkan ikon yang sama.
        </p>

        <div className="space-y-2">
          {drafts.length === 0 && (
            <p className="text-sm text-ink-500 py-4 text-center">
              Belum ada kategori. Klik "Tambah kategori" untuk membuat yang pertama.
            </p>
          )}
          {drafts.map((row, idx) => {
            const Icon = getCategoryIcon(row.icon);
            const used = productCount.get(row.id) ?? 0;
            return (
              <div
                key={row.id}
                className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/40">
                    <Icon size={16} />
                  </span>
                  <Input
                    value={row.name}
                    onChange={(e) => setRow(idx, { name: e.target.value })}
                    placeholder="Nama kategori (cth. Hot Coffee)"
                    className="!py-1.5"
                  />
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="rounded p-0.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-30"
                      title="Pindah ke atas"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === drafts.length - 1}
                      className="rounded p-0.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-30"
                      title="Pindah ke bawah"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                  <button
                    onClick={() => removeRow(idx)}
                    className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    title={used > 0 ? `${used} produk akan kehilangan kategori` : 'Hapus'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-11">
                  {CATEGORY_ICONS.map(({ key, label, Icon: I }) => (
                    <button
                      key={key}
                      onClick={() => setRow(idx, { icon: key })}
                      className={cn(
                        'grid h-8 w-8 place-items-center rounded-lg border transition',
                        row.icon === key
                          ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40'
                          : 'border-ink-200 dark:border-ink-700 text-ink-500 hover:border-brand-300',
                      )}
                      title={label}
                    >
                      <I size={14} />
                    </button>
                  ))}
                </div>
                {used > 0 && (
                  <div className="pl-11 text-[11px] text-ink-500">
                    {used} produk pakai kategori ini.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Button variant="secondary" size="sm" onClick={addRow}>
          <Plus size={14} /> Tambah kategori
        </Button>

        <div className="flex justify-end gap-2 pt-3 border-t border-ink-100 dark:border-ink-800">
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
          <Button onClick={saveAll} disabled={busy}>Simpan</Button>
        </div>
      </div>
    </Modal>
  );
}
