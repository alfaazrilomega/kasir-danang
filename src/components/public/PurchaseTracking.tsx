import { useEffect } from 'react';
import { useCustomer } from '@/lib/customerAccount';
import { loadConfig } from '@/lib/config';
import { useLocation } from '@/lib/router';
import { lacakPixel, type PeristiwaPixel } from '@/lib/pixelToko';

/** Poll verified paid orders, including redirect returns and manual payments. */
export function PurchaseTracking() {
  const token = useCustomer(s => s.token);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!token) return;
    let active = true;
    let inFlight = false;
    let controller: AbortController | undefined;
    const check = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(`${loadConfig().apiBaseUrl}/api/customer/purchases`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as { data?: PeristiwaPixel[] };
        if (active && Array.isArray(payload.data)) payload.data.forEach(event => {
          if (event.jenis === 'Purchase') lacakPixel(event);
        });
      } catch { /* Tracking retries without interrupting the storefront. */ }
      finally { clearTimeout(timeout); inFlight = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 30000);
    const onVisible = () => { void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [token, pathname]);
  return null;
}
