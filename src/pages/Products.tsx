import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Barcode,
  BoxIcon,
  ChevronRight,
  Copy,
  Download,
  History,
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
import { Input, TextArea } from '@/components/ui/Input';
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
import { findSkuConflict, normalizeSku } from '@/lib/skuLookup';
import { urutNamaSku } from '@/lib/sortProducts';
import { kunciKelompok } from '@/lib/publicCatalog';
import { ImportExportModal } from '@/components/data/ImportExportModal';
import { channelLabel } from '@/lib/channels';
import { cn, formatMoney, uuid } from '@/lib/format';
import { CATEGORY_ICONS, getCategoryIcon } from '@/lib/categoryIcons';
import { formatBytes, resizeImageToDataUrl } from '@/lib/imageUpload';
import { resolveFeatures } from '@/lib/industries';
import { BarcodeLabelModal } from '@/components/products/BarcodeLabelModal';
import { useNavigate } from '@/lib/router';
import type {
  Category,
  Product,
  ProductChannelMapping,
  ProductComponent,
  ProductSize,
  SalesChannel,
} from '@/types';

/** Satu baris isian di "Tambah SKU" — belum jadi produk sampai form disimpan. */
interface VariantDraft {
  key: string;
  sku: string;
  variant_name: string;
  base_price: string;
  stock_qty: string;
}

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
  weight_gram: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  sizes: ProductSize[];
  channelMappings: ChannelMappingDraft[];
  setComponents: SetComponentDraft[];
  brand: string;
  variant_name: string;
  parent_sku: string;
  compare_at_price: number;
  images: string[];
  spec: { label: string; value: string }[];
  variant_label: string;
  warranty_type: string;
  warranty_period: string;
  box_contents: string;
  highlights: string;
  license_type: string;
  license_code: string;
  video_url: string;
  /** Baris "Tambah SKU" yang belum disimpan; lihat VariantDraft. */
  newVariants: VariantDraft[];
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
  weight_gram: 0,
  length_cm: 0,
  width_cm: 0,
  height_cm: 0,
  sizes: [
    { label: 'S', price_modifier: 0 },
    { label: 'M', price_modifier: 5000 },
    { label: 'L', price_modifier: 10000 },
  ],
  channelMappings: [],
  setComponents: [],
  brand: '',
  variant_name: '',
  parent_sku: '',
  compare_at_price: 0,
  images: [],
  spec: [],
  variant_label: '',
  warranty_type: '',
  warranty_period: '',
  box_contents: '',
  highlights: '',
  license_type: '',
  license_code: '',
  video_url: '',
  newVariants: [],
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

/**
 * Dipakai dua kali: memfilter tabel produk DAN menentukan kelompok varian mana
 * yang otomatis dibuka. `kata` sudah dalam huruf kecil (dipangkas sekali oleh
 * pemanggil, bukan tiap baris) supaya perbandingan tidak berulang kali memanggil
 * toLowerCase untuk kata kuncinya sendiri.
 */
function cocokPencarian(p: { name: string; sku?: string | null; barcode?: string | null }, kata: string): boolean {
  return (
    p.name.toLowerCase().includes(kata) ||
    (p.sku ?? '').toLowerCase().includes(kata) ||
    (p.barcode ?? '').toLowerCase().includes(kata)
  );
}

