import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Flame, MessageCircle, Search, ShoppingCart, Star, Store, UserRound } from 'lucide-react';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { cn } from '@/lib/format';
import { fetchPublicCatalog, type PublicCatalogCategory, type PublicCatalogStore } from '@/lib/publicCatalog';
import { usePublicCart } from '@/stores/publicCart';
import { useCustomer } from '@/lib/customerAccount';

/** Nomor toko menjadi tautan WhatsApp (0812… → 62812…). */
export function tautanWhatsApp(nomor: string | null | undefined, pesan?: string): string | null {
  const angka = (nomor ?? '').replace(/\D/g, '').replace(/^0/, '62');
  if (!angka) return null;
  return `https://wa.me/${angka}${pesan ? `?text=${encodeURIComponent(pesan)}` : ''}`;
}

const LEBAR = 'mx-auto w-full max-w-[1188px] px-4 xl:px-0';
const TAUTAN_KECIL = 'transition-colors duration-200 hover:text-brand-600';

/**
 * Kerangka storefront publik dengan susunan header dan footer Lazada:
 * baris tautan kecil di paling atas (menyusut saat halaman digulir), baris
 * logo + pencarian + keranjang, baris "Kategori" (kecuali di beranda), lalu
 * footer abu-abu dan tombol "Pesan" mengambang. Sengaja TIDAK memakai
 * TopNav/useAuth karena halaman ini dikunjungi tanpa login staf.
 */
