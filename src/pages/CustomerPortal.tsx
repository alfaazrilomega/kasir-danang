import { useEffect, useMemo, useState } from 'react';
import { Search, ShoppingBag, Store } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { formatMoney } from '@/lib/format';
import { pullCustomerCatalog } from '@/lib/sync';
import { useAuth } from '@/stores/auth';

export function CustomerPortal() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [q, setQ] = useState('');

  useEffect(() => {
    if (storeId) void pullCustomerCatalog(storeId);
  }, [storeId]);

  const categories =
    useLiveQuery(() => db.categories.where('store_id').equals(storeId).sortBy('sort_order'), [storeId]) ?? [];
  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const activeProducts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((product) => product.is_active)
      .filter((product) => !needle || product.name.toLowerCase().includes(needle));
  }, [products, q]);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm opacity-80">
              <Store size={15} /> {store?.name ?? 'Toko'}
            </div>
            <h1 className="mt-2 text-2xl font-bold">Katalog Pembeli</h1>
            <p className="mt-1 max-w-xl text-sm opacity-80">
              Lihat menu dan produk aktif. Pemesanan dan pembayaran tetap diproses kasir.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <Search size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="bg-transparent placeholder:text-white/70 focus:outline-none"
              placeholder="Cari produk"
            />
          </div>
        </div>
      </div>

      {activeProducts.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            title="Belum ada produk aktif"
            description="Produk akan tampil setelah admin atau admin gudang mengaktifkannya."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {activeProducts.map((product) => (
            <Card key={product.id} className="overflow-hidden">
              <div className="aspect-[5/4] bg-ink-100 dark:bg-ink-800">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-ink-400">
                    <ShoppingBag size={32} />
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{product.name}</div>
                    <div className="text-xs text-ink-500">
                      {categoryById.get(product.category_id ?? '') ?? 'Tanpa kategori'}
                    </div>
                  </div>
                  {product.track_stock && Number(product.stock_qty ?? 0) <= 0 && (
                    <Badge tone="warning">Habis</Badge>
                  )}
                </div>
                <div className="mt-3 text-lg font-bold text-brand-600">
                  {formatMoney(Number(product.base_price), store?.currency)}
                </div>
                {product.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-500">{product.description}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
