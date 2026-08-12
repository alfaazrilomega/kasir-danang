import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownAZ,
  ArrowDownUp,
  Coffee,
  Flame,
  Keyboard,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { toast } from 'sonner';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { useCart } from '@/stores/cart';
import { useUI } from '@/stores/ui';
import { resolveFeatures } from '@/lib/industries';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useBarcodeScanner } from '@/lib/barcode';
import { cn, formatMoney } from '@/lib/format';
import type { Product } from '@/types';
import { OrderPanel } from '@/components/cart/OrderPanel';


export function MenuPage() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const features = resolveFeatures(store?.industry, store?.features as never);
  const { add } = useCart();
  const menuDensity = useUI((s) => s.menuDensity);
  const setMenuDensity = useUI((s) => s.setMenuDensity);
  const menuSort = useUI((s) => s.menuSort);
  const setMenuSort = useUI((s) => s.setMenuSort);
  const [category, setCategory] = useState<string | 'all'>('all');
  const [q, setQ] = useState('');
  const [selectedSize, setSelectedSize] = useState<Record<string, string>>({});
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [priceMin, setPriceMin] = useState<number | ''>('');
  const [priceMax, setPriceMax] = useState<number | ''>('');
  const [topOnly, setTopOnly] = useState(false);
  const [hasSizesOnly, setHasSizesOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  const categories =
    useLiveQuery(() => db.categories.where('store_id').equals(storeId).sortBy('sort_order'), [storeId]) ?? [];

  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  // Popularity = sum of qty sold from all order_items. Used for sort + "bestseller" badge.
  const orderItems = useLiveQuery(() => db.order_items.toArray(), []) ?? [];
  const popularity = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of orderItems) {
      if (!it.product_id) continue;
      m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.qty);
    }
    return m;
  }, [orderItems]);
  const topSellerIds = useMemo(() => {
    const entries = Array.from(popularity.entries()).sort((a, b) => b[1] - a[1]);
    return new Set(entries.slice(0, 3).filter(([, n]) => n > 0).map(([id]) => id));
  }, [popularity]);

  const filtered = useMemo(() => {
    const list = products
      .filter((p) => p.is_active)
      .filter((p) => (category === 'all' ? true : p.category_id === category))
      .filter((p) => {
        if (!q) return true;
        const t = q.toLowerCase();
        return (
          p.name.toLowerCase().includes(t) ||
          (p.sku ?? '').toLowerCase().includes(t) ||
          (p.barcode ?? '').toLowerCase().includes(t)
        );
      })
      .filter((p) => matchStock(p, stockFilter))
      .filter((p) => (priceMin === '' ? true : Number(p.base_price) >= priceMin))
      .filter((p) => (priceMax === '' ? true : Number(p.base_price) <= priceMax))
      .filter((p) => (topOnly ? topSellerIds.has(p.id) : true))
      .filter((p) => (hasSizesOnly ? (p.sizes?.length ?? 0) > 0 : true));
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (menuSort) {
        case 'price-asc':
          return Number(a.base_price) - Number(b.base_price);
        case 'price-desc':
          return Number(b.base_price) - Number(a.base_price);
        case 'popular':
          return (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [
    products,
    category,
    q,
    stockFilter,
    priceMin,
    priceMax,
    topOnly,
    hasSizesOnly,
    menuSort,
    popularity,
    topSellerIds,
  ]);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const out: ActiveFilter[] = [];
    if (stockFilter !== 'all')
      out.push({
        key: 'stock',
        label: `Stok: ${STOCK_LABELS[stockFilter]}`,
        clear: () => setStockFilter('all'),
      });
    if (priceMin !== '')
      out.push({
        key: 'priceMin',
        label: `Min ${formatMoney(Number(priceMin), store?.currency)}`,
        clear: () => setPriceMin(''),
      });
    if (priceMax !== '')
      out.push({
        key: 'priceMax',
        label: `Max ${formatMoney(Number(priceMax), store?.currency)}`,
        clear: () => setPriceMax(''),
      });
    if (topOnly)
      out.push({ key: 'top', label: 'Top sellers', clear: () => setTopOnly(false) });
    if (hasSizesOnly)
      out.push({ key: 'sizes', label: 'Punya varian', clear: () => setHasSizesOnly(false) });
    return out;
  }, [stockFilter, priceMin, priceMax, topOnly, hasSizesOnly, store?.currency]);

  const filterCount = activeFilters.length;
  const clearAllFilters = () => {
    setStockFilter('all');
    setPriceMin('');
    setPriceMax('');
    setTopOnly(false);
    setHasSizesOnly(false);
  };

  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  function addToCart(p: Product, sizeOverride?: string) {
    if (p.track_stock && Number(p.stock_qty ?? 0) <= 0) {
      toast.error(`${p.name} stok habis.`);
      return;
    }
    const size = sizeOverride ?? selectedSize[p.id] ?? p.sizes?.[0]?.label ?? null;
    const modifier = p.sizes?.find((s) => s.label === size)?.price_modifier ?? 0;
    add({
      product_id: p.id,
      name: p.name,
      size,
      qty: 1,
      price: Number(p.base_price) + Number(modifier),
      cost_price: Number(p.cost_price ?? 0),
      note: '',
      image_url: p.image_url,
      sku: p.sku,
      track_stock: p.track_stock,
    });
  }

  // Barcode scanner: any time a barcode appears, look up product and add to cart.
  useBarcodeScanner({
    onScan: (code) => {
      const p = products.find(
        (x) => x.barcode === code || x.sku === code,
      );
      if (!p) {
        toast.error(`Produk dengan barcode ${code} tidak ditemukan.`);
        return;
      }
      addToCart(p);
      toast.success(`${p.name} ditambahkan.`);
    },
  });

  // Global keyboard shortcuts (POS).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // "/" → focus search (unless already typing)
      if (e.key === '/' && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      // "?" → show shortcut help
      if (e.key === '?' && !inField) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // F9 or Ctrl/Cmd+Enter → place order
      if (
        e.key === 'F9' ||
        ((e.ctrlKey || e.metaKey) && e.key === 'Enter')
      ) {
        e.preventDefault();
        document.getElementById('btn-place-order')?.click();
        return;
      }
      // Ctrl/Cmd+P → park current order
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        document.getElementById('btn-park-order')?.click();
        return;
      }
      // Ctrl/Cmd+B → toggle cart panel
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        useUI.getState().toggleCart();
        return;
      }
      // Esc (not in field) → clear cart (with quick confirm via toast pattern)
      if (e.key === 'Escape' && !inField) {
        document.getElementById('btn-cancel-order')?.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const totalItems = products.length;

  // Menu now uses the full container width — the OrderPanel floats over the page,
  // so we can be denser on wider screens regardless of cart state.
  const gridCols =
    menuDensity === 'compact'
      ? 'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Menu</h1>
            <p className="text-xs text-ink-500 flex items-center gap-1.5">
              <ScanBarcode size={12} /> Siap menerima barcode scanner — cukup tembakkan ke layar
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SortMenu value={menuSort} onChange={setMenuSort} />
            <DensityToggle value={menuDensity} onChange={setMenuDensity} />
            <div className="relative" ref={filterRef}>
              <Button
                variant={filterCount > 0 ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilterOpen((v) => !v)}
              >
                <SlidersHorizontal size={14} /> Filter
                {filterCount > 0 && (
                  <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[10px] font-bold text-brand-700">
                    {filterCount}
                  </span>
                )}
              </Button>
              {filterOpen && (
                <FilterPanel
                  stockFilter={stockFilter}
                  setStockFilter={setStockFilter}
                  priceMin={priceMin}
                  setPriceMin={setPriceMin}
                  priceMax={priceMax}
                  setPriceMax={setPriceMax}
                  topOnly={topOnly}
                  setTopOnly={setTopOnly}
                  hasSizesOnly={hasSizesOnly}
                  setHasSizesOnly={setHasSizesOnly}
                  showSizesToggle={!!features.useSizes}
                  currency={store?.currency}
                  filterCount={filterCount}
                  onClear={clearAllFilters}
                  onClose={() => setFilterOpen(false)}
                />
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShortcutsOpen(true)}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={14} /> Shortcuts
            </Button>
          </div>
        </div>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-ink-400" />
            <input
              ref={searchRef}
              className="w-full bg-transparent text-sm focus:outline-none"
              placeholder="Cari menu / SKU / barcode...  (tekan / untuk fokus)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  e.currentTarget.blur();
                }
              }}
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-500 font-mono">/</kbd>
          </div>
        </Card>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-ink-500">Filter aktif:</span>
            {activeFilters.map((f) => (
              <button
                key={f.key}
                onClick={f.clear}
                className="group inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-200 dark:bg-brand-950/40 dark:text-brand-200"
              >
                {f.label}
                <X size={12} className="opacity-60 group-hover:opacity-100" />
              </button>
            ))}
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-ink-500 hover:text-ink-700 hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              <RotateCcw size={12} /> Bersihkan semua
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          <CategoryTile
            active={category === 'all'}
            onClick={() => setCategory('all')}
            label="All Menu"
            count={totalItems}
            Icon={Coffee}
          />
          {categories.map((c) => {
            const count = products.filter((p) => p.category_id === c.id).length;
            const Icon = getCategoryIcon(c.icon);
            return (
              <CategoryTile
                key={c.id}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
                label={c.name}
                count={count}
                Icon={Icon}
              />
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              title="Tidak ada produk"
              description="Tambah produk dari halaman Products, atau ubah filter."
            />
          </Card>
        ) : (
          <div className={cn('grid gap-3', gridCols)}>
            {filtered.map((p) => {
              const size = selectedSize[p.id] ?? p.sizes?.[0]?.label ?? '';
              const modifier =
                p.sizes?.find((s) => s.label === size)?.price_modifier ?? 0;
              const low = p.track_stock && Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0);
              const empty = p.track_stock && Number(p.stock_qty ?? 0) <= 0;
              const isTop = topSellerIds.has(p.id);
              const compact = menuDensity === 'compact';
              return (
                <Card
                  key={p.id}
                  className={cn(
                    'group relative overflow-hidden transition-all',
                    empty ? 'opacity-60' : 'hover:-translate-y-0.5 hover:shadow-lg cursor-pointer',
                  )}
                  onClick={() => !empty && addToCart(p)}
                >
                  <div className={cn('relative bg-ink-100 dark:bg-ink-800', compact ? 'aspect-[4/3]' : 'aspect-[5/4]')}>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-ink-400">
                        <Coffee size={28} />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      {isTop && (
                        <Badge tone="warning" className="!bg-amber-100 !text-amber-700 dark:!bg-amber-500/20 dark:!text-amber-300">
                          <Flame size={10} className="mr-0.5" /> Top
                        </Badge>
                      )}
                      {p.track_stock && (
                        <Badge tone={empty ? 'danger' : low ? 'warning' : 'neutral'}>
                          Stok {Number(p.stock_qty ?? 0)}
                        </Badge>
                      )}
                    </div>
                    {!empty && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(p);
                        }}
                        className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-white shadow-lg opacity-0 translate-y-2 transition-all group-hover:opacity-100 group-hover:translate-y-0 hover:bg-brand-700"
                        title={`Tambah ${p.name}`}
                      >
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                  <div className={cn(compact ? 'p-2' : 'p-3')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={cn('truncate font-semibold', compact ? 'text-xs' : 'text-sm')}>{p.name}</div>
                        {!compact && (
                          <div className="text-xs text-ink-500 font-mono">
                            {p.sku ?? p.barcode ?? (p.sizes?.length ? 'Cup Size' : '—')}
                          </div>
                        )}
                      </div>
                      <div className={cn('font-bold', compact ? 'text-xs' : 'text-sm')}>
                        {formatMoney(Number(p.base_price) + Number(modifier))}
                      </div>
                    </div>

                    {features.useSizes && p.sizes?.length ? (
                      <div className="mt-2 flex gap-1.5">
                        {p.sizes.map((s) => (
                          <button
                            key={s.label}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSize({ ...selectedSize, [p.id]: s.label });
                            }}
                            className={cn(
                              'grid place-items-center rounded-full text-xs font-semibold border',
                              compact ? 'h-6 w-6 text-[10px]' : 'h-7 w-7',
                              size === s.label
                                ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40'
                                : 'border-ink-200 dark:border-ink-700 text-ink-600',
                            )}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {!compact && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(p);
                        }}
                        className="mt-3 w-full"
                        size="sm"
                        disabled={empty}
                      >
                        {empty ? 'Stok habis' : 'Add to Cart'}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <OrderPanel />
      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard Shortcuts" size="sm">
        <ul className="space-y-2 text-sm">
          <Shortcut keys={['/']} desc="Fokus pencarian menu" />
          <Shortcut keys={['Esc']} desc="Bersihkan pencarian / batalkan keranjang" />
          <Shortcut keys={['F9']} alt={['Ctrl', 'Enter']} desc="Place Order" />
          <Shortcut keys={['Ctrl', 'P']} desc="Park / hold order saat ini" />
          <Shortcut keys={['Ctrl', 'B']} desc="Sembunyikan / tampilkan panel order" />
          <Shortcut keys={['?']} desc="Buka panduan ini" />
          <li className="border-t border-ink-100 dark:border-ink-800 pt-2 text-xs text-ink-500">
            Barcode scanner aktif otomatis — cukup tembakkan ke layar tanpa fokus apa pun.
          </li>
        </ul>
      </Modal>
    </div>
  );
}

type StockFilter = 'all' | 'in' | 'low' | 'out' | 'untracked';

const STOCK_LABELS: Record<StockFilter, string> = {
  all: 'Semua',
  in: 'Tersedia',
  low: 'Menipis',
  out: 'Habis',
  untracked: 'Tidak dilacak',
};

interface ActiveFilter {
  key: string;
  label: string;
  clear: () => void;
}

function matchStock(p: Product, mode: StockFilter): boolean {
  if (mode === 'all') return true;
  if (mode === 'untracked') return !p.track_stock;
  if (!p.track_stock) return false;
  const qty = Number(p.stock_qty ?? 0);
  const min = Number(p.min_stock ?? 0);
  if (mode === 'in') return qty > min;
  if (mode === 'low') return qty > 0 && qty <= min;
  if (mode === 'out') return qty <= 0;
  return true;
}

function FilterPanel({
  stockFilter,
  setStockFilter,
  priceMin,
  setPriceMin,
  priceMax,
  setPriceMax,
  topOnly,
  setTopOnly,
  hasSizesOnly,
  setHasSizesOnly,
  showSizesToggle,
  currency,
  filterCount,
  onClear,
  onClose,
}: {
  stockFilter: StockFilter;
  setStockFilter: (v: StockFilter) => void;
  priceMin: number | '';
  setPriceMin: (v: number | '') => void;
  priceMax: number | '';
  setPriceMax: (v: number | '') => void;
  topOnly: boolean;
  setTopOnly: (v: boolean) => void;
  hasSizesOnly: boolean;
  setHasSizesOnly: (v: boolean) => void;
  showSizesToggle: boolean;
  currency: string | undefined;
  filterCount: number;
  onClear: () => void;
  onClose: () => void;
}) {
  const stockOptions: StockFilter[] = ['all', 'in', 'low', 'out', 'untracked'];
  const currencySymbol = currency === 'IDR' ? 'Rp' : currency ?? '';
  return (
    <div
      role="dialog"
      className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white p-4 shadow-xl shadow-black/15 ring-1 ring-black/5 dark:bg-ink-900 dark:ring-white/10"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">
          Filter
          {filterCount > 0 && (
            <span className="ml-1.5 text-xs font-normal text-ink-500">
              ({filterCount} aktif)
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-full text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
          aria-label="Tutup filter"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Status stok
        </div>
        <div className="flex flex-wrap gap-1">
          {stockOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setStockFilter(opt)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold transition',
                stockFilter === opt
                  ? 'bg-brand-600 text-white'
                  : 'bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700',
              )}
            >
              {STOCK_LABELS[opt]}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Rentang harga
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1 rounded-xl border border-ink-200 px-2 py-1.5 dark:border-ink-700">
            <span className="text-xs text-ink-500">{currencySymbol}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Min"
              value={priceMin === '' ? '' : priceMin}
              onChange={(e) => {
                const v = e.target.value;
                setPriceMin(v === '' ? '' : Math.max(0, Number(v)));
              }}
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <span className="text-ink-400">—</span>
          <div className="flex flex-1 items-center gap-1 rounded-xl border border-ink-200 px-2 py-1.5 dark:border-ink-700">
            <span className="text-xs text-ink-500">{currencySymbol}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Max"
              value={priceMax === '' ? '' : priceMax}
              onChange={(e) => {
                const v = e.target.value;
                setPriceMax(v === '' ? '' : Math.max(0, Number(v)));
              }}
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="mb-4 space-y-2">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Lainnya
        </div>
        <ToggleRow
          icon={<Flame size={14} />}
          label="Top sellers saja"
          hint="3 produk paling sering terjual."
          checked={topOnly}
          onChange={setTopOnly}
        />
        {showSizesToggle && (
          <ToggleRow
            icon={<LayoutGrid size={14} />}
            label="Punya varian ukuran"
            hint="Hanya produk dengan pilihan S/M/L."
            checked={hasSizesOnly}
            onChange={setHasSizesOnly}
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-ink-100 pt-3 dark:border-ink-800">
        <button
          onClick={onClear}
          disabled={filterCount === 0}
          className="text-xs font-semibold text-ink-500 hover:text-ink-800 disabled:opacity-40 dark:hover:text-ink-200"
        >
          <RotateCcw size={12} className="mr-1 inline" /> Reset
        </button>
        <Button size="sm" onClick={onClose}>
          Selesai
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 transition',
        checked
          ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
          : 'border-transparent bg-ink-50 dark:bg-ink-800',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-brand-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-ink-500">{icon}</span>
          {label}
        </div>
        <div className="text-[11px] text-ink-500">{hint}</div>
      </div>
    </label>
  );
}

function SortMenu({
  value,
  onChange,
}: {
  value: 'name' | 'price-asc' | 'price-desc' | 'popular';
  onChange: (v: 'name' | 'price-asc' | 'price-desc' | 'popular') => void;
}) {
  const labels: Record<string, { icon: typeof ArrowDownAZ; label: string }> = {
    name: { icon: ArrowDownAZ, label: 'Nama A→Z' },
    'price-asc': { icon: ArrowDownUp, label: 'Harga termurah' },
    'price-desc': { icon: ArrowDownUp, label: 'Harga termahal' },
    popular: { icon: Flame, label: 'Terlaris' },
  };
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as typeof value)}
        className="appearance-none rounded-full border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 pl-8 pr-7 py-1.5 text-xs font-semibold focus:outline-none focus:border-brand-500"
        title="Urutkan menu"
      >
        <option value="name">Nama A→Z</option>
        <option value="price-asc">Harga termurah</option>
        <option value="price-desc">Harga termahal</option>
        <option value="popular">Terlaris</option>
      </select>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500">
        {(() => {
          const Icon = labels[value].icon;
          return <Icon size={12} />;
        })()}
      </span>
    </div>
  );
}

function DensityToggle({
  value,
  onChange,
}: {
  value: 'comfy' | 'compact';
  onChange: (v: 'comfy' | 'compact') => void;
}) {
  return (
    <div className="flex rounded-full border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-0.5">
      <button
        onClick={() => onChange('comfy')}
        className={cn(
          'grid h-7 w-7 place-items-center rounded-full',
          value === 'comfy' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-700',
        )}
        title="Tampilan nyaman"
      >
        <LayoutGrid size={13} />
      </button>
      <button
        onClick={() => onChange('compact')}
        className={cn(
          'grid h-7 w-7 place-items-center rounded-full',
          value === 'compact' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-700',
        )}
        title="Tampilan kompak"
      >
        <List size={13} />
      </button>
    </div>
  );
}

function Shortcut({ keys, alt, desc }: { keys: string[]; alt?: string[]; desc: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink-700 dark:text-ink-200">{desc}</span>
      <span className="flex items-center gap-1.5">
        <Keys keys={keys} />
        {alt && (
          <>
            <span className="text-xs text-ink-400">atau</span>
            <Keys keys={alt} />
          </>
        )}
      </span>
    </li>
  );
}
function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-800 px-1.5 py-0.5 text-[11px] font-mono font-semibold"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

function CategoryTile({
  active,
  label,
  count,
  onClick,
  Icon,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  Icon: typeof Coffee;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition',
        active
          ? 'bg-brand-100 text-brand-900 ring-1 ring-brand-500 dark:bg-brand-950/60 dark:text-white'
          : 'bg-white hover:bg-ink-50 text-ink-700 dark:bg-ink-900 dark:hover:bg-ink-800 dark:text-ink-200',
      )}
    >
      <span
        className={cn(
          'grid h-9 w-9 place-items-center rounded-xl',
          active ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800 text-ink-500',
        )}
      >
        <Icon size={16} />
      </span>
      <div>
        <div className="text-sm font-semibold leading-tight">{label}</div>
        <Badge tone="neutral" className="mt-1">{count} Item</Badge>
      </div>
    </button>
  );
}
