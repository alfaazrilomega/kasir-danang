import { useEffect, useMemo, useState } from 'react';
import { Search, ShoppingBag, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PublicShell } from '@/components/layout/PublicShell';
import { Link } from '@/lib/router';
import { formatMoney, cn } from '@/lib/format';
import { fetchPublicCatalog, type PublicCatalogData } from '@/lib/publicCatalog';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { usePublicCart } from '@/stores/publicCart';

const EMPTY: PublicCatalogData = { store: null, categories: [], products: [] };

type SortKey = 'terbaru' | 'harga-asc' | 'harga-desc' | 'nama-asc';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'terbaru', label: 'Paling Sesuai' },
  { value: 'harga-asc', label: 'Harga Terendah' },
  { value: 'harga-desc', label: 'Harga Tertinggi' },
  { value: 'nama-asc', label: 'Nama A-Z' },
];

/**
 * Katalog publik, tanpa login. Data dari GET /api/public/catalog (bukan
 * pullCustomerCatalog/Dexie — itu lewat /api/query yang menolak permintaan
 * tanpa sesi, lihat src/lib/publicCatalog.ts).
 *
 * Penyaringnya mengikuti kebiasaan marketplace: satu baris Urutkan + tombol
 * Filter yang membuka panel centang BANYAK kategori sekaligus, bukan chip
 * kategori yang cuma bisa dipilih satu.
 */
export function PublicCatalog() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('terbaru');
  const [pickedCategories, setPickedCategories] = useState<string[]>([]);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [catalog, setCatalog] = useState<PublicCatalogData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const add = usePublicCart((s) => s.add);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((data) => alive && setCatalog(data))
      .catch((err) => alive && toast.error(err instanceof Error ? err.message : 'Gagal memuat katalog.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const { store, categories, products } = catalog;

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // Kategori kosong tidak ditawarkan — pilihan yang tidak menghasilkan apa-apa
  // hanya membuat pembeli mengira katalognya rusak.
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (!p.category_id) continue;
      counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    }
    return categories
      .filter((c) => (counts.get(c.id) ?? 0) > 0)
      .map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
  }, [categories, products]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = products.filter((p) => {
      if (pickedCategories.length && !pickedCategories.includes(p.category_id ?? '')) return false;
      if (hideEmpty && p.track_stock && Number(p.stock_qty ?? 0) <= 0) return false;
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    const sorted = [...list];
    switch (sort) {
      case 'harga-asc':
        sorted.sort((a, b) => Number(a.base_price) - Number(b.base_price));
        break;
      case 'harga-desc':
        sorted.sort((a, b) => Number(b.base_price) - Number(a.base_price));
        break;
      case 'nama-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'id'));
        break;
      default:
        break;
    }
    return sorted;
  }, [products, q, sort, pickedCategories, hideEmpty]);

  const activeFilterCount = pickedCategories.length + (hideEmpty ? 1 : 0);

  function toggleCategory(id: string) {
    setPickedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function resetFilters() {
    setPickedCategories([]);
    setHideEmpty(false);
  }

  return (
    <PublicShell>
      <div className="space-y-4">
        <div className="rounded-2xl bg-brand-600 px-5 py-4 text-white">
          <p className="text-sm font-medium opacity-90">
            Pesan online, dikirim ke alamatmu. Bayar tunai (COD) atau QRIS.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-sm">
            <Search size={15} className="shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-transparent placeholder:text-white/70 focus:outline-none"
              placeholder={`Cari di ${store?.name ?? 'toko'}...`}
            />
          </div>
        </div>

        {/* ---- Baris urutkan + filter ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-500">
            <span className="hidden sm:inline">Urutkan</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="input h-9 w-auto py-0 text-xs"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition',
              activeFilterCount > 0 || filterOpen
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-200'
                : 'border-ink-200 hover:border-brand-300 dark:border-ink-700',
            )}
          >
            <SlidersHorizontal size={14} />
            Filter
            {activeFilterCount > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          <span className="ml-auto text-xs text-ink-500">{shown.length} produk</span>
        </div>

        {/* ---- Panel filter (centang banyak sekaligus) ---- */}
        {filterOpen && (
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Kategori</span>
              <button
                onClick={resetFilters}
                className="text-xs font-medium text-ink-500 hover:text-brand-600 disabled:opacity-40"
                disabled={activeFilterCount === 0}
              >
                Reset filter
              </button>
            </div>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {categoryOptions.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={pickedCategories.includes(c.id)}
                    onChange={() => toggleCategory(c.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-ink-400">{c.count}</span>
                </label>
              ))}
            </div>
            <div className="border-t border-ink-100 pt-3 dark:border-ink-800">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={hideEmpty}
                  onChange={(e) => setHideEmpty(e.target.checked)}
                />
                Sembunyikan produk yang stoknya habis
              </label>
            </div>
          </Card>
        )}

        {/* ---- Chip filter aktif ---- */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {pickedCategories.map((id) => (
              <button
                key={id}
                onClick={() => toggleCategory(id)}
                className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-200"
              >
                {categoryById.get(id) ?? 'Kategori'}
                <X size={12} />
              </button>
            ))}
            {hideEmpty && (
              <button
                onClick={() => setHideEmpty(false)}
                className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-200"
              >
                Stok tersedia
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <div className="aspect-square animate-pulse bg-ink-100 dark:bg-ink-800" />
                <div className="space-y-2 p-3">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
                </div>
              </Card>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              title="Produk tidak ditemukan"
              description={
                q ? `Tidak ada produk yang cocok dengan "${q}".` : 'Coba longgarkan filternya.'
              }
              action={
                activeFilterCount > 0 ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Reset filter
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((product) => {
              const outOfStock = product.track_stock && Number(product.stock_qty ?? 0) <= 0;
              return (
                <Card key={product.id} className="flex flex-col overflow-hidden">
                  <Link to={`/toko/produk?id=${product.id}`} className="relative block">
                    <div className="aspect-square bg-ink-100 dark:bg-ink-800">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                          <ShoppingBag size={26} />
                        </div>
                      )}
                    </div>
                    {outOfStock && (
                      <div className="absolute inset-0 grid place-items-center bg-white/70 dark:bg-ink-900/70">
                        <Badge tone="warning">Stok habis</Badge>
                      </div>
                    )}
                  </Link>

                  <div className="flex flex-1 flex-col p-3">
                    <Link to={`/toko/produk?id=${product.id}`} className="min-h-10">
                      <span className="line-clamp-2 text-sm font-medium leading-5 hover:text-brand-600">
                        {product.name}
                      </span>
                    </Link>
                    <div className="mt-1 text-base font-bold text-brand-600">
                      {formatMoney(Number(product.base_price), store?.currency)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">
                      {categoryById.get(product.category_id ?? '') ?? 'Tanpa kategori'}
                    </div>
                    <button
                      className={cn(
                        'mt-2.5 w-full rounded-full py-1.5 text-xs font-semibold transition',
                        outOfStock
                          ? 'cursor-not-allowed bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-600'
                          : 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-200',
                      )}
                      disabled={outOfStock}
                      onClick={() => {
                        add({
                          product_id: product.id,
                          name: product.name,
                          price: Number(product.base_price),
                          image_url: product.image_url,
                        });
                        toast.success(`${product.name} masuk keranjang.`);
                      }}
                    >
                      + Keranjang
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
