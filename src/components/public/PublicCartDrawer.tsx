import { ProductImage } from './ProductImage';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { usePublicCart } from '@/stores/publicCart';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { cn, formatMoney } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import {
  alamatProduk, fetchPublicCatalog, fetchPublicFlashSale, hargaBerlaku, petaFlashAktif,
  type PublicCatalogProduct, type PublicFlashSaleItem,
} from '@/lib/publicCatalog';

export function PublicCartDrawer() {
  const open = usePublicCart((s) => s.drawerOpen);
  const close = usePublicCart((s) => s.closeDrawer);
  const lines = usePublicCart((s) => s.lines);
  const updateQty = usePublicCart((s) => s.updateQty);
  const remove = usePublicCart((s) => s.remove);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [visible, setVisible] = useState(false);
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [flash, setFlash] = useState<Map<string, PublicFlashSaleItem>>(new Map());
  const [currency, setCurrency] = useState('IDR');

  useEffect(() => () => close(), [close]);

  // Native dialog menyediakan focus trap, Escape, dan mengunci interaksi halaman belakang.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    let frame = 0;
    let nextFrame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      if (!element.open) element.showModal();
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
      timer = setTimeout(() => element.close(), duration);
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; };
  }, [open]);

  const previousRoute = useRef(`${pathname}${search}`);
  useEffect(() => {
    const route = `${pathname}${search}`;
    if (previousRoute.current !== route) close();
    previousRoute.current = route;
  }, [pathname, search, close]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchPublicCatalog(PUBLIC_STORE_ID, { forceRefresh: true }).then((data) => {
      if (!alive) return;
      setProducts(data.products ?? []);
      setCurrency(data.store?.currency || 'IDR');
    }).catch(() => {});
    fetchPublicFlashSale(PUBLIC_STORE_ID).then((data) => {
      if (alive) setFlash(petaFlashAktif(data.items));
    }).catch(() => { if (alive) setFlash(new Map()); });
    return () => { alive = false; };
  }, [open]);

  const price = (line: { product_id: string; price: number }) => hargaBerlaku(line, products, flash);
  const subtotal = lines.reduce((sum, line) => sum + price(line) * line.qty, 0);
  const count = lines.reduce((sum, line) => sum + line.qty, 0);

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={close}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-ink-900 outline-none backdrop:bg-transparent dark:text-ink-100"
    >
      <div
        aria-hidden="true"
        onClick={close}
        className={cn('absolute inset-0 bg-black/40 transition-opacity duration-[250ms] motion-reduce:transition-none', visible ? 'opacity-100' : 'opacity-0')}
      />
      <section
        data-cart-panel
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl transition-transform duration-[250ms] ease-out motion-reduce:transition-none lg:w-1/4 dark:bg-ink-900',
          visible ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-100 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] dark:border-ink-800">
          <h2 id={titleId} className="text-base font-semibold">Keranjang belanja <span className="text-sm font-normal text-ink-500">({count})</span></h2>
          <button type="button" autoFocus onClick={close} aria-label="Tutup keranjang" className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full hover:bg-ink-100 dark:hover:bg-ink-800">
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-cart-items>
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
              <ShoppingBag size={44} strokeWidth={1.4} className="text-ink-400" />
              <p className="font-medium">Keranjang masih kosong</p>
              <button type="button" onClick={close} className="min-h-[44px] text-sm font-semibold text-brand-600 dark:text-brand-400">Lanjut belanja</button>
            </div>
          ) : lines.map((line) => {
            const product = products.find((p) => p.id === line.product_id);
            const link = alamatProduk({ id: line.product_id, slug: product?.slug }, line.product_id);
            return (
              <div key={line.product_id} className="flex gap-3 border-b border-ink-100 py-4 last:border-0 dark:border-ink-800">
                <Link to={link} onClick={close} className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-50 dark:bg-ink-800" aria-label={`Lihat ${line.name}`}>
                  {line.image_url ? <ProductImage src={line.image_url} alt="" className="h-full w-full object-contain" /> : <ShoppingBag className="m-4 h-6 w-6 text-ink-400" />}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1">
                    <Link to={link} onClick={close} className="min-w-0 flex-1 break-words text-sm font-medium hover:text-brand-600">{line.name}</Link>
                    <button type="button" onClick={() => remove(line.product_id)} aria-label={`Hapus ${line.name}`} className="-mr-2 -mt-2 grid h-[44px] w-[44px] shrink-0 place-items-center text-ink-400 hover:text-rose-600">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {(line.variant_name || product?.variant_name) && <p className="text-xs text-ink-500">{line.variant_name || product?.variant_name}</p>}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex items-center rounded-lg border border-ink-200 dark:border-ink-700">
                      <button type="button" onClick={() => updateQty(line.product_id, line.qty - 1)} disabled={line.qty <= 1} aria-label={`Kurangi ${line.name}`} className="grid h-[44px] w-9 place-items-center text-brand-600 disabled:text-ink-300 dark:text-brand-400 dark:disabled:text-ink-600"><Minus size={14} /></button>
                      <span className="min-w-6 text-center text-sm tabular-nums" aria-label={`Jumlah ${line.name}`}>{line.qty}</span>
                      <button type="button" onClick={() => updateQty(line.product_id, line.qty + 1)} disabled={line.qty >= 50} aria-label={`Tambah ${line.name}`} className="grid h-[44px] w-9 place-items-center text-brand-600 disabled:text-ink-300 dark:text-brand-400 dark:disabled:text-ink-600"><Plus size={14} /></button>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(price(line), currency)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-ink-100 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 dark:border-ink-800">
          <div className="flex items-center justify-between gap-2 text-sm font-semibold" aria-live="polite">
            <span>Subtotal</span><span data-cart-subtotal className="tabular-nums">{formatMoney(subtotal, currency)}</span>
          </div>
          <p className="mt-1 text-xs text-ink-500">Ongkos kirim ditentukan saat checkout.</p>
          <button
            type="button"
            disabled={!lines.length}
            onClick={() => { close(); navigate('/toko/checkout'); }}
            className="mt-4 h-12 w-full rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >Checkout ({count})</button>
          <Link to="/toko/keranjang" onClick={close} className="mt-1 flex min-h-[44px] items-center justify-center text-sm font-medium text-brand-600 dark:text-brand-400">Lihat keranjang lengkap</Link>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
