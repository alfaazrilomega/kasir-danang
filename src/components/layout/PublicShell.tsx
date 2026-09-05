import { useEffect, useState, type ReactNode } from 'react';
import { ShoppingCart, Store } from 'lucide-react';
import { Link } from '@/lib/router';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { fetchPublicCatalog, type PublicCatalogStore } from '@/lib/publicCatalog';
import { usePublicCart } from '@/stores/publicCart';

/**
 * Header ringan untuk storefront publik. Sengaja TIDAK memakai TopNav/useAuth
 * — halaman ini dikunjungi tanpa login sama sekali.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<PublicCatalogStore | null>(null);
  const cartCount = usePublicCart((s) => s.lines.reduce((sum, l) => sum + l.qty, 0));

  useEffect(() => {
    let alive = true;
    fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((data) => alive && setStore(data.store))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950">
      <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/90 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3 px-4 py-3 md:px-6">
          <Link to="/toko" className="flex items-center gap-2 font-bold text-ink-900 dark:text-ink-100">
            <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-brand-600 text-white">
              {store?.logo_url ? (
                <img src={store.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Store size={18} />
              )}
            </span>
            <span>{store?.name ?? 'TokoKu'}</span>
          </Link>
          <Link
            to="/toko/keranjang"
            className="relative grid h-10 w-10 place-items-center rounded-full bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200"
            aria-label="Keranjang"
          >
            <ShoppingCart size={18} />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1000px] px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