export function Products() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState<Product | null>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  // Baris induk yang statusnya diubah manual oleh user. Kalau kelompoknya
  // tidak ada di sini, keadaan bukanya ikut `bukaOtomatis` (lihat kelompokTampil).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
      products
        .filter((p) => {
          if (!q) return true;
          const t = q.toLowerCase();
          return (
            p.name.toLowerCase().includes(t) ||
            (p.sku ?? '').toLowerCase().includes(t) ||
            (p.barcode ?? '').toLowerCase().includes(t)
          );
        })
        // Urut nama (numeric: "Gear 12" sebelum "Gear 110"). Tanpa ini daftar
        // mengikuti urutan produk dibuat, yang terlihat acak begitu produk
        // sejenis ditambahkan di waktu berbeda.
        .sort(urutNamaSku),
    [products, q],
  );

  // Kelompok tabel: SATU baris per produk seperti di kasir (Menu.tsx), pakai
  // kunciKelompok yang sama supaya dua produk bernama sama dengan SKU Induk
  // berbeda (mis. GEAR-BLKNG-FIZR vs GEAR-BLKNG-FIZR-BLAC) tetap dua baris
  // terpisah. Dikelompokkan dari SELURUH produk toko (bukan `filtered`) supaya
  // varian yang namanya/SKU-nya sendiri tidak cocok kata kunci tetap ikut
  // tampil begitu salah satu saudaranya cocok.
  const kelompokProduk = useMemo(() => {
    const peta = new Map<string, Product[]>();
    for (const p of products) {
      const k = kunciKelompok(p);
      peta.set(k, [...(peta.get(k) ?? []), p]);
    }
    return [...peta.entries()].map(([key, anggota]) => ({
      key,
      anggota: [...anggota].sort(urutNamaSku),
    }));
  }, [products]);

  const kata = q.trim().toLowerCase();

  // Kelompok lolos kalau ADA anggotanya yang cocok kata kunci — bukan harus
  // semua — supaya mencari satu SKU varian tetap menemukan kelompoknya.
  const kelompokTampil = useMemo(
    () =>
      kelompokProduk
        .filter((g) => !kata || g.anggota.some((p) => cocokPencarian(p, kata)))
        .sort((a, b) => urutNamaSku(a.anggota[0], b.anggota[0])),
    [kelompokProduk, kata],
  );

  // Kelompok yang tampil karena pencarian (bukan dibuka manual oleh user)
  // langsung terbuka, supaya SKU varian yang dicari langsung terlihat.
  function bukaTutupKelompok(key: string, bukaOtomatis: boolean) {
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? bukaOtomatis) }));
  }

  const lowStock = useMemo(
    () =>
      products.filter(
        (p) =>
          // Set tidak punya stok sendiri; yang menipis adalah isinya.
          !produkSet.has(p.id) &&
          p.track_stock &&
          Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0),
      ),
    [products, produkSet],
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
      weight_gram: Number(p.weight_gram ?? 0),
      length_cm: Number(p.length_cm ?? 0),
      width_cm: Number(p.width_cm ?? 0),
      height_cm: Number(p.height_cm ?? 0),
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
      brand: p.brand ?? '',
      variant_name: p.variant_name ?? '',
      parent_sku: p.parent_sku ?? '',
      compare_at_price: Number(p.compare_at_price ?? 0),
      images: p.images ?? [],
      spec: p.spec ?? [],
      variant_label: p.variant_label ?? '',
      warranty_type: p.warranty_type ?? '',
      warranty_period: p.warranty_period ?? '',
      box_contents: p.box_contents ?? '',
      highlights: p.highlights ?? '',
      license_type: p.license_type ?? '',
      license_code: p.license_code ?? '',
      video_url: p.video_url ?? '',
      setComponents: (isiByParent.get(p.id) ?? []).map((c, i) => ({
        key: `isi-${c.id}-${i}`,
        component_product_id: c.component_product_id,
        qty: String(c.qty ?? 1),
      })),
      // Kelompok yang sudah ada ditampilkan lewat query produk, bukan disimpan
      // di form; baris "Tambah SKU" selalu mulai kosong tiap form dibuka.
      newVariants: [],
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
      weight_gram: Number(p.weight_gram ?? 0),
      length_cm: Number(p.length_cm ?? 0),
      width_cm: Number(p.width_cm ?? 0),
      height_cm: Number(p.height_cm ?? 0),
      sizes: p.sizes ?? [],
      channelMappings: [],
      // Salinan biasanya variasi baru dari produk yang sama: merek, harga coret,
      // dan foto ikut, tapi label variasinya diisi ulang.
      brand: p.brand ?? '',
      variant_name: '',
      parent_sku: p.parent_sku ?? '',
      compare_at_price: Number(p.compare_at_price ?? 0),
      images: p.images ?? [],
      spec: p.spec ?? [],
      variant_label: p.variant_label ?? '',
      warranty_type: p.warranty_type ?? '',
      warranty_period: p.warranty_period ?? '',
      box_contents: p.box_contents ?? '',
      highlights: p.highlights ?? '',
      license_type: p.license_type ?? '',
      license_code: p.license_code ?? '',
      video_url: p.video_url ?? '',
      // Kalau produk asalnya sebuah set, susunan isinya ikut tersalin — itu
      // bagian yang paling lama diketik ulang. Kalau bukan set, biarkan kosong.
      setComponents: isiSet.map((c, i) => ({
        key: `salin-${i}-${uuid()}`,
        component_product_id: c.component_product_id,
        qty: String(c.qty ?? 1),
      })),
      newVariants: [],
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

    // Baris "Tambah SKU" yang masih kosong sama sekali diabaikan (user klik
    // tombolnya lalu batal isi). Baris yang sudah disentuh wajib punya SKU, dan
    // SKU itu wajib unik dari SKU produk mana pun termasuk sesama baris baru —
    // sama seperti SKU induk di atas, ini dicek di sini karena /api/query
    // menelan error unique index Postgres.
    const variantDrafts = form.newVariants.filter(
      (d) => d.sku.trim() || d.variant_name.trim() || d.base_price.trim() || d.stock_qty.trim(),
    );
    const skuTerpakai = new Set<string>();
    if (skuTrimmed) skuTerpakai.add(normalizeSku(skuTrimmed));
    for (const d of variantDrafts) {
      const varSku = d.sku.trim();
      if (!varSku) {
        toast.error('SKU wajib diisi untuk tiap baris SKU baru.');
        return;
      }
      const clash = findSkuConflict(varSku, products);
      if (clash) {
        toast.error(`SKU "${varSku}" sudah dipakai produk "${clash.name}".`);
        return;
      }
      const norm = normalizeSku(varSku);
      if (skuTerpakai.has(norm)) {
        toast.error(`SKU "${varSku}" dipakai lebih dari satu baris.`);
        return;
      }
      skuTerpakai.add(norm);
    }

    const otherMappings = channelMappings.filter((m) => m.product_id !== form.id);
    const draftError = validateChannelDrafts(form.channelMappings, otherMappings);
    if (draftError) {
      toast.error(draftError);
      return;
    }

    setBusy(true);
    const api = getBackendClient();
    // parent_sku baris baru ikut SKU Induk induknya apa adanya, termasuk saat
    // kosong — JANGAN diisi otomatis dengan SKU produk induk. SKU Induk kosong
    // berarti kelompoknya dibaca dari nama produk (kunciKelompok di
    // publicCatalog.ts), dan baris baru sudah mewarisi nama itu, jadi kelompok
    // tetap menyatu tanpa mengisi apa pun. Mengisi parent_sku diam-diam di sini
    // malah melepas varian LAMA yang parent_sku-nya juga masih kosong, karena
    // mereka jadi berkunci 'nama:...' sedangkan induk dan baris baru berkunci
    // 'induk:...'.
    const parentSkuUntukSimpan = form.parent_sku.trim() || null;
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
      cost_price: isiSet.length ? modalDariIsi(isiSet, products) : form.cost_price,
      stock_qty: form.stock_qty,
      min_stock: form.min_stock,
      weight_gram: form.weight_gram,
      length_cm: form.length_cm,
      width_cm: form.width_cm,
      height_cm: form.height_cm,
      track_stock: form.track_stock,
      brand: form.brand.trim() || null,
      variant_name: form.variant_name.trim() || null,
      parent_sku: parentSkuUntukSimpan,
      compare_at_price: form.compare_at_price,
      images: form.images,
      spec: form.spec.filter((s) => s.label.trim() && s.value.trim()).map((s) => ({ label: s.label.trim(), value: s.value.trim() })),
      variant_label: form.variant_label.trim() || null,
      warranty_type: form.warranty_type.trim() || null,
      warranty_period: form.warranty_period.trim() || null,
      box_contents: form.box_contents.trim() || null,
      highlights: form.highlights.trim() || null,
      license_type: form.license_type.trim() || null,
      license_code: form.license_code.trim() || null,
      video_url: form.video_url.trim() || null,
    };
    try {
      // writeThrough: kalau offline, perubahan masuk antrean dan dikirim saat
      // online lagi. Sebelumnya panggilan API dilewati begitu saja sehingga
      // edit offline hilang tanpa pemberitahuan saat data ditarik ulang.
      const { queued } = await writeThrough('products', 'upsert', row);
      await db.products.put(row);
      // Tiap baris "Tambah SKU" jadi produk sendiri yang mewarisi identitas
      // produk induk (nama, kategori, merek, foto, berat/dimensi, dst.) —
      // hanya SKU, nama variasi, harga jual, dan stok yang berbeda per baris.
      // Pemetaan channel dan isi set milik induk, bukan ikut disalin ke sini.
      for (const d of variantDrafts) {
        const variantRow: Product = {
          id: uuid(),
          store_id: storeId,
          category_id: row.category_id,
          name: row.name,
          description: row.description,
          image_url: row.image_url,
          base_price: Number(d.base_price) || 0,
          sizes: [],
          is_active: row.is_active,
          sku: d.sku.trim(),
          barcode: null,
          cost_price: row.cost_price,
          stock_qty: Number(d.stock_qty) || 0,
          min_stock: 0,
          weight_gram: row.weight_gram,
          length_cm: row.length_cm,
          width_cm: row.width_cm,
          height_cm: row.height_cm,
          track_stock: row.track_stock,
          brand: row.brand,
          variant_name: d.variant_name.trim() || null,
          parent_sku: row.parent_sku,
          compare_at_price: 0,
          images: row.images,
          spec: [],
          variant_label: row.variant_label,
          warranty_type: null,
          warranty_period: null,
          box_contents: null,
          highlights: null,
          license_type: null,
          license_code: null,
          video_url: null,
        };
        await writeThrough('products', 'upsert', variantRow);
        await db.products.put(variantRow);
      }
      await saveChannelMappings(row.id);
      await saveSetComponents(row.id);
      toast.success(
        (queued
          ? 'Produk disimpan lokal. Akan dikirim ke server saat online.'
          : form.id
            ? 'Produk diperbarui.'
            : 'Produk ditambahkan.') +
          (variantDrafts.length ? ` +${variantDrafts.length} SKU baru.` : ''),
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

  /**
   * Satu baris SKU, dipakai untuk produk tanpa varian maupun tiap anggota
   * kelompok yang dibuka. `anggotaKelompok` menambah sedikit indentasi supaya
   * baris terlihat sebagai anak dari baris induk di atasnya, tanpa menambah
   * kolom baru yang bisa melebarkan tabel di layar HP.
   */
  function renderBarisProduk(p: Product, anggotaKelompok = false) {
    const low = p.track_stock && Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0);
    const price = Number(p.base_price);
    const cost = produkSet.has(p.id)
      ? modalDariIsi(isiByParent.get(p.id) ?? [], products)
      : Number(p.cost_price ?? 0);
    const marginAbs = price - cost;
    const marginPct = price > 0 ? (marginAbs / price) * 100 : 0;
    const marginTone =
      cost === 0 ? 'text-ink-400' : marginAbs < 0 ? 'text-rose-600' : marginPct < 20 ? 'text-amber-600' : 'text-emerald-600';
    return (
      <tr
        key={p.id}
        className={cn('border-t border-ink-100 dark:border-ink-800', anggotaKelompok && 'bg-ink-50/60 dark:bg-ink-900/40')}
      >
        <td className="py-3">
          <div className={cn('flex items-center gap-3', anggotaKelompok && 'pl-4 border-l-2 border-ink-200 dark:border-ink-700')}>
            <div className="hidden h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-ink-100 sm:block dark:bg-ink-800">
              {p.image_url && <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              {/* Baris anak menampilkan NAMA VARIASI-nya, bukan mengulang nama
                  induk 13 kali — yang membedakan varian memang variasinya, dan
                  nama panjang yang sama berderet justru menyamarkan bedanya. */}
              <div className="line-clamp-2 font-semibold">
                {anggotaKelompok ? p.variant_name?.trim() || p.sku || p.name : p.name}
              </div>
              {/* Kolom SKU disembunyikan di layar HP, jadi SKU-nya ikut di sini:
                  client bekerja lewat SKU, tidak boleh sampai hilang. */}
              <div className="truncate font-mono text-[11px] text-ink-500 sm:hidden">{p.sku || '—'}</div>
            </div>
          </div>
        </td>
        <td className="hidden py-3 sm:table-cell">
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
        <td className="hidden py-3 lg:table-cell">{categories.find((c) => c.id === p.category_id)?.name ?? '—'}</td>
        <td className="py-3">{formatMoney(price, store?.currency)}</td>
        <td className="hidden py-3 text-ink-500 lg:table-cell">{formatMoney(cost, store?.currency)}</td>
        <td className={cn('hidden py-3 font-semibold lg:table-cell', marginTone)}>
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
        <td className="hidden py-3 sm:table-cell">
          <Badge tone={p.is_active ? 'success' : 'warning'}>
            {p.is_active ? 'Aktif' : 'Nonaktif'}
          </Badge>
        </td>
        <td className="py-3">
          <div className="flex justify-end gap-1">
            <button
              onClick={() => navigate(`/stock-mutation?q=${encodeURIComponent(p.sku || p.name)}`)}
              className="hidden rounded-full p-1.5 hover:bg-ink-100 sm:inline-flex dark:hover:bg-ink-800"
              title="Riwayat keluar-masuk"
            >
              <History size={14} />
            </button>
            <button
              onClick={() => {
                setLabelIds([p.id]);
                setLabelOpen(true);
              }}
              className="hidden rounded-full p-1.5 hover:bg-ink-100 sm:inline-flex dark:hover:bg-ink-800"
              title="Cetak label barcode"
            >
              <Barcode size={14} />
            </button>
            <button onClick={() => startEdit(p)} className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800" title="Edit">
              <Pencil size={14} />
            </button>
            <button onClick={() => startDuplicate(p)} className="hidden rounded-full p-1.5 hover:bg-ink-100 sm:inline-flex dark:hover:bg-ink-800" title="Duplikat">
              <Copy size={14} />
            </button>
            <button onClick={() => remove(p)} className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Hapus">
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  /**
   * Baris induk satu kelompok varian (>= 2 SKU) plus, kalau sedang terbuka,
   * seluruh baris anak-anaknya. Modal dan Margin sengaja "—" di baris induk —
   * menjumlahkan modal antar varian yang harga modalnya beda-beda menyesatkan,
   * bukan sekadar belum diisi.
   */
  function renderBarisKelompok(g: { key: string; anggota: Product[] }) {
    const anggota = g.anggota;
    const wakil = anggota[0];
    const hargaVarian = anggota.map((p) => Number(p.base_price));
    const hargaMin = Math.min(...hargaVarian);
    const hargaMax = Math.max(...hargaVarian);
    const dilacak = anggota.filter((p) => p.track_stock);
    const totalStok = dilacak.reduce((sum, p) => sum + Number(p.stock_qty ?? 0), 0);
    const adaMenipis = dilacak.some((p) => Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0));
    const semuaAktif = anggota.every((p) => p.is_active);
    const semuaNonaktif = anggota.every((p) => !p.is_active);
    const bukaOtomatis = Boolean(kata);
    const terbuka = openGroups[g.key] ?? bukaOtomatis;
    const baris = (
      <tr key={g.key} className="border-t border-ink-100 dark:border-ink-800">
        <td className="py-3">
          <div className="flex items-center gap-2">
            {/* Tombol buka/tutup ditaruh di kolom pertama, bukan kolom aksi
                paling kanan: di layar HP tabel ini harus digeser horizontal
                untuk sampai ke kolom kanan, jadi kelompoknya tidak bisa
                dibuka tanpa menggeser dulu. */}
            <button
              onClick={() => bukaTutupKelompok(g.key, bukaOtomatis)}
              className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-ink-100 dark:hover:bg-ink-800"
              aria-label={terbuka ? `Tutup varian ${wakil.name}` : `Buka varian ${wakil.name}`}
              aria-expanded={terbuka}
            >
              <ChevronRight size={16} className={cn('transition-transform', terbuka && 'rotate-90')} />
            </button>
            <div className="hidden h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-ink-100 sm:block dark:bg-ink-800">
              {wakil.image_url && <img src={wakil.image_url} alt={wakil.name} className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0">
              <div className="line-clamp-3 font-semibold sm:line-clamp-2">{wakil.name}</div>
              <div className="text-xs text-ink-500">
                {anggota.length} varian
                <span className="ml-1 font-mono text-[11px] sm:hidden">· {wakil.parent_sku ?? 'tanpa SKU induk'}</span>
              </div>
            </div>
          </div>
        </td>
        <td className="hidden py-3 sm:table-cell">
          <div className="text-xs font-mono font-semibold text-ink-800 dark:text-ink-200">{wakil.parent_sku ?? '—'}</div>
        </td>
        <td className="hidden py-3 lg:table-cell">{categories.find((c) => c.id === wakil.category_id)?.name ?? '—'}</td>
        <td className="py-3">
          {hargaMin === hargaMax ? (
            <span className="whitespace-nowrap">{formatMoney(hargaMin, store?.currency)}</span>
          ) : (
            <>
              {/* Di HP rentang harga penuh memakan dua sampai tiga baris dan
                  menggencet nama produk, jadi cukup harga terendahnya. */}
              <span className="whitespace-nowrap sm:hidden">dari {formatMoney(hargaMin, store?.currency)}</span>
              <span className="hidden whitespace-nowrap sm:inline">
                {formatMoney(hargaMin, store?.currency)} – {formatMoney(hargaMax, store?.currency)}
              </span>
            </>
          )}
        </td>
        <td className="hidden py-3 text-ink-400 lg:table-cell">—</td>
        <td className="hidden py-3 text-ink-400 lg:table-cell">—</td>
        <td className="py-3">
          {dilacak.length === 0 ? (
            <span className="text-ink-400">—</span>
          ) : (
            <div className={cn('flex items-center gap-1.5', adaMenipis && 'text-amber-600 font-semibold')}>
              {adaMenipis && <AlertTriangle size={12} />}
              {totalStok}
            </div>
          )}
        </td>
        <td className="hidden py-3 sm:table-cell">
          <Badge tone={semuaAktif ? 'success' : semuaNonaktif ? 'warning' : 'neutral'}>
            {semuaAktif ? 'Aktif' : semuaNonaktif ? 'Nonaktif' : 'Campuran'}
          </Badge>
        </td>
        <td className="py-3" />
      </tr>
    );
    return terbuka ? [baris, ...anggota.map((p) => renderBarisProduk(p, true))] : [baris];
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
            onClick={() => {
              setLabelIds([]);
              setLabelOpen(true);
            }}
            variant="onBrand"
          >
            <Barcode size={16} /> Cetak Label
          </Button>
          <Button onClick={() => setImportOpen(true)} variant="onBrand">
            <Upload size={16} /> Impor Produk
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
                {/* Di layar HP kolom Kategori, Modal, Margin, dan Status
                    disembunyikan. Dengan sembilan kolom, nama produk terhimpit
                    sampai pecah delapan baris dan harganya terpotong — tidak
                    terbaca sama sekali. Yang disembunyikan tetap ada di layar
                    lebar dan di formulir tiap produk. */}
                <tr>
                  <th className="w-1/2 py-2 sm:w-auto">Produk</th>
                  <th className="hidden py-2 sm:table-cell">SKU / Barcode</th>
                  <th className="hidden py-2 lg:table-cell">Kategori</th>
                  <th className="py-2">Harga</th>
                  <th className="hidden py-2 lg:table-cell">Modal</th>
                  <th className="hidden py-2 lg:table-cell">Margin</th>
                  <th className="py-2">Stok</th>
                  <th className="hidden py-2 sm:table-cell">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {kelompokTampil.flatMap((g) =>
                  g.anggota.length > 1 ? renderBarisKelompok(g) : [renderBarisProduk(g.anggota[0])],
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Selebar nota Pembelian Supplier: formulir ini memuat isi set, SKU
          platform, dan deskripsi panjang. Di lebar "lg" nama produk pada daftar
          isi set terpotong, dan client tidak bisa memastikan barang yang dipilih
          sudah benar. */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Produk' : 'Tambah Produk'} size="xl">
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
      <BarcodeLabelModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        products={products}
        initialIds={labelIds}
        currency={store?.currency}
      />
      <ImportExportModal
        open={importOpen}
        hanya="produk"
        storeId={storeId}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          if (storeId) void pullInventoryReference(storeId);
        }}
      />
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

/**
 * Modal satu set = jumlah (modal isi x takaran). Modal isi sendiri ikut harga
 * beli terakhir di Pembelian, jadi modal set ikut bergerak tanpa diisi manual.
 */
function modalDariIsi(
  isi: { component_product_id: string; qty: string | number }[],
  products: Product[],
): number {
  const byId = new Map(products.map((p) => [p.id, p]));
  return isi.reduce(
    (sum, d) => sum + Number(byId.get(d.component_product_id)?.cost_price ?? 0) * Number(d.qty || 0),
    0,
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
  const isiTerpilih = form.setComponents.filter((d) => d.component_product_id);
  const adalahSet = isiTerpilih.length > 0;
  const modalSet = modalDariIsi(isiTerpilih, products);
  const cost = adalahSet ? modalSet : Number(form.cost_price);
  // Set tidak punya stok sendiri: pratinjau menampilkan berapa set yang bisa
  // dirakit dari stok isinya, sama seperti di POS.
  const stokPreview = adalahSet
    ? hitungStokSet(
        isiTerpilih.map((d) => ({ component_product_id: d.component_product_id, qty: Number(d.qty || 0) })),
        new Map(products.map((p) => [p.id, p])),
      )
    : Number(form.stock_qty);
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
    // [&>*]:min-w-0 wajib: kolom grid bawaannya tidak boleh menyusut di bawah
    // lebar isi terlebarnya, dan dropdown kategori (yang lebarnya mengikuti nama
    // produk terpanjang) memaksa seluruh formulir melebihi layar HP.
    <div className="grid gap-5 md:grid-cols-[1fr_220px] [&>*]:min-w-0">
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
                  className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
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
              name="brand"
              label="Merek"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="cth. GNNK Racing"
            />
            {/* Deskripsi dipakai untuk menulis detail panjang, jadi diberi
                lebar penuh dan tinggi yang cukup supaya isinya terlihat
                sekaligus tanpa perlu menggulir baris demi baris. */}
            <div className="sm:col-span-2">
              <TextArea
                name="description"
                label="Deskripsi produk"
                rows={8}
                className="min-h-[200px] resize-y leading-relaxed"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Opsional. Tulis detail produk di sini: bahan, ukuran, cara pakai, dan catatan lain. Tekan Enter untuk baris baru."
              />
              <div className="mt-1 text-right text-xs text-ink-500">
                {form.description.length} karakter
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-1.5">Gambar produk</label>
              <ImagePicker
                value={form.image_url}
                onChange={(v) => setForm({ ...form, image_url: v })}
              />
              <GaleriFoto value={form.images} onChange={(v) => setForm({ ...form, images: v })} />
              <DetailTokoOnline form={form} setForm={setForm} />
            </div>
          </div>
        </section>

        {/* Penamaan & variasi ============================================ */}
        <section className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <SeksiPenamaanVariasi form={form} setForm={setForm} products={products} />
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
              placeholder="0"
              value={form.base_price || ''}
              onChange={(e) => setForm({ ...form, base_price: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label={`Harga modal (${currency})`}
              type="number"
              step="0.01"
              placeholder="0"
              value={adalahSet ? modalSet : form.cost_price || ''}
              disabled={adalahSet}
              hint={
                adalahSet
                  ? 'Otomatis: jumlah harga modal isi set, mengikuti harga beli terakhir di Pembelian.'
                  : undefined
              }
              onChange={(e) => setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })}
            />
            <Input
              name="compare_at_price"
              label={`Harga coret (${currency}, opsional)`}
              type="number"
              step="0.01"
              placeholder="0"
              value={form.compare_at_price || ''}
              hint="Harga sebelum diskon. Toko online menampilkannya dicoret beserta persen diskon."
              onChange={(e) => setForm({ ...form, compare_at_price: parseFloat(e.target.value) || 0 })}
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
            {adalahSet ? (
              <span className="flex items-center gap-2 text-sm text-ink-500">
                <Package size={14} /> Set tidak punya stok sendiri. Stoknya mengikuti stok isi set.
              </span>
            ) : (
              <>
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
                    placeholder="0"
                    value={form.stock_qty || ''}
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
              </>
            )}
            {/* Ongkir dihitung dari berat, jadi produk tanpa berat tidak bisa
                dihitung ongkirnya saat integrasi ekspedisi dipasang. */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-500">Berat (gram)</span>
              <input
                className="input !w-28 !py-1.5"
                type="number"
                min="0"
                placeholder="0"
                value={form.weight_gram}
                onChange={(e) => setForm({ ...form, weight_gram: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            {/* Ekspedisi memakai berat volumetrik (P x L x T / 6000) kalau lebih
                besar dari berat timbangan, jadi ukuran paket ikut dibutuhkan. */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-500">Ukuran P×L×T (cm)</span>
              {(['length_cm', 'width_cm', 'height_cm'] as const).map((k) => (
                <input
                  key={k}
                  aria-label={k === 'length_cm' ? 'Panjang (cm)' : k === 'width_cm' ? 'Lebar (cm)' : 'Tinggi (cm)'}
                  className="input !w-16 !py-1.5"
                  type="number"
                  min="0"
                  placeholder={k === 'length_cm' ? 'P' : k === 'width_cm' ? 'L' : 'T'}
                  value={form[k] || ''}
                  onChange={(e) => setForm({ ...form, [k]: parseInt(e.target.value, 10) || 0 })}
                />
              ))}
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
            {(adalahSet || form.track_stock) && (
              <div className="absolute top-2 left-2">
                <Badge
                  tone={
                    stokPreview <= 0
                      ? 'danger'
                      : !adalahSet && stokPreview <= Number(form.min_stock)
                      ? 'warning'
                      : 'neutral'
                  }
                >
                  {adalahSet ? 'Set siap' : 'Stok'} {stokPreview}
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

/**
 * Foto tambahan untuk galeri halaman produk toko online (thumbnail di bawah
 * foto utama, seperti marketplace). Maksimal 8 foto; upload dikecilkan dulu.
 */
function GaleriFoto({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const penuh = value.length >= 8;

  async function tambahFile(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    const baru: string[] = [];
    for (const f of Array.from(files).slice(0, 8 - value.length)) {
      try {
        baru.push((await resizeImageToDataUrl(f, { maxDim: 900, quality: 0.82 })).dataUrl);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses gambar.');
      }
    }
    setBusy(false);
    onChange([...value, ...baru].slice(0, 8));
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-sm font-medium">Foto tambahan (galeri, maks. 8)</div>
      <div className="flex flex-wrap gap-2">
        {value.map((src, i) => (
          <span key={i} className="relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-ink-200 dark:ring-ink-700">
            <img src={src} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Hapus foto"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {!penuh && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-ink-300 text-ink-400 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700"
            aria-label="Tambah foto"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void tambahFile(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {!penuh && (
        <div className="mt-2 flex gap-1.5">
          <input
            className="input !py-1.5 text-xs"
            placeholder="Atau tempel URL gambar https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!/^https?:\/\//i.test(url.trim())}
            onClick={() => {
              onChange([...value, url.trim()].slice(0, 8));
              setUrl('');
            }}
          >
            <Plus size={12} /> Tambah
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Isian halaman produk toko online yang disamakan dengan Lazada: spesifikasi,
 * garansi, isi kotak, kualifikasi, sorotan, dan video. Semua opsional; yang
 * kosong tidak ditampilkan di toko. Nama atribut variasi pindah ke blok
 * "Penamaan & variasi" supaya sepasang dengan nama variasinya.
 */
function DetailTokoOnline({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const ubahSpec = (i: number, kunci: 'label' | 'value', nilai: string) =>
    setForm({ ...form, spec: form.spec.map((s, j) => (j === i ? { ...s, [kunci]: nilai } : s)) });

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Detail halaman toko online</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          name="video_url"
          label="Video produk (tautan)"
          placeholder="https://youtu.be/…"
          value={form.video_url}
          onChange={(e) => setForm({ ...form, video_url: e.target.value })}
        />
        <Input
          name="warranty_type"
          label="Jenis garansi"
          placeholder="cth. Garansi toko"
          value={form.warranty_type}
          onChange={(e) => setForm({ ...form, warranty_type: e.target.value })}
        />
        <Input
          name="warranty_period"
          label="Periode garansi"
          placeholder="cth. 1 Tahun"
          value={form.warranty_period}
          onChange={(e) => setForm({ ...form, warranty_period: e.target.value })}
        />
        <Input
          name="license_type"
          label="Tipe lisensi"
          placeholder="cth. Standar Nasional Indonesia (SNI)"
          value={form.license_type}
          onChange={(e) => setForm({ ...form, license_type: e.target.value })}
        />
        <Input
          name="license_code"
          label="Kode lisensi"
          value={form.license_code}
          onChange={(e) => setForm({ ...form, license_code: e.target.value })}
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium">Spesifikasi</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setForm({ ...form, spec: [...form.spec, { label: '', value: '' }] })}
          >
            <Plus size={12} /> Tambah baris
          </Button>
        </div>
        {form.spec.length === 0 ? (
          <p className="text-xs text-ink-500">Contoh: Bahan: Baja, Model: 415, Warna: Hitam. Merek dan SKU sudah otomatis tampil.</p>
        ) : (
          <div className="space-y-1.5">
            {form.spec.map((s, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  className="input !py-1.5 text-sm"
                  aria-label={`Label spesifikasi ${i + 1}`}
                  placeholder="Label (cth. Bahan)"
                  value={s.label}
                  onChange={(e) => ubahSpec(i, 'label', e.target.value)}
                />
                <input
                  className="input !py-1.5 text-sm"
                  aria-label={`Nilai spesifikasi ${i + 1}`}
                  placeholder="Nilai (cth. Baja)"
                  value={s.value}
                  onChange={(e) => ubahSpec(i, 'value', e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Hapus baris spesifikasi"
                  onClick={() => setForm({ ...form, spec: form.spec.filter((_, j) => j !== i) })}
                  className="grid w-9 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <TextAreaSederhana
        label="Apa yang ada di dalam kotak"
        placeholder="cth. 1 gear depan, 1 kartu garansi"
        value={form.box_contents}
        onChange={(v) => setForm({ ...form, box_contents: v })}
      />
      <TextAreaSederhana
        label="Sorotan (satu poin per baris)"
        placeholder={'Baja karbon tahan aus\nPresisi untuk rantai 415'}
        value={form.highlights}
        onChange={(v) => setForm({ ...form, highlights: v })}
      />
    </div>
  );
}

/**
 * Blok penamaan produk dan variasinya.
 *
 * Client memakai satu nama dasar untuk banyak varian (13T, 14T, 15T) supaya
 * daftar produk tidak penuh nama panjang yang saling mirip. Tiap varian tetap
 * baris produk sendiri dengan SKU sendiri, jadi stok dan penjualannya terlacak
 * per varian. Dua isian itu dikumpulkan di sini beserta hasil akhirnya supaya
 * aturan penamaannya terlihat tanpa harus menyimpan dulu.
 */
function SeksiPenamaanVariasi({
  form,
  setForm,
  products,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  products: Product[];
}) {
  const namaDasar = form.name.trim();
  const namaVariasi = form.variant_name.trim();
  const atribut = form.variant_label.trim() || 'Variasi';
  const sku = form.sku.trim();
  const namaTampil = namaDasar
    ? namaVariasi
      ? `${namaDasar} (${namaVariasi})`
      : namaDasar
    : 'Isi nama produk dulu';

  // Produk lain yang sudah sekelompok (kunci sama seperti kunciKelompok di
  // publicCatalog.ts) ditampilkan apa adanya di sini, bukan diedit — mengedit
  // baris orang lain dari form produk ini gampang salah pencet dan sudah ada
  // formnya sendiri. Diri sendiri dikeluarkan karena sudah terwakili oleh
  // isian di atas.
  const anggotaKelompok = namaDasar
    ? products
        .filter(
          (p) =>
            p.is_active &&
            p.id !== form.id &&
            kunciKelompok(p) === kunciKelompok({ name: form.name, parent_sku: form.parent_sku }),
        )
        .sort(urutNamaSku)
    : [];

  function tambahBarisSku() {
    setForm({
      ...form,
      newVariants: [
        ...form.newVariants,
        { key: uuid(), sku: '', variant_name: '', base_price: '', stock_qty: '' },
      ],
    });
  }
  function ubahBarisSku(key: string, patch: Partial<VariantDraft>) {
    setForm({
      ...form,
      newVariants: form.newVariants.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    });
  }
  function hapusBarisSku(key: string) {
    setForm({ ...form, newVariants: form.newVariants.filter((d) => d.key !== key) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
        <Layers size={14} /> Penamaan &amp; variasi
      </div>
      <p className="text-xs leading-relaxed text-ink-500">
        Satu baris produk = satu SKU. Untuk barang yang sama tapi beda ukuran atau warna,
        isi{' '}<strong className="font-semibold text-ink-600 dark:text-ink-300">SKU Induk</strong> yang
        sama untuk semua variannya, lalu bedakan lewat{' '}
        <strong className="font-semibold text-ink-600 dark:text-ink-300">nama variasi</strong>. Kasir
        dan toko online menampilkannya sebagai satu produk berisi pilihan, sedangkan stok dan
        penjualan tetap terlacak per SKU. Dua produk boleh bernama sama persis asal SKU induknya
        berbeda.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          name="parent_sku"
          label="SKU Induk"
          value={form.parent_sku}
          onChange={(e) => setForm({ ...form, parent_sku: e.target.value })}
          placeholder="cth. GEAR-BLKNG-FIZR-BLAC"
          hint="Sama dengan kolom SKU Induk di ekspor marketplace. Kosong = dikelompokkan lewat nama."
        />
        <Input
          name="variant_name"
          label="Nama variasi"
          value={form.variant_name}
          onChange={(e) => setForm({ ...form, variant_name: e.target.value })}
          placeholder="cth. 13T / Merah"
          hint="Kosongkan kalau produk ini tidak punya varian."
        />
        <Input
          name="variant_label"
          label="Nama atribut variasi"
          placeholder="cth. Ukuran / Warna"
          value={form.variant_label}
          onChange={(e) => setForm({ ...form, variant_label: e.target.value })}
          hint="Judul pilihan variasi di halaman toko online."
        />
      </div>
      <dl className="space-y-1.5 rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-900">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-xs text-ink-500">Nama tampil</dt>
          <dd className={cn('text-right text-sm', namaDasar ? 'font-semibold' : 'text-ink-400')}>
            {namaTampil}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-xs text-ink-500">SKU varian ini</dt>
          <dd className={cn('text-right font-mono text-xs', sku ? 'font-semibold' : 'text-ink-400')}>
            {sku || 'Belum diisi'}
          </dd>
        </div>
        {namaVariasi && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-xs text-ink-500">Pilihan di toko online</dt>
            <dd className="text-right text-xs">
              {atribut}: {namaVariasi}
            </dd>
          </div>
        )}
      </dl>
      <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">SKU dalam kelompok ini</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-[44px] shrink-0"
            onClick={tambahBarisSku}
          >
            <Plus size={12} /> Tambah SKU
          </Button>
        </div>

        {anggotaKelompok.length > 0 && (
          <div className="space-y-1">
            {anggotaKelompok.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[1.2fr_1fr_1fr_0.7fr] gap-2 rounded-lg bg-ink-50 px-2 py-1.5 text-xs dark:bg-ink-900"
              >
                <span className="truncate font-mono">{p.sku || '(tanpa SKU)'}</span>
                <span className="truncate text-ink-500">{p.variant_name || '—'}</span>
                <span className="text-ink-500">{formatMoney(Number(p.base_price))}</span>
                <span className="text-ink-500">Stok {p.stock_qty}</span>
              </div>
            ))}
          </div>
        )}

        {form.newVariants.length > 0 && (
          <div className="space-y-1.5">
            {form.newVariants.map((d) => (
              // Empat kolom sejajar tidak muat di layar HP: input punya lebar
              // bawaan sendiri, jadi barisnya memaksa modal melebar. Di HP
              // dipecah jadi dua kolom, tombol hapus turun ke baris sendiri.
              <div key={d.key} className="grid grid-cols-2 gap-1.5 sm:flex">
                <input
                  className="input !py-1.5 text-sm font-mono min-h-[44px] min-w-0 sm:min-h-0 sm:flex-1"
                  aria-label="SKU variasi baru"
                  placeholder="SKU (wajib)"
                  value={d.sku}
                  onChange={(e) => ubahBarisSku(d.key, { sku: e.target.value })}
                />
                <input
                  className="input !py-1.5 text-sm min-h-[44px] min-w-0 sm:min-h-0 sm:flex-1"
                  aria-label="Nama variasi baru"
                  placeholder="Nama variasi"
                  value={d.variant_name}
                  onChange={(e) => ubahBarisSku(d.key, { variant_name: e.target.value })}
                />
                <input
                  className="input !py-1.5 text-sm min-h-[44px] min-w-0 sm:min-h-0 sm:flex-1"
                  aria-label="Harga jual variasi baru"
                  type="number"
                  placeholder="Harga jual"
                  value={d.base_price}
                  onChange={(e) => ubahBarisSku(d.key, { base_price: e.target.value })}
                />
                <input
                  className="input !py-1.5 text-sm min-h-[44px] min-w-0 sm:min-h-0 sm:flex-1"
                  aria-label="Stok awal variasi baru"
                  type="number"
                  placeholder="Stok awal"
                  value={d.stock_qty}
                  onChange={(e) => ubahBarisSku(d.key, { stock_qty: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="Hapus baris SKU baru"
                  onClick={() => hapusBarisSku(d.key)}
                  className="col-span-2 grid h-[44px] place-items-center rounded-lg border border-ink-200 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:border-ink-700 sm:col-auto sm:h-auto sm:w-9 sm:shrink-0 sm:border-0"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs leading-relaxed text-ink-500">
          Tiap baris "Tambah SKU" jadi produk sendiri saat disimpan, mewarisi nama, kategori,
          merek, dan foto dari produk ini — tidak perlu lagi memakai tombol Salin.
        </p>
      </div>
    </div>
  );
}

function TextAreaSederhana({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <textarea
        className="input min-h-[64px] w-full text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
