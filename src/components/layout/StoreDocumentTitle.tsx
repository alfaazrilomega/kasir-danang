import { useEffect } from 'react';
import { useLocation } from '@/lib/router';
import { useAuth } from '@/stores/auth';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { fetchPublicCatalog } from '@/lib/publicCatalog';

/** Judul tab mengikuti nama toko yang disimpan admin. */
export function StoreDocumentTitle() {
  const { pathname } = useLocation();
  const storeName = useAuth((s) => s.store?.name);
  const storefront = pathname === '/toko' || pathname.startsWith('/toko/');

  useEffect(() => {
    if (!storefront && storeName?.trim()) {
      document.title = storeName.trim();
      return;
    }
    let alive = true;
    void fetchPublicCatalog(PUBLIC_STORE_ID)
      .then(({ store }) => {
        if (alive) document.title = store?.name?.trim() || 'TokoKu';
      })
      .catch(() => {
        if (alive) document.title = 'TokoKu';
      });
    return () => { alive = false; };
  }, [storefront, storeName]);

  return null;
}
