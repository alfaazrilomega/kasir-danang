import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowDownUp,
  CalendarDays,
  Copy,
  Percent,
  Pencil,
  Plus,
  Power,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductPicker } from '@/components/data/ProductPicker';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullRecentOrders, pullReference, writeThrough } from '@/lib/sync';
import { cn, formatDate, formatDateTime, formatMoney, uuid } from '@/lib/format';
import type { FlashSale, FlashSaleItem, Promo } from '@/types';

type StatusFilter = 'all' | 'active' | 'upcoming' | 'expired' | 'inactive';
type SortBy = 'recent' | 'code' | 'value-desc' | 'used-desc';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'active', label: 'Aktif' },
  { value: 'upcoming', label: 'Mendatang' },
  { value: 'expired', label: 'Berakhir' },
  { value: 'inactive', label: 'Nonaktif' },
];

interface PromoStatus {
  state: 'active' | 'upcoming' | 'expired' | 'inactive';
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  hint?: string;
}

function promoStatus(p: Promo): PromoStatus {
  if (!p.is_active) return { state: 'inactive', label: 'Nonaktif', tone: 'neutral' };
  const today = new Date().toISOString().slice(0, 10);
  if (p.start_date && p.start_date > today) {
    return { state: 'upcoming', label: 'Mendatang', tone: 'warning', hint: `Mulai ${formatDate(p.start_date)}` };
  }
  if (p.end_date && p.end_date < today) {
    return { state: 'expired', label: 'Berakhir', tone: 'danger', hint: `Berakhir ${formatDate(p.end_date)}` };
  }
  if (p.end_date) {
    const days = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / 86400000);
    if (days <= 7 && days > 0) {
      return { state: 'active', label: 'Aktif', tone: 'success', hint: `${days} hari lagi berakhir` };
    }
  }
  return { state: 'active', label: 'Aktif', tone: 'success' };
}

type FlashState = 'berjalan' | 'terjadwal' | 'selesai' | 'nonaktif';
interface FlashStatus {
  state: FlashState;
  label: string;
  tone: 'success' | 'warning' | 'neutral';
}

function flashSaleStatus(fs: FlashSale): FlashStatus {
  if (!fs.is_active) return { state: 'nonaktif', label: 'Nonaktif', tone: 'neutral' };
  const now = Date.now();
  const start = new Date(fs.starts_at).getTime();
  const end = new Date(fs.ends_at).getTime();
  if (now < start) return { state: 'terjadwal', label: 'Terjadwal', tone: 'warning' };
  if (now > end) return { state: 'selesai', label: 'Selesai', tone: 'neutral' };
  return { state: 'berjalan', label: 'Berjalan', tone: 'success' };
}

/**
 * Input datetime-local menyimpan waktu lokal tanpa info zona. Browser sudah
 * menafsirkan string ini sebagai waktu lokal saat di-parse oleh Date(), jadi
 * toISOString() di sini aman langsung dipakai utk kolom timestamptz — tidak
 * perlu koreksi offset seperti arah sebaliknya di bawah.
 */
function flashInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Kebalikannya: timestamptz dari database (UTC) -> nilai input
 * datetime-local (waktu lokal). Geser dulu dengan offset zona waktu SEBELUM
 * slice, supaya di WIB (UTC+7) jam & tanggalnya tidak mundur ke hari
 * sebelumnya seperti kalau ISO mentah langsung dipotong (pola sama dipakai
 * untuk tanggal kalender di Orders.tsx/Shifts.tsx/Reports.tsx).
 */
function flashIsoToInput(iso: string): string {
  const d = new Date(iso);
  const lokal = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return lokal.toISOString().slice(0, 16);
}

interface FlashItemDraft {
  /** Key stabil utk React list; sama dengan id DB kalau baris ini sudah tersimpan. */
  key: string;
  id?: string;
  product_id: string;
  flash_price: number;
  quota_qty: number | null;
  sold_qty: number;
}