export function PublicShell({
  children,
  wide = false,
  beranda = false,
  latar = 'abu',
}: {
  children: ReactNode;
  wide?: boolean;
  /** Beranda Lazada tidak punya baris "Kategori" dan kata kunci populer. */
  beranda?: boolean;
  latar?: 'abu' | 'putih';
}) {
  const [store, setStore] = useState<PublicCatalogStore | null>(null);
  const [categories, setCategories] = useState<PublicCatalogCategory[]>([]);
  const cartCount = usePublicCart((s) => s.lines.reduce((sum, l) => sum + l.qty, 0));
  const token = useCustomer((s) => s.token);
  const me = useCustomer((s) => s.me);
  const muat = useCustomer((s) => s.muat);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const qUrl = pathname === '/toko' ? (new URLSearchParams(search).get('q') ?? '') : '';
  const [cari, setCari] = useState(qUrl);
  const [digulir, setDigulir] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => setCari(qUrl), [qUrl]);

  useEffect(() => {
    if (token && !me) void muat();
  }, [token, me, muat]);

  useEffect(() => {
    let alive = true;
    fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((data) => {
        if (!alive) return;
        setStore(data.store);
        setCategories(data.categories);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Ambang berbeda untuk menyusut dan membuka kembali: saat baris atas
  // menyusut, browser menggeser posisi gulir ±25px; dengan satu ambang saja
  // header akan terus membuka-menutup di dekat bagian atas halaman.
  useEffect(() => {
    const onScroll = () =>
      setDigulir((lama) => (lama ? window.scrollY > 4 : window.scrollY > 60));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Tinggi header dibagikan lewat variabel CSS supaya elemen lengket lain
  // (tab halaman produk) menempel tepat di bawahnya, juga selama menyusut.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const pasang = () => document.documentElement.style.setProperty('--tinggi-header', `${el.offsetHeight}px`);
    pasang();
    const ro = new ResizeObserver(pasang);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const namaToko = store?.name ?? 'TokoKu';
  const wa = tautanWhatsApp(store?.shop_phone, 'Halo, saya mau bertanya.');
  const tautanPesanan = token ? '/toko/akun' : `/toko/masuk?next=${encodeURIComponent('/toko/akun')}`;
  const logo = (ukuran: string, ikon: number) => (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg bg-brand-600 text-white', ukuran)}>
      {store?.logo_url ? <img src={store.logo_url} alt="" className="h-full w-full object-cover" /> : <Store size={ikon} />}
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#eff0f5] text-ink-900 dark:bg-ink-950 dark:text-ink-100">
      <header ref={headerRef} className="sticky top-0 z-30 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:bg-ink-900">
        {/* Baris tautan kecil: tingginya menyusut 0,25 dtk saat halaman digulir. */}
        <div
          className={cn(
            'hidden overflow-hidden bg-white transition-[height] duration-[250ms] ease-linear lg:block dark:bg-ink-900',
            digulir ? 'h-0' : 'h-[25px]',
          )}
        >
          <div className={cn(LEBAR, 'flex h-[25px] items-center justify-end gap-7 text-[12px] uppercase text-ink-500')}>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="text-brand-600 transition-colors duration-200 hover:text-brand-800">
                Layanan Pelanggan
              </a>
            )}
            <Link to={tautanPesanan} className={TAUTAN_KECIL}>
              Lacak Pesanan
            </Link>
            {token ? (
              <Link to="/toko/akun" className={TAUTAN_KECIL}>
                Akun {me?.name.split(' ')[0] ?? 'Saya'}
              </Link>
            ) : (
              <>
                <Link to="/toko/masuk" className={TAUTAN_KECIL}>
                  Masuk
                </Link>
                <Link to="/toko/masuk?tab=daftar" className={TAUTAN_KECIL}>
                  Daftar
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Baris logo, pencarian, keranjang. */}
        <div className={cn(LEBAR, 'flex items-center gap-3 py-3 lg:h-[78px] lg:gap-0 lg:py-0')}>
          <Link to="/toko" className="flex shrink-0 items-center gap-2 lg:w-[204px]">
            {logo('h-9 w-9', 18)}
            <span className="hidden max-w-[150px] truncate text-lg font-bold text-brand-700 sm:block dark:text-brand-200">{namaToko}</span>
          </Link>
          <div className="min-w-0 flex-1 lg:max-w-[686px]">
            <form
              role="search"
              className="flex h-10 lg:h-[42px]"
              onSubmit={(e) => {
                e.preventDefault();
                const kata = cari.trim();
                navigate(kata ? `/toko?q=${encodeURIComponent(kata)}` : '/toko?semua=1');
              }}
            >
              <input
                aria-label="Cari di toko"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder={`Cari di ${namaToko}`}
                className="h-full min-w-0 flex-1 rounded-l-sm bg-[#eff0f5] px-3 text-sm text-ink-800 outline-none placeholder:text-ink-400 dark:bg-ink-800 dark:text-ink-100"
              />
              <button
                type="submit"
                aria-label="Cari"
                className="grid h-full w-10 shrink-0 place-items-center rounded-r-sm bg-brand-600 text-white transition-colors duration-300 hover:bg-brand-700 lg:w-[42px]"
              >
                <Search size={20} />
              </button>
            </form>
            {!beranda && categories.length > 0 && (
              <div className="mt-1 hidden truncate text-[12px] text-ink-400 lg:block">
                {categories.slice(0, 6).map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && <span className="mx-1.5 text-ink-300">/</span>}
                    <Link to={`/toko?kategori=${c.id}`} className="transition-colors duration-300 hover:text-brand-600">
                      {c.name}
                    </Link>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Link
            to={token ? '/toko/akun' : '/toko/masuk'}
            aria-label={token ? 'Akun saya' : 'Masuk'}
            className="grid h-10 w-10 place-items-center text-ink-700 lg:hidden dark:text-ink-200"
          >
            <UserRound size={22} />
          </Link>
          <Link
            to="/toko/keranjang"
            aria-label="Keranjang"
            className="relative grid h-10 w-10 shrink-0 place-items-center text-ink-800 transition-colors duration-300 hover:text-brand-600 lg:ml-[34px] dark:text-ink-100"
          >
            <ShoppingCart size={26} strokeWidth={1.8} />
            {cartCount > 0 && (
              <span className="absolute right-0 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
        </div>

        {/* Baris "Kategori" + tautan cepat (tidak ada di beranda, seperti Lazada). */}
        {!beranda && (
          <div className={cn(LEBAR, 'hidden h-10 items-center lg:flex')}>
            <div className="group relative w-[204px]">
              <button
                type="button"
                className="flex h-10 items-center gap-2 pl-5 text-sm text-ink-800 transition-colors duration-300 hover:text-brand-600 dark:text-ink-100"
              >
                Kategori <ChevronDown size={16} className="transition-transform duration-300 group-hover:rotate-180" />
              </button>
              <div className="invisible absolute left-0 top-full z-40 max-h-[70vh] w-[240px] overflow-y-auto bg-white py-2 opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-[opacity,visibility] duration-300 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 dark:bg-ink-900">
                <Link to="/toko?semua=1" className="block px-4 py-2 text-sm transition-colors duration-300 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-ink-800">
                  Semua Produk
                </Link>
                {categories.map((c) => (
                  <Link
                    key={c.id}
                    to={`/toko?kategori=${c.id}`}
                    className="block px-4 py-2 text-sm transition-colors duration-300 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-ink-800"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
            <nav className="flex items-center gap-8 text-sm" aria-label="Tautan cepat">
              {(
                [
                  ['/toko?semua=1', 'Semua Produk', Store],
                  ['/toko?urut=terlaris', 'Terlaris', Flame],
                  ['/toko?urut=rating', 'Rating Tertinggi', Star],
                ] as const
              ).map(([to, label, Ikon]) => (
                <Link key={to} to={to} className="flex items-center gap-1.5 text-ink-700 transition-colors duration-300 hover:text-brand-600 dark:text-ink-200">
                  <Ikon size={14} className="text-brand-600" /> {label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className={cn('flex-1', latar === 'putih' && 'bg-white dark:bg-ink-900')}>
        <div className={cn('mx-auto w-full px-4 py-4 xl:px-0', wide ? 'max-w-[1188px]' : 'max-w-[1000px]')}>{children}</div>
      </main>

      <footer className="text-[12px]">
        <div className="border-t border-ink-100 bg-[#f5f5f5] py-6 dark:border-ink-800 dark:bg-ink-900">
          <div className={cn(LEBAR, 'grid gap-8 sm:grid-cols-2 lg:grid-cols-[297px_297px_1fr]')}>
            <div>
              <h3 className="mb-2 text-sm text-ink-800 dark:text-ink-100">Layanan Pelanggan</h3>
              <ul className="space-y-1 text-ink-600 dark:text-ink-300">
                <li>
                  <Link to={tautanPesanan} className={TAUTAN_KECIL}>
                    Lacak Pesanan
                  </Link>
                </li>
                <li>
                  <Link to="/toko/keranjang" className={TAUTAN_KECIL}>
                    Keranjang Belanja
                  </Link>
                </li>
                <li>
                  <Link to={token ? '/toko/akun' : '/toko/masuk'} className={TAUTAN_KECIL}>
                    {token ? 'Akun Saya' : 'Akun Pembeli'}
                  </Link>
                </li>
                <li>
                  <Link to="/toko/kebijakan-privasi" className={TAUTAN_KECIL}>
                    Kebijakan Privasi
                  </Link>
                </li>
                <li>
                  <Link to="/toko/syarat-ketentuan" className={TAUTAN_KECIL}>
                    Syarat &amp; Ketentuan
                  </Link>
                </li>
              </ul>
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block bg-brand-600 px-1.5 py-1 text-white transition-opacity duration-200 hover:opacity-90"
                >
                  Ada pertanyaan? Hubungi kami lewat chat
                </a>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm text-ink-800 dark:text-ink-100">Jelajahi {namaToko}</h3>
              <ul className="space-y-1 text-ink-600 dark:text-ink-300">
                <li>
                  <Link to="/toko" className={TAUTAN_KECIL}>
                    Beranda
                  </Link>
                </li>
                <li>
                  <Link to="/toko?semua=1" className={TAUTAN_KECIL}>
                    Semua Produk
                  </Link>
                </li>
                {categories.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link to={`/toko?kategori=${c.id}`} className={TAUTAN_KECIL}>
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-start gap-3">
              {logo('h-12 w-12', 22)}
              <div>
                <div className="text-sm font-semibold text-brand-600">{namaToko}</div>
                <div className="text-ink-600 dark:text-ink-300">Belanja online, dikirim ke alamatmu.</div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white py-6 dark:bg-ink-950">
          <div className={cn(LEBAR, 'grid gap-8 sm:grid-cols-2 lg:grid-cols-[297px_1fr]')}>
            <div>
              <h3 className="mb-2 text-sm text-ink-800 dark:text-ink-100">Metode Pembayaran</h3>
              <div className="flex gap-2">
                {['Tunai (COD)', 'QRIS'].map((m) => (
                  <span key={m} className="rounded border border-ink-200 px-2.5 py-1.5 font-semibold text-ink-700 dark:border-ink-700 dark:text-ink-200">
                    {m}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm text-ink-800 dark:text-ink-100">Jasa Pengiriman</h3>
              <p className="text-ink-600 dark:text-ink-300">Pengiriman reguler ke alamatmu. Ongkir dikonfirmasi toko sebelum pembayaran.</p>
            </div>
          </div>
          <div className={cn(LEBAR, 'mt-8 flex items-center justify-between text-ink-600 dark:text-ink-300')}>
            <span>{namaToko}</span>
            <span>
              © {namaToko} {new Date().getFullYear()}
            </span>
          </div>
        </div>
      </footer>

      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-0 right-[50px] z-30 hidden h-10 w-[160px] items-center gap-2 rounded-t-md border border-b-0 border-ink-200 bg-white px-3 text-sm text-ink-800 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] transition-colors duration-300 hover:text-brand-600 lg:flex dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
        >
          <MessageCircle size={18} className="text-brand-600" /> Pesan
        </a>
      )}
    </div>
  );
}