const emptyFlashForm = {
  id: undefined as string | undefined,
  name: '',
  starts_at: '',
  ends_at: '',
  is_active: true,
  items: [] as FlashItemDraft[],
};

const emptyForm: Omit<Promo, 'id' | 'store_id'> = {
  code: '',
  name: '',
  type: 'percent',
  value: 10,
  start_date: null,
  end_date: null,
  is_active: true,
};

function generateCode(): string {
  // 8-char A-Z0-9 (no ambiguous chars).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function Promos() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const currency = store?.currency;
  const [form, setForm] = useState<typeof emptyForm & { id?: string }>(emptyForm);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('recent');

  const [tab, setTab] = useState<'kode' | 'flash'>('kode');
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [flashItemsAll, setFlashItemsAll] = useState<FlashSaleItem[]>([]);
  const [flashLoading, setFlashLoading] = useState(false);
  const [flashOpen, setFlashOpen] = useState(false);
  const [flashForm, setFlashForm] = useState(emptyFlashForm);
  const [flashBusy, setFlashBusy] = useState(false);

  useEffect(() => {
    if (storeId) {
      pullReference(storeId);
      pullRecentOrders(storeId, 500);
    }
  }, [storeId]);

  const promos =
    useLiveQuery(() => db.promos.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  // Produk untuk ProductPicker flash sale; sudah ditarik ke cache lewat
  // pullReference() di atas, sama seperti halaman admin produk lain.
  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  // flash_sales/flash_sale_items sengaja BUKAN tabel Dexie (lihat db.ts) —
  // ambil langsung dari backend dan simpan di state komponen tiap kali tab
  // flash sale dibuka, bukan via useLiveQuery seperti tabel promo kode.
  async function loadFlashData(sid: string) {
    setFlashLoading(true);
    try {
      const api = getBackendClient();
      const [salesRes, itemsRes] = await Promise.all([
        api.from('flash_sales').select('*').eq('store_id', sid).order('starts_at', { ascending: false }),
        api.from('flash_sale_items').select('*').eq('store_id', sid),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (itemsRes.error) throw itemsRes.error;
      setFlashSales((salesRes.data ?? []) as FlashSale[]);
      setFlashItemsAll((itemsRes.data ?? []) as FlashSaleItem[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat flash sale.');
    } finally {
      setFlashLoading(false);
    }
  }

  useEffect(() => {
    if (storeId && tab === 'flash') void loadFlashData(storeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, tab]);

  // Usage stats: how many orders applied each code + total discount given.
  const usage = useLiveQuery(async () => {
    const orders = await db.orders.where('store_id').equals(storeId).toArray();
    const map = new Map<string, { count: number; saved: number }>();
    for (const o of orders) {
      if (!o.promo_code) continue;
      const key = o.promo_code.toUpperCase();
      const prev = map.get(key) ?? { count: 0, saved: 0 };
      prev.count += 1;
      prev.saved += Number(o.discount ?? 0);
      map.set(key, prev);
    }
    return map;
  }, [storeId]) ?? new Map<string, { count: number; saved: number }>();

  const filtered = useMemo(() => {
    const list = promos.filter((p) => {
      const st = promoStatus(p);
      if (statusFilter !== 'all' && st.state !== statusFilter) return false;
      if (q) {
        const t = q.toLowerCase();
        if (!p.code.toLowerCase().includes(t) && !p.name.toLowerCase().includes(t)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sortBy) {
        case 'code':
          return a.code.localeCompare(b.code);
        case 'value-desc':
          // Percent and fixed aren't directly comparable, but within each bucket bigger first.
          // Sort percent before fixed, then by value desc.
          if (a.type !== b.type) return a.type === 'percent' ? -1 : 1;
          return Number(b.value) - Number(a.value);
        case 'used-desc':
          return (usage.get(b.code.toUpperCase())?.count ?? 0) - (usage.get(a.code.toUpperCase())?.count ?? 0);
        case 'recent':
        default:
          // No created_at column, so use start_date desc as proxy, else 0.
          return (b.start_date ?? '').localeCompare(a.start_date ?? '');
      }
    });
    return list;
  }, [promos, statusFilter, q, sortBy, usage]);

  // Header counters.
  const counters = useMemo(() => {
    let active = 0, upcoming = 0, expired = 0, inactive = 0;
    let totalRedeemed = 0;
    let totalSaved = 0;
    for (const p of promos) {
      const st = promoStatus(p);
      if (st.state === 'active') active++;
      else if (st.state === 'upcoming') upcoming++;
      else if (st.state === 'expired') expired++;
      else inactive++;
      const u = usage.get(p.code.toUpperCase());
      if (u) {
        totalRedeemed += u.count;
        totalSaved += u.saved;
      }
    }
    return { total: promos.length, active, upcoming, expired, inactive, totalRedeemed, totalSaved };
  }, [promos, usage]);

  function startNew() {
    setForm(emptyForm);
    setOpen(true);
  }
  function startEdit(p: Promo) {
    setForm({ ...p });
    setOpen(true);
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Kode dan nama promo wajib diisi.');
      return;
    }
    if (form.value <= 0) {
      toast.error('Value harus lebih dari 0.');
      return;
    }
    if (form.type === 'percent' && form.value > 100) {
      toast.error('Persentase maksimal 100%.');
      return;
    }
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      toast.error('Tanggal mulai tidak boleh setelah tanggal selesai.');
      return;
    }
    // Duplicate code check (excluding self when editing).
    const dup = promos.find(
      (p) => p.code.toUpperCase() === form.code.trim().toUpperCase() && p.id !== form.id,
    );
    if (dup) {
      toast.error(`Kode "${form.code.trim().toUpperCase()}" sudah dipakai promo lain.`);
      return;
    }

    if (!storeId) return;
    setBusy(true);
    const api = getBackendClient();
    const row: Promo = {
      id: form.id ?? uuid(),
      store_id: storeId,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      type: form.type,
      value: form.value,
      start_date: form.start_date,
      end_date: form.end_date,
      is_active: form.is_active,
    };
    try {
      if (navigator.onLine) {
        const { error } = await api.from('promos').upsert(row);
        if (error) throw error;
      }
      await db.promos.put(row);
      toast.success(form.id ? 'Promo diperbarui.' : 'Promo ditambahkan.');
      setOpen(false);
      setForm(emptyForm);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Promo) {
    const u = usage.get(p.code.toUpperCase());
    const msg = u && u.count > 0
      ? `Promo "${p.code}" sudah dipakai ${u.count} order. Riwayat order tetap tersimpan, tapi promo tidak akan muncul di pilihan kasir. Hapus?`
      : `Hapus promo "${p.code}"?`;
    if (!confirm(msg)) return;
    const api = getBackendClient();
    if (navigator.onLine) {
      const { error } = await api.from('promos').delete().eq('id', p.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    await db.promos.delete(p.id);
    toast.success('Promo dihapus.');
  }

  async function toggleActive(p: Promo) {
    const next = { ...p, is_active: !p.is_active };
    const api = getBackendClient();
    if (navigator.onLine) {
      const { error } = await api.from('promos').update({ is_active: next.is_active }).eq('id', p.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    await db.promos.put(next);
    toast.success(next.is_active ? 'Promo diaktifkan.' : 'Promo dinonaktifkan.');
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Kode "${code}" disalin.`);
    } catch {
      toast.error('Gagal menyalin.');
    }
  }

  function formatPromoValue(p: Promo): string {
    return p.type === 'percent' ? `${p.value}%` : formatMoney(Number(p.value), currency);
  }

  function itemCountFor(flashSaleId: string): number {
    return flashItemsAll.filter((i) => i.flash_sale_id === flashSaleId).length;
  }

  function startNewFlash() {
    const now = new Date();
    const later = new Date(now.getTime() + 24 * 3600_000);
    setFlashForm({
      id: undefined,
      name: '',
      starts_at: flashIsoToInput(now.toISOString()),
      ends_at: flashIsoToInput(later.toISOString()),
      is_active: true,
      items: [],
    });
    setFlashOpen(true);
  }

  function startEditFlash(fs: FlashSale) {
    const items: FlashItemDraft[] = flashItemsAll
      .filter((i) => i.flash_sale_id === fs.id)
      .map((i) => ({
        key: i.id,
        id: i.id,
        product_id: i.product_id,
        flash_price: Number(i.flash_price),
        quota_qty: i.quota_qty === null ? null : Number(i.quota_qty),
        sold_qty: Number(i.sold_qty ?? 0),
      }));
    setFlashForm({
      id: fs.id,
      name: fs.name,
      starts_at: flashIsoToInput(fs.starts_at),
      ends_at: flashIsoToInput(fs.ends_at),
      is_active: fs.is_active,
      items,
    });
    setFlashOpen(true);
  }

  function addFlashItemRow() {
    setFlashForm((f) => ({
      ...f,
      items: [...f.items, { key: uuid(), product_id: '', flash_price: 0, quota_qty: null, sold_qty: 0 }],
    }));
  }

  function updateFlashItemRow(key: string, patch: Partial<FlashItemDraft>) {
    setFlashForm((f) => ({
      ...f,
      items: f.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }));
  }

  function removeFlashItemRow(key: string) {
    setFlashForm((f) => ({ ...f, items: f.items.filter((it) => it.key !== key) }));
  }

  async function saveFlash() {
    if (!flashForm.name.trim()) {
      toast.error('Nama sesi flash sale wajib diisi.');
      return;
    }
    if (!flashForm.starts_at || !flashForm.ends_at) {
      toast.error('Waktu mulai dan selesai wajib diisi.');
      return;
    }
    const startsIso = flashInputToIso(flashForm.starts_at);
    const endsIso = flashInputToIso(flashForm.ends_at);
    if (startsIso >= endsIso) {
      toast.error('Waktu mulai harus sebelum waktu selesai.');
      return;
    }

    // Baris yang belum pilih produk (ditambah lalu dibatalkan) dibuang diam-diam.
    const validItems = flashForm.items.filter((it) => it.product_id);
    for (const it of validItems) {
      if (!it.flash_price || it.flash_price <= 0) {
        toast.error('Harga flash harus lebih dari 0 untuk semua produk.');
        return;
      }
    }
    const dupIds = validItems.map((it) => it.product_id);
    if (new Set(dupIds).size !== dupIds.length) {
      toast.error('Satu produk hanya boleh muncul sekali dalam satu sesi.');
      return;
    }

    if (!storeId) return;
    setFlashBusy(true);
    try {
      const sessionId = flashForm.id ?? uuid();
      const sessionRow: FlashSale = {
        id: sessionId,
        store_id: storeId,
        name: flashForm.name.trim(),
        starts_at: startsIso,
        ends_at: endsIso,
        is_active: flashForm.is_active,
      };
      await writeThrough('flash_sales', 'upsert', sessionRow);

      // Produk yang tadinya ada di sesi ini tapi dibuang dari form dihapus
      // dari database, bukan cuma dari state lokal.
      const removedIds = flashForm.id
        ? flashItemsAll
            .filter((i) => i.flash_sale_id === sessionId && !validItems.some((it) => it.id === i.id))
            .map((i) => i.id)
        : [];
      for (const rid of removedIds) {
        await writeThrough('flash_sale_items', 'delete', null, { column: 'id', value: rid });
      }

      if (validItems.length) {
        // sold_qty sengaja TIDAK disertakan: kolom itu milik alur checkout
        // (dinaikkan atomik di POST /api/public/orders), menulisnya dari sini
        // bisa menimpa hitungan yang sedang berjalan.
        const itemRows = validItems.map((it) => ({
          id: it.id ?? uuid(),
          store_id: storeId,
          flash_sale_id: sessionId,
          product_id: it.product_id,
          flash_price: it.flash_price,
          quota_qty: it.quota_qty,
        }));
        await writeThrough('flash_sale_items', 'upsert', itemRows);
      }

      toast.success(flashForm.id ? 'Sesi flash sale diperbarui.' : 'Sesi flash sale dibuat.');
      setFlashOpen(false);
      await loadFlashData(storeId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan sesi flash sale.');
    } finally {
      setFlashBusy(false);
    }
  }

  async function toggleActiveFlash(fs: FlashSale) {
    try {
      await writeThrough('flash_sales', 'update', { is_active: !fs.is_active }, { column: 'id', value: fs.id });
      toast.success(!fs.is_active ? 'Sesi diaktifkan.' : 'Sesi dinonaktifkan.');
      await loadFlashData(storeId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengubah status sesi.');
    }
  }

  async function deleteFlash(fs: FlashSale) {
    const count = itemCountFor(fs.id);
    const msg = count > 0
      ? `Sesi "${fs.name}" punya ${count} produk. Hapus sesi beserta semua produknya?`
      : `Hapus sesi "${fs.name}"?`;
    if (!confirm(msg)) return;
    try {
      const itemIds = flashItemsAll.filter((i) => i.flash_sale_id === fs.id).map((i) => i.id);
      for (const id of itemIds) {
        await writeThrough('flash_sale_items', 'delete', null, { column: 'id', value: id });
      }
      await writeThrough('flash_sales', 'delete', null, { column: 'id', value: fs.id });
      toast.success('Sesi flash sale dihapus.');
      await loadFlashData(storeId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghapus sesi.');
    }
  }

  const hasFilter = q !== '' || statusFilter !== 'all';

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Promos</h1>
          <p className="opacity-80 text-sm">
            {counters.total} promo · {counters.active} aktif
            {counters.upcoming > 0 && ` · ${counters.upcoming} mendatang`}
            {counters.expired > 0 && ` · ${counters.expired} berakhir`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'kode' ? (
            <>
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
                <Search size={14} />
                <input
                  className="bg-transparent placeholder:text-white/70 focus:outline-none w-40"
                  placeholder="Cari kode / nama"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <Button onClick={startNew} variant="onBrand">
                <Plus size={16} /> Tambah Promo
              </Button>
            </>
          ) : (
            <Button onClick={startNewFlash} variant="onBrand">
              <Plus size={16} /> Tambah Sesi
            </Button>
          )}
        </div>
      </div>

      {/* Kode promo dan flash sale sama-sama "promosi" di mata pemilik toko,
          jadi satu tab di halaman ini, bukan menu admin baru. */}
      <div className="flex gap-1 rounded-full bg-ink-100 dark:bg-ink-800 p-1 w-fit text-sm font-semibold">
        <button
          onClick={() => setTab('kode')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3.5 py-1.5',
            tab === 'kode' ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
          )}
        >
          <Tag size={14} /> Kode Promo
        </button>
        <button
          onClick={() => setTab('flash')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3.5 py-1.5',
            tab === 'flash' ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
          )}
        >
          <Zap size={14} /> Flash Sale
        </button>
      </div>

      {tab === 'kode' && (
      <>
      {/* Stats cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Tag} label="Total Promo" value={String(counters.total)} hint={`${counters.active} aktif`} />
        <StatTile
          icon={Sparkles}
          label="Total Redemption"
          value={String(counters.totalRedeemed)}
          hint="Order yang pakai promo"
        />
        <StatTile
          icon={Percent}
          label="Total Diskon Diberikan"
          value={formatMoney(counters.totalSaved, currency)}
          hint="Akumulasi semua redemption"
        />
        <StatTile
          icon={CalendarDays}
          label="Perlu Perhatian"
          value={String(counters.upcoming + counters.expired)}
          hint={`${counters.upcoming} mendatang · ${counters.expired} berakhir`}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            label="Status"
            options={STATUS_TABS}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
          <div className="ml-auto">
            <SortDropdown value={sortBy} onChange={setSortBy} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        {filtered.length === 0 ? (
          <EmptyState
            title={hasFilter ? 'Tidak ada promo cocok' : 'Belum ada promo'}
            description={hasFilter ? 'Coba ubah filter atau kata kunci.' : 'Buat promo untuk diaplikasikan ke order.'}
            action={!hasFilter ? <Button onClick={startNew}><Plus size={16} /> Tambah Promo</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Kode</th>
                  <th className="py-2">Nama</th>
                  <th className="py-2">Tipe</th>
                  <th className="py-2 text-right">Value</th>
                  <th className="py-2">Periode</th>
                  <th className="py-2 text-right">Dipakai</th>
                  <th className="py-2 text-right">Diskon diberi</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const st = promoStatus(p);
                  const u = usage.get(p.code.toUpperCase());
                  return (
                    <tr key={p.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold uppercase">{p.code}</span>
                          <button
                            onClick={() => copyCode(p.code)}
                            className="rounded p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800 hover:text-ink-700 dark:hover:text-ink-200"
                            title="Salin kode"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="py-3">{p.name}</td>
                      <td className="py-3 capitalize">{p.type}</td>
                      <td className="py-3 text-right font-semibold">{formatPromoValue(p)}</td>
                      <td className="py-3 text-xs">
                        {p.start_date || p.end_date ? (
                          <>
                            <div>
                              {p.start_date ? formatDate(p.start_date) : '…'} → {p.end_date ? formatDate(p.end_date) : '…'}
                            </div>
                            {st.hint && <div className="text-[11px] text-ink-500">{st.hint}</div>}
                          </>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {u ? <span className="font-semibold">{u.count}×</span> : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="py-3 text-right text-rose-600">
                        {u ? formatMoney(u.saved, currency) : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="py-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => startEdit(p)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActive(p)}
                            className={cn(
                              'rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800',
                              !p.is_active && 'text-ink-400',
                            )}
                            title={p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <Power size={14} />
                          </button>
                          <button
                            onClick={() => remove(p)}
                            className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                            title="Hapus"
                          >
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
      </>
      )}

      {tab === 'flash' && (
      <Card className="p-5">
        {flashLoading ? (
          <p className="py-6 text-center text-sm text-ink-500">Memuat sesi flash sale...</p>
        ) : flashSales.length === 0 ? (
          <EmptyState
            title="Belum ada sesi flash sale"
            description="Buat sesi untuk menjual produk dengan harga diskon pada jendela waktu tertentu."
            action={<Button onClick={startNewFlash}><Plus size={16} /> Tambah Sesi</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Nama</th>
                  <th className="py-2">Periode</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Produk</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {flashSales.map((fs) => {
                  const st = flashSaleStatus(fs);
                  return (
                    <tr key={fs.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-3 font-medium">{fs.name}</td>
                      <td className="py-3 text-xs">
                        {formatDateTime(fs.starts_at)} → {formatDateTime(fs.ends_at)}
                      </td>
                      <td className="py-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="py-3 text-right">{itemCountFor(fs.id)}</td>
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => startEditFlash(fs)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActiveFlash(fs)}
                            className={cn(
                              'rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800',
                              !fs.is_active && 'text-ink-400',
                            )}
                            title={fs.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <Power size={14} />
                          </button>
                          <button
                            onClick={() => deleteFlash(fs)}
                            className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                            title="Hapus"
                          >
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
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Promo' : 'Tambah Promo'} size="md">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1.5">Kode</label>
            <div className="flex gap-1.5">
              <input
                className="input font-mono uppercase tracking-wider"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setForm({ ...form, code: generateCode() })}
                title="Generate kode acak"
              >
                <Wand2 size={12} /> Generate
              </Button>
            </div>
            <p className="text-[11px] text-ink-500 mt-1">
              Dipakai kasir saat input promo. Hanya huruf, angka, dan strip.
            </p>
          </div>

          <div className="md:col-span-2">
            <Input
              label="Nama (terlihat di list promo)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="cth. Diskon Selamat Datang 10%"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Tipe diskon</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setForm({ ...form, type: 'percent' })}
                className={cn(
                  'rounded-xl border-2 px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1.5',
                  form.type === 'percent'
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/30'
                    : 'border-ink-200 dark:border-ink-700',
                )}
              >
                <Percent size={14} /> Persen
              </button>
              <button
                onClick={() => setForm({ ...form, type: 'fixed' })}
                className={cn(
                  'rounded-xl border-2 px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1.5',
                  form.type === 'fixed'
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/30'
                    : 'border-ink-200 dark:border-ink-700',
                )}
              >
                <Tag size={14} /> Tetap
              </button>
            </div>
          </div>

          <Input
            label={form.type === 'percent' ? 'Persentase (%)' : `Nominal (${currency ?? 'IDR'})`}
            type="number"
            min={0}
            max={form.type === 'percent' ? 100 : undefined}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) || 0 })}
            hint={
              form.type === 'percent'
                ? 'Maks 100%. Contoh: 10 → potong 10% dari subtotal.'
                : 'Potongan tetap, dipotong dari subtotal.'
            }
          />

          <Input
            label="Mulai (opsional)"
            type="date"
            value={form.start_date ?? ''}
            onChange={(e) => setForm({ ...form, start_date: e.target.value || null })}
          />
          <Input
            label="Selesai (opsional)"
            type="date"
            value={form.end_date ?? ''}
            onChange={(e) => setForm({ ...form, end_date: e.target.value || null })}
          />

          <label className="md:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Aktifkan promo (boleh dipakai di kasir)
          </label>

          {/* Live preview */}
          <div className="md:col-span-2 rounded-xl border border-dashed border-ink-200 dark:border-ink-700 p-3 bg-ink-50 dark:bg-ink-900/60">
            <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">Preview di kasir</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono font-semibold uppercase">{form.code || 'KODE'}</div>
                <div className="text-xs text-ink-500">{form.name || 'Nama promo'}</div>
              </div>
              <div className="text-sm font-bold text-brand-600">
                {form.type === 'percent'
                  ? `${form.value || 0}%`
                  : formatMoney(form.value || 0, currency)}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-ink-100 dark:border-ink-800">
          <Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={save} disabled={busy}>Simpan</Button>
        </div>
      </Modal>

      <Modal
        open={flashOpen}
        onClose={() => setFlashOpen(false)}
        title={flashForm.id ? 'Edit Sesi Flash Sale' : 'Tambah Sesi Flash Sale'}
        size="xl"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Nama sesi"
              name="flash_name"
              value={flashForm.name}
              onChange={(e) => setFlashForm({ ...flashForm, name: e.target.value })}
              placeholder="cth. Flash Sale Gajian"
            />
          </div>

          <Input
            label="Mulai"
            name="flash_starts_at"
            type="datetime-local"
            value={flashForm.starts_at}
            onChange={(e) => setFlashForm({ ...flashForm, starts_at: e.target.value })}
          />
          <Input
            label="Selesai"
            name="flash_ends_at"
            type="datetime-local"
            value={flashForm.ends_at}
            onChange={(e) => setFlashForm({ ...flashForm, ends_at: e.target.value })}
          />

          <label className="md:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={flashForm.is_active}
              onChange={(e) => setFlashForm({ ...flashForm, is_active: e.target.checked })}
            />
            Aktifkan sesi (tampil di toko online saat periodenya berjalan)
          </label>

          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium">Produk dalam sesi</label>
              <Button variant="secondary" size="sm" onClick={addFlashItemRow}>
                <Plus size={12} /> Tambah Produk
              </Button>
            </div>

            {flashForm.items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-200 dark:border-ink-700 px-3 py-3 text-xs text-ink-500">
                Belum ada produk. Tambah produk untuk diberi harga flash sale.
              </p>
            ) : (
              <div className="space-y-2">
                {flashForm.items.map((it) => {
                  const product = products.find((p) => p.id === it.product_id);
                  const discountPct =
                    product && product.base_price > 0 && it.flash_price > 0
                      ? Math.round((1 - it.flash_price / product.base_price) * 100)
                      : null;
                  const overPriced = product ? it.flash_price > product.base_price : false;
                  return (
                    <div key={it.key} className="rounded-xl border border-ink-200 dark:border-ink-700 p-2.5">
                      <div className="flex items-center gap-2">
                        <ProductPicker
                          className="flex-1"
                          products={products}
                          value={it.product_id}
                          onChange={(id) => updateFlashItemRow(it.key, { product_id: id })}
                          excludeIds={flashForm.items
                            .filter((other) => other.key !== it.key)
                            .map((other) => other.product_id)}
                        />
                        <input
                          type="number"
                          min={0}
                          className="input !py-1.5 w-32"
                          placeholder="Harga flash"
                          value={it.flash_price || ''}
                          onChange={(e) => updateFlashItemRow(it.key, { flash_price: parseFloat(e.target.value) || 0 })}
                          title="Harga flash sale"
                        />
                        <input
                          type="number"
                          min={0}
                          className="input !py-1.5 w-28"
                          placeholder="Tanpa batas"
                          value={it.quota_qty ?? ''}
                          onChange={(e) =>
                            updateFlashItemRow(it.key, {
                              quota_qty: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                            })
                          }
                          title="Kuota (kosongkan = tanpa batas)"
                        />
                        <button
                          type="button"
                          onClick={() => removeFlashItemRow(it.key)}
                          className="rounded-lg p-2 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                          title="Hapus produk ini dari sesi"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {product && it.flash_price > 0 && (
                        <div className="mt-1.5 pl-1 text-xs">
                          {overPriced ? (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                              <AlertTriangle size={12} /> Harga flash di atas harga normal ({formatMoney(product.base_price, currency)}).
                            </span>
                          ) : (
                            <span className="text-ink-500">
                              Normal {formatMoney(product.base_price, currency)} · Diskon {discountPct}%
                              {it.id && ` · Terjual ${it.sold_qty}`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-ink-100 dark:border-ink-800">
          <Button variant="secondary" onClick={() => setFlashOpen(false)}>Batal</Button>
          <Button onClick={saveFlash} disabled={flashBusy}>Simpan</Button>
        </div>
      </Modal>
    </div>
  );
}

function StatTile({
  icon: Icon, label, value, hint,
}: { icon: typeof Tag; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-ink-500">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50">
          <Icon size={14} />
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-500">{hint}</div>}
    </Card>
  );
}

function FilterChips<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-ink-500">{label}:</span>
      <div className="flex gap-1 rounded-full bg-ink-100 dark:bg-ink-800 p-1 text-xs font-semibold">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full px-2.5 py-1',
              value === o.value ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortDropdown({ value, onChange }: { value: SortBy; onChange: (v: SortBy) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortBy)}
        className="appearance-none rounded-full border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 pl-7 pr-7 py-1.5 text-xs font-semibold focus:outline-none focus:border-brand-500"
        title="Urutkan"
      >
        <option value="recent">Terbaru</option>
        <option value="code">Kode A→Z</option>
        <option value="value-desc">Value tertinggi</option>
        <option value="used-desc">Paling sering dipakai</option>
      </select>
      <ArrowDownUp size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
    </div>
  );
}
