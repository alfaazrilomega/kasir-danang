import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Flame,
  LayoutGrid,
  List,
  QrCode,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Store,
  Tags,
  Truck,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PublicShell } from '@/components/layout/PublicShell';
import { KartuProduk } from '@/components/public/KartuProduk';
import { Bintang } from '@/components/public/Bintang';
import { Link, useLocation } from '@/lib/router';
import { cn, formatMoney, formatNumber } from '@/lib/format';
import {
  fetchPublicCatalog,
  kelompokkanVarian,
  lokasiToko,
  type KelompokProduk,
  type PublicCatalogData,
  type PublicCatalogStore,
} from '@/lib/publicCatalog';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { useCustomer } from '@/lib/customerAccount';

const EMPTY: PublicCatalogData = { store: null, categories: [], products: [] };

type SortKey = 'terbaru' | 'terlaris' | 'rating' | 'harga-asc' | 'harga-desc' | 'nama-asc';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'terbaru', label: 'Paling Sesuai' },
  { value: 'terlaris', label: 'Terlaris' },
  { value: 'rating', label: 'Rating Tertinggi' },
  { value: 'harga-asc', label: 'Harga Terendah' },
  { value: 'harga-desc', label: 'Harga Tertinggi' },
  { value: 'nama-asc', label: 'Nama A-Z' },
];

const PER_HALAMAN = 40;
const JFY_LANGKAH = 36;
const BAYANGAN = 'hover:shadow-[0_2px_12px_rgba(0,0,0,0.16)]';

function cocok(k: KelompokProduk, needle: string): boolean {
  const p = k.wakil;
  return (
    p.name.toLowerCase().includes(needle) ||
    (p.brand ?? '').toLowerCase().includes(needle) ||
    k.anggota.some((a) => (a.variant_name ?? '').toLowerCase().includes(needle))
  );
}

function urutkan(list: KelompokProduk[], sort: SortKey): KelompokProduk[] {
  const hasil = [...list];
  switch (sort) {
    case 'terlaris':
      return hasil.sort((a, b) => b.terjual - a.terjual);
    case 'rating':
      return hasil.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
    case 'harga-asc':
      return hasil.sort((a, b) => a.hargaMin - b.hargaMin);
    case 'harga-desc':
      return hasil.sort((a, b) => b.hargaMin - a.hargaMin);
    case 'nama-asc':
      return hasil.sort((a, b) => a.wakil.name.localeCompare(b.wakil.name, 'id'));
    default:
      return hasil;
  }
}

/**
 * Storefront publik tanpa login, disusun seperti Lazada:
 * - `/toko` = beranda (karosel, ubin pintasan, Terlaris, Merek, Kategori,
 *   Hanya Untukmu).
 * - `/toko?q=…`, `?kategori=…`, `?merek=…`, `?urut=…`, `?semua=1` = halaman
 *   hasil dengan filter di kiri, urutan, tampilan kisi/daftar, dan halaman.
 * Data dari GET /api/public/catalog; produk bernama sama tampil sebagai SATU
 * kartu dengan beberapa variasi.
 */
export function PublicCatalog() {
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const q = params.get('q') ?? '';
  const merekUrl = params.get('merek') ?? '';
  const kategoriUrl = params.get('kategori') ?? '';
  const urutUrl = params.get('urut') ?? '';
  const modeCari = !!(q || merekUrl || kategoriUrl || urutUrl || params.get('semua'));

  const [catalog, setCatalog] = useState<PublicCatalogData>(EMPTY);
  const [loading, setLoading] = useState(true);

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

  const kelompok = useMemo(() => kelompokkanVarian(catalog.products), [catalog.products]);

  return (
    <PublicShell wide beranda={!modeCari} latar={modeCari ? 'putih' : 'abu'}>
      {modeCari ? (
        <HasilCari
          key={search}
          data={catalog}
          kelompok={kelompok}
          loading={loading}
          q={q}
          merekUrl={merekUrl}
          kategoriUrl={kategoriUrl}
          urutUrl={urutUrl}
        />
      ) : (
        <Beranda data={catalog} kelompok={kelompok} loading={loading} />
      )}
    </PublicShell>
  );
}

/* =========================================================================
 * Beranda
 * ========================================================================= */

function Beranda({ data, kelompok, loading }: { data: PublicCatalogData; kelompok: KelompokProduk[]; loading: boolean }) {
  const { store, categories } = data;
  const token = useCustomer((s) => s.token);
  const [jfy, setJfy] = useState(JFY_LANGKAH);

  const terlaris = useMemo(() => urutkan(kelompok, 'terlaris').slice(0, 6), [kelompok]);

  const merek = useMemo(() => {
    const peta = new Map<string, { nama: string; jumlah: number; gambar: string | null }>();
    for (const k of kelompok) {
      const nama = (k.wakil.brand ?? '').trim();
      if (!nama) continue;
      const kunci = nama.toLowerCase();
      const ada = peta.get(kunci);
      if (ada) {
        ada.jumlah += 1;
        ada.gambar = ada.gambar ?? k.wakil.image_url;
      } else {
        peta.set(kunci, { nama, jumlah: 1, gambar: k.wakil.image_url });
      }
    }
    return [...peta.values()].sort((a, b) => b.jumlah - a.jumlah).slice(0, 6);
  }, [kelompok]);

  const kategori = useMemo(
    () =>
      categories
        .map((c) => {
          const isi = kelompok.filter((k) => k.wakil.category_id === c.id);
          return { ...c, jumlah: isi.length, gambar: isi.find((k) => k.wakil.image_url)?.wakil.image_url ?? null };
        })
        .filter((c) => c.jumlah > 0),
    [categories, kelompok],
  );

  const untukmu = useMemo(() => [...kelompok].sort((a, b) => Number(a.habis) - Number(b.habis)), [kelompok]);

  const slides = useMemo(() => {
    const s: ReactNode[] = [];
    if (store?.pdp_banner_url) {
      s.push(<SlideBanner src={store.pdp_banner_url} store={store} />);
    }
    terlaris.slice(0, 4).forEach((k, i) => s.push(<SlideProduk k={k} nomor={i + 1} currency={store?.currency} />));
    if (!s.length) s.push(<SlideSambutan store={store} />);
    return s;
  }, [store, terlaris]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="h-[200px] flex-1 animate-pulse bg-white sm:h-[280px] lg:h-[344px] dark:bg-ink-900" />
          <div className="hidden w-[188px] animate-pulse bg-white lg:block dark:bg-ink-900" />
        </div>
        <KerangkaKisi jumlah={12} kolom="lg:grid-cols-6" />
      </div>
    );
  }

  return (
    <div className="pb-4">
      <NavLift
        item={[
          { id: 'atas', label: 'Ke atas', ikon: ArrowUp },
          { id: 'terlaris', label: 'Terlaris', ikon: Flame },
          ...(merek.length ? [{ id: 'merek', label: 'Merek', ikon: Tags }] : []),
          ...(kategori.length ? [{ id: 'kategori', label: 'Kategori', ikon: LayoutGrid }] : []),
          { id: 'untukmu', label: 'Hanya Untukmu', ikon: UserRound },
        ]}
      />

      {/* ---------- Karosel + panel toko ---------- */}
      <section className="flex gap-3">
        <div className="h-[200px] min-w-0 flex-1 overflow-hidden bg-white sm:h-[280px] lg:h-[344px] dark:bg-ink-900">
          <Karosel slides={slides} />
        </div>
        <aside className="hidden w-[188px] shrink-0 flex-col items-center bg-gradient-to-b from-brand-600 to-brand-400 px-3 py-4 text-center text-white lg:flex">
          {store?.logo_url ? (
            <span className="flex h-16 w-full items-center justify-center rounded-xl bg-white p-2">
              <img src={store.logo_url} alt={store.name} className="max-h-full max-w-full object-contain" />
            </span>
          ) : (
            <>
              <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-xl bg-white text-brand-600">
                <Store size={26} />
              </span>
              <div className="mt-2 line-clamp-2 text-sm font-bold">{store?.name ?? 'TokoKu'}</div>
            </>
          )}
          <ul className="mt-3 w-full space-y-2 text-left text-xs">
            {(
              [
                [Wallet, 'Bayar tunai (COD)'],
                [QrCode, 'Bisa bayar QRIS'],
                [ClipboardCheck, 'Pesanan dikonfirmasi toko'],
                [Truck, 'Dikirim ke alamatmu'],
              ] as [LucideIcon, string][]
            ).map(([Ikon, teks]) => (
              <li key={teks} className="flex items-center gap-2 rounded-md bg-white/15 px-2 py-1.5">
                <Ikon size={14} className="shrink-0" /> {teks}
              </li>
            ))}
          </ul>
          <Link
            to={token ? '/toko/akun' : '/toko/masuk'}
            className="mt-auto flex h-8 w-full items-center justify-center rounded-sm bg-white text-xs font-bold uppercase text-brand-700 transition-opacity duration-300 hover:opacity-90"
          >
            {token ? 'Pesanan Saya' : 'Masuk / Daftar'}
          </Link>
        </aside>
      </section>

      {/* ---------- Ubin pintasan ---------- */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Ubin to="/toko?urut=terlaris" judul="Terlaris" teks="Produk yang paling banyak dibeli pelanggan" ikon={Flame} />
        <Ubin to="/toko?semua=1" judul="Semua Produk" teks={`Lihat seluruh katalog ${store?.name ?? 'toko'}`} ikon={Store} />
      </div>

      {/* ---------- Terlaris ---------- */}
      {terlaris.length > 0 && (
        <section id="terlaris" className="scroll-mt-24">
          <JudulBagian>Terlaris</JudulBagian>
          <div className="bg-white dark:bg-ink-900">
            <div className="flex h-[53px] items-center justify-between border-b border-ink-100 px-4 dark:border-ink-800">
              <span className="text-sm text-brand-600">Paling banyak dibeli</span>
              <Link
                to="/toko?urut=terlaris"
                className="flex h-8 items-center border border-brand-600 px-3 text-[13px] uppercase text-brand-600 transition-colors duration-300 hover:bg-brand-50 dark:hover:bg-ink-800"
              >
                Belanja Semua Produk
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6">
              {terlaris.map((k) => (
                <KartuProduk key={k.key} kelompok={k} currency={store?.currency} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------- Merek ---------- */}
      {merek.length > 0 && (
        <section id="merek" className="scroll-mt-24">
          <div className="flex items-center justify-between">
            <JudulBagian>Merek</JudulBagian>
            <Link to="/toko?semua=1" className="flex items-center text-sm text-brand-600 transition-colors duration-300 hover:text-brand-800">
              Lanjutkan Belanja <ChevronRight size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {merek.map((m) => (
              <Link key={m.nama} to={`/toko?merek=${encodeURIComponent(m.nama)}`} className={cn('flex flex-col bg-white dark:bg-ink-900', BAYANGAN)}>
                <div className="aspect-square bg-white dark:bg-ink-900">
                  {m.gambar ? (
                    <img src={m.gambar} alt="" loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                      <ShoppingBag size={30} />
                    </div>
                  )}
                </div>
                <div className="relative px-2 pb-3 pt-6 text-center">
                  <span className="absolute -top-5 left-1/2 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-sm border border-ink-100 bg-white text-sm font-bold text-brand-600 shadow-sm dark:border-ink-700 dark:bg-ink-900">
                    {m.nama.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="truncate text-sm text-ink-800 dark:text-ink-100">{m.nama}</div>
                  <div className="text-xs text-ink-400">{formatNumber(m.jumlah)} produk</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Kategori ---------- */}
      {kategori.length > 0 && (
        <section id="kategori" className="scroll-mt-24">
          <JudulBagian>Kategori</JudulBagian>
          <div className="grid grid-cols-3 bg-white sm:grid-cols-6 lg:grid-cols-8 dark:bg-ink-900">
            {kategori.map((c) => (
              <Link
                key={c.id}
                to={`/toko?kategori=${c.id}`}
                className={cn('flex flex-col items-center gap-2 border-b border-r border-[#eff0f5] px-2 py-4 text-center dark:border-ink-800', BAYANGAN)}
              >
                <span className="grid h-20 w-20 place-items-center text-ink-300">
                  {c.gambar ? <img src={c.gambar} alt="" loading="lazy" className="h-full w-full object-contain" /> : <ShoppingBag size={28} />}
                </span>
                <span className="line-clamp-2 text-[13px] leading-4 text-ink-800 dark:text-ink-100">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Hanya Untukmu ---------- */}
      <section id="untukmu" className="scroll-mt-24">
        <JudulBagian>Hanya Untukmu</JudulBagian>
        {untukmu.length === 0 ? (
          <div className="bg-white py-12 text-center text-sm text-ink-500 dark:bg-ink-900">Belum ada produk yang dijual.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {untukmu.slice(0, jfy).map((k) => (
              <KartuProduk key={k.key} kelompok={k} currency={store?.currency} />
            ))}
          </div>
        )}
        {jfy < untukmu.length && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setJfy(jfy + JFY_LANGKAH)}
              className="h-10 w-full max-w-[390px] border border-brand-600 bg-white text-sm uppercase text-brand-600 transition-colors duration-300 hover:bg-brand-50 dark:bg-ink-900 dark:hover:bg-ink-800"
            >
              Muat Lebih Banyak
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function JudulBagian({ children }: { children: ReactNode }) {
  return <h2 className="pb-3 pt-6 text-[22px] leading-7 text-ink-700 dark:text-ink-200">{children}</h2>;
}

function Ubin({ to, judul, teks, ikon: Ikon }: { to: string; judul: string; teks: string; ikon: LucideIcon }) {
  return (
    <Link
      to={to}
      className="flex h-[100px] items-center justify-between gap-3 bg-white px-5 transition-shadow duration-300 hover:shadow-[0_2px_12px_rgba(0,0,0,0.12)] lg:h-[130px] dark:bg-ink-900"
    >
      <span className="min-w-0">
        <span className="block text-lg text-ink-800 dark:text-ink-100">{judul}</span>
        <span className="mt-1 block text-sm text-ink-500">{teks}</span>
      </span>
      <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 lg:h-[104px] lg:w-[104px] dark:bg-brand-950/40">
        <Ikon size={40} />
      </span>
    </Link>
  );
}

const LAMA_SLIDE = 5000;

/**
 * Karosel beranda. Geser 0,5 dtk, ganti otomatis tiap 5 dtk (berhenti saat
 * disorot). Kontrol ala situs brand balap (Renthal/JT): penghitung "01 / 05",
 * bar progres yang terisi sepanjang durasi slide, dan panah bulat di kanan bawah.
 * Setiap slide dibungkus `group/slide` + `data-aktif`, sehingga isinya bisa
 * beranimasi masuk ketika slide itu tampil.
 */
function Karosel({ slides }: { slides: ReactNode[] }) {
  const [aktif, setAktif] = useState(0);
  const [jeda, setJeda] = useState(false);
  // Geseran jari yang sedang berlangsung. Ref menyimpan titik awal & jarak supaya
  // tiap event membaca nilai terbaru; state `geser` hanya untuk menggambar posisinya.
  const tarik = useRef<{ x0: number; dx: number } | null>(null);
  const [geser, setGeser] = useState<number | null>(null);
  const bingkai = useRef<HTMLDivElement>(null);
  const n = slides.length;

  useEffect(() => {
    if (n < 2 || jeda || geser !== null) return;
    const t = window.setTimeout(() => setAktif((v) => (v + 1) % n), LAMA_SLIDE);
    return () => window.clearTimeout(t);
  }, [aktif, n, jeda, geser]);

  useEffect(() => {
    if (aktif >= n) setAktif(0);
  }, [n, aktif]);

  /** Geseran lebih dari 15% lebar slide pindah ke slide sebelah; kurang dari itu kembali. */
  function lepas() {
    const g = tarik.current;
    if (!g) return;
    tarik.current = null;
    const lebar = bingkai.current?.offsetWidth || 1;
    if (Math.abs(g.dx) > lebar * 0.15) setAktif((v) => (v + (g.dx < 0 ? 1 : -1) + n) % n);
    setGeser(null);
  }

  return (
    <div
      ref={bingkai}
      className="relative h-full touch-pan-y overflow-hidden"
      onMouseEnter={() => setJeda(true)}
      onMouseLeave={() => setJeda(false)}
      // Hanya sentuhan/pena: seret mouse di desktop akan bentrok dengan klik tautan di slide.
      onPointerDown={(e) => {
        if (n < 2 || e.pointerType === 'mouse') return;
        tarik.current = { x0: e.clientX, dx: 0 };
        setGeser(0);
      }}
      onPointerMove={(e) => {
        if (!tarik.current) return;
        tarik.current.dx = e.clientX - tarik.current.x0;
        setGeser(tarik.current.dx);
      }}
      onPointerUp={lepas}
      onPointerCancel={lepas}
    >
      <div
        className={cn('flex h-full', geser === null && 'transition-transform duration-500 ease-out')}
        style={{ transform: `translateX(calc(${-aktif * 100}% + ${geser ?? 0}px))` }}
      >
        {slides.map((s, i) => (
          <div key={i} data-aktif={i === aktif} className="group/slide h-full w-full shrink-0" aria-hidden={i !== aktif}>
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Isi slide muncul bertahap ketika slide-nya aktif: naik 12px + memudar, 400 ms. */
const MUNCUL =
  'translate-y-3 opacity-0 transition-all duration-[400ms] ease-out group-data-[aktif=true]/slide:translate-y-0 group-data-[aktif=true]/slide:opacity-100';

/** Huruf condensed miring, senada dengan tipografi banner GNNK ("GEAR TYPE 520"). */
const HURUF_BALAP = "font-['Barlow_Condensed',ui-sans-serif,sans-serif] italic";

/** Motif bendera kotak dari logo GNNK, memudar dari kiri. Satu-satunya tekstur di slide. */
function MotifBendera() {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 left-0 w-72 opacity-[0.05] [background:repeating-conic-gradient(#fff_0_25%,transparent_0_50%)_0_0/22px_22px] [mask-image:linear-gradient(to_right,black,transparent)]"
    />
  );
}

/**
 * Banner promo (±1,8:1) di slide lebar (±2,9:1). Di layar lebar banner tampil
 * utuh di kanan dan tepi kirinya memudar ke panel gelap berisi ajakan belanja,
 * jadi slide penuh tanpa memotong banner. Di HP banner memenuhi slide.
 */
function SlideBanner({ src, store }: { src: string; store: PublicCatalogStore }) {
  return (
    <div className="relative h-full overflow-hidden bg-[#141417] text-white">
      <img src={src} alt="Promo toko" className="h-full w-full object-cover object-[center_40%] sm:hidden" />
      <div className="hidden h-full sm:block">
        <MotifBendera />
        <img
          src={src}
          alt="Promo toko"
          className="absolute inset-y-0 right-0 h-full w-auto max-w-none origin-right scale-105 transition-transform duration-[6000ms] ease-out [mask-image:linear-gradient(to_right,transparent,#000_22%)] group-data-[aktif=true]/slide:scale-100"
        />
        <div className="relative flex h-full max-w-[40%] flex-col justify-center px-12 pb-12">
          <div className={cn(MUNCUL, HURUF_BALAP, 'text-base font-bold uppercase tracking-wide text-brand-400')}>{store.name}</div>
          <div className={cn(MUNCUL, HURUF_BALAP, 'mt-1 text-[34px] font-extrabold uppercase leading-[0.92] tracking-tight delay-[60ms] lg:text-[48px]')}>
            Gear Set &amp; Sprocket Pilihan
          </div>
          <div className={cn(MUNCUL, 'mt-3 text-sm text-white/70 delay-[120ms]')}>Untuk harian hingga balap. Pesan online, bayar di tempat.</div>
          <div className={cn(MUNCUL, 'mt-5 delay-[180ms]')}>
            <Link
              to="/toko?urut=terlaris"
              className="inline-flex h-10 items-center gap-1 rounded-md bg-brand-500 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-600"
            >
              Belanja Sekarang <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideProduk({ k, nomor, currency }: { k: KelompokProduk; nomor: number; currency?: string }) {
  const p = k.wakil;
  // Merek sudah tertulis di label atas, jadi akhiran "GNNK Racing (Product)" dibuang dari judul.
  const judul = p.name.replace(/\s*GNNK Racing( Product)?\s*$/i, '').trim() || p.name;
  const coret = Number(p.compare_at_price ?? 0);
  const diskon = coret > k.hargaMin && k.hargaMin > 0 ? Math.round((1 - k.hargaMin / coret) * 100) : 0;
  const tautan = `/toko/produk?id=${p.id}`;
  // Rating dengan ulasan sedikit ("4,8 (4 ulasan)") justru mengurangi kepercayaan.
  const tampilRating = k.ratingCount >= 10;
  const bentukMiring = '[clip-path:polygon(14%_0,100%_0,100%_100%,0_100%)]';
  return (
    <div className="relative h-full overflow-hidden bg-[#0b0c1a] text-white">
      <MotifBendera />
      {/* Panel putih bersisi miring: latar putih foto produk menyatu dengan panel, tanpa kartu. */}
      <div aria-hidden className={cn('absolute inset-y-0 right-0 hidden w-[calc(46%+6px)] bg-brand-500 sm:block', bentukMiring)} />
      <Link to={tautan} aria-label={judul} className={cn('absolute inset-y-0 right-0 hidden w-[46%] overflow-hidden bg-white sm:block', bentukMiring)}>
        <div className="absolute inset-y-0 right-0 w-[86%] translate-x-8 [-webkit-mask-composite:source-in] [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,transparent_8%,#000_24%,#000_62%,transparent_85%),linear-gradient(to_right,transparent,#000_15%,#000_92%,transparent)] opacity-0 transition-all delay-100 duration-[600ms] ease-out group-data-[aktif=true]/slide:translate-x-0 group-data-[aktif=true]/slide:opacity-100">
          {p.image_url ? (
            // Diperbesar & tepinya dimask: logo, badge COD, dan teks promo bawaan foto tersembunyi, produknya yang dominan.
            <img src={p.image_url} alt="" className="h-full w-full scale-[1.45] object-cover object-[55%_30%]" />
          ) : (
            <div className="grid h-full place-items-center text-brand-300">
              <ShoppingBag size={72} />
            </div>
          )}
        </div>
      </Link>
      <div className="relative flex h-full flex-col justify-center px-6 pb-12 sm:max-w-[56%] lg:px-12">
        <div className="min-w-0">
          <div className={cn(MUNCUL, HURUF_BALAP, 'text-base font-bold uppercase tracking-wide text-brand-400')}>Terlaris #{nomor}</div>
          <h3 className={cn(MUNCUL, HURUF_BALAP, 'mt-1 line-clamp-2 text-[34px] font-extrabold uppercase leading-[0.92] tracking-tight delay-[60ms] lg:text-[52px]')}>
            {judul}
          </h3>
          <div className={cn(MUNCUL, 'mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/65 delay-[120ms] lg:text-sm')}>
            {tampilRating && (
              <span className="flex items-center gap-1">
                <Star size={14} className="fill-amber-400 text-amber-400" />
                {k.ratingAvg.toFixed(1)} ({formatNumber(k.ratingCount)} ulasan)
              </span>
            )}
            {k.terjual > 0 && <span>{formatNumber(k.terjual)} terjual</span>}
            {k.anggota.length > 1 && <span>{k.anggota.length} pilihan ukuran</span>}
          </div>
          <div className={cn(MUNCUL, 'mt-4 flex items-end gap-3 delay-[180ms]')}>
            <span className={cn(HURUF_BALAP, 'text-[30px] font-bold leading-none lg:text-[36px]')}>{formatMoney(k.hargaMin, currency)}</span>
            {diskon > 0 && (
              <>
                <span className="pb-0.5 text-sm text-white/40 line-through">{formatMoney(coret, currency)}</span>
                <span className="mb-0.5 rounded-sm bg-rose-500 px-1.5 py-0.5 text-xs font-bold">-{diskon}%</span>
              </>
            )}
          </div>
          <div className={cn(MUNCUL, 'mt-5 flex items-center gap-3 delay-[240ms]')}>
            <Link
              to={tautan}
              className="inline-flex h-10 items-center rounded-md bg-brand-500 px-5 text-sm font-semibold shadow-lg shadow-brand-950/50 transition-colors duration-200 hover:bg-brand-400"
            >
              Beli Sekarang
            </Link>
            <Link
              to={tautan}
              className="inline-flex h-10 items-center gap-1 rounded-md border border-white/30 px-4 text-sm font-medium text-white/90 transition-colors duration-200 hover:border-white hover:text-white"
            >
              Lihat Detail <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideSambutan({ store }: { store: PublicCatalogStore | null }) {
  return (
    <div className="relative h-full overflow-hidden bg-[#0b0c1a] text-white">
      <MotifBendera />
      <div className="relative flex h-full flex-col justify-center px-6 pb-12 lg:px-12">
        <div className={cn(MUNCUL, HURUF_BALAP, 'text-base font-bold uppercase tracking-wide text-brand-400')}>Selamat datang</div>
        <div className={cn(MUNCUL, HURUF_BALAP, 'mt-1 text-[40px] font-extrabold uppercase leading-[0.92] tracking-tight delay-[60ms] lg:text-[56px]')}>
          {store?.name ?? 'TokoKu'}
        </div>
        <div className={cn(MUNCUL, 'mt-3 max-w-lg text-sm text-white/75 delay-200 lg:text-base')}>
          Pesan online, dikirim ke alamatmu. Bayar tunai (COD) atau QRIS.
        </div>
      </div>
    </div>
  );
}

/** Navigasi cepat di kiri layar: kotak ikon yang melebar 0,3 dtk saat disorot. */
function NavLift({ item }: { item: { id: string; label: string; ikon: LucideIcon }[] }) {
  return (
    <nav aria-label="Navigasi cepat" className="fixed bottom-24 left-2 z-20 hidden flex-col gap-1.5 min-[1320px]:flex">
      {item.map(({ id, label, ikon: Ikon }) => (
        <button
          key={id}
          type="button"
          onClick={() =>
            id === 'atas'
              ? window.scrollTo({ top: 0, behavior: 'smooth' })
              : document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          className="flex h-[42px] w-[42px] items-center overflow-hidden rounded-full bg-white text-ink-500 shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-[width,color] duration-300 ease-in-out hover:w-[150px] hover:text-brand-600 dark:bg-ink-900"
        >
          <span className="grid h-[42px] w-[42px] shrink-0 place-items-center">
            <Ikon size={18} />
          </span>
          <span className="whitespace-nowrap pr-4 text-xs">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function KerangkaKisi({ jumlah, kolom }: { jumlah: number; kolom: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', kolom)}>
      {Array.from({ length: jumlah }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-ink-900">
          <div className="aspect-square animate-pulse bg-ink-100 dark:bg-ink-800" />
          <div className="space-y-2 p-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
 * Halaman hasil (pencarian / kategori / merek / semua produk)
 * ========================================================================= */

function HasilCari({
  data,
  kelompok,
  loading,
  q,
  merekUrl,
  kategoriUrl,
  urutUrl,
}: {
  data: PublicCatalogData;
  kelompok: KelompokProduk[];
  loading: boolean;
  q: string;
  merekUrl: string;
  kategoriUrl: string;
  urutUrl: string;
}) {
  const { store, categories } = data;
  const [kategori, setKategori] = useState<string[]>(kategoriUrl ? [kategoriUrl] : []);
  const [merek, setMerek] = useState<string[]>(merekUrl ? [merekUrl] : []);
  const [stokAda, setStokAda] = useState(false);
  const [diskonSaja, setDiskonSaja] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [hargaMin, setHargaMin] = useState('');
  const [hargaMax, setHargaMax] = useState('');
  const [rentang, setRentang] = useState<[number, number] | null>(null);
  const [sort, setSort] = useState<SortKey>(SORTS.some((s) => s.value === urutUrl) ? (urutUrl as SortKey) : 'terbaru');
  const [tampilan, setTampilan] = useState<'kisi' | 'daftar'>('kisi');
  const [halaman, setHalaman] = useState(1);
  const [filterHp, setFilterHp] = useState(false);

  const namaKategori = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const needle = q.trim().toLowerCase();

  // Hitungan di panel kiri dihitung dari hasil kata kunci saja.
  const dasar = useMemo(() => kelompok.filter((k) => !needle || cocok(k, needle)), [kelompok, needle]);

  const opsiKategori = useMemo(() => {
    const hitung = new Map<string, number>();
    for (const k of dasar) {
      const id = k.wakil.category_id;
      if (id) hitung.set(id, (hitung.get(id) ?? 0) + 1);
    }
    return categories.filter((c) => hitung.has(c.id)).map((c) => ({ ...c, jumlah: hitung.get(c.id) ?? 0 }));
  }, [categories, dasar]);

  const opsiMerek = useMemo(() => {
    const peta = new Map<string, { nama: string; jumlah: number }>();
    for (const k of dasar) {
      const nama = (k.wakil.brand ?? '').trim();
      if (!nama) continue;
      const ada = peta.get(nama.toLowerCase());
      if (ada) ada.jumlah += 1;
      else peta.set(nama.toLowerCase(), { nama, jumlah: 1 });
    }
    return [...peta.values()].sort((a, b) => b.jumlah - a.jumlah);
  }, [dasar]);

  const shown = useMemo(() => {
    const merekKecil = merek.map((m) => m.toLowerCase());
    const list = dasar.filter((k) => {
      const p = k.wakil;
      if (kategori.length && !kategori.includes(p.category_id ?? '')) return false;
      if (merekKecil.length && !merekKecil.includes((p.brand ?? '').trim().toLowerCase())) return false;
      if (stokAda && k.habis) return false;
      if (diskonSaja && !(Number(p.compare_at_price ?? 0) > k.hargaMin)) return false;
      if (minRating && k.ratingAvg < minRating) return false;
      if (rentang && (k.hargaMin < rentang[0] || k.hargaMin > rentang[1])) return false;
      return true;
    });
    return urutkan(list, sort);
  }, [dasar, kategori, merek, stokAda, diskonSaja, minRating, rentang, sort]);

  useEffect(() => setHalaman(1), [kategori, merek, stokAda, diskonSaja, minRating, rentang, sort]);

  const totalHalaman = Math.max(1, Math.ceil(shown.length / PER_HALAMAN));
  const potongan = shown.slice((halaman - 1) * PER_HALAMAN, halaman * PER_HALAMAN);

  const judul = q
    ? q.replace(/\b\p{L}/gu, (h) => h.toUpperCase())
    : kategoriUrl
      ? (namaKategori.get(kategoriUrl) ?? 'Kategori')
      : merekUrl
        ? merekUrl
        : urutUrl === 'terlaris'
          ? 'Produk Terlaris'
          : urutUrl === 'rating'
            ? 'Rating Tertinggi'
            : 'Semua Produk';

  function hapusSemua() {
    setKategori([]);
    setMerek([]);
    setStokAda(false);
    setDiskonSaja(false);
    setMinRating(0);
    setRentang(null);
    setHargaMin('');
    setHargaMax('');
  }

  const chip: { label: string; hapus: () => void }[] = [
    ...kategori.map((id) => ({ label: namaKategori.get(id) ?? 'Kategori', hapus: () => setKategori((v) => v.filter((x) => x !== id)) })),
    ...merek.map((m) => ({ label: `Merek: ${m}`, hapus: () => setMerek((v) => v.filter((x) => x !== m)) })),
    ...(stokAda ? [{ label: 'Stok tersedia', hapus: () => setStokAda(false) }] : []),
    ...(diskonSaja ? [{ label: 'Diskon', hapus: () => setDiskonSaja(false) }] : []),
    ...(minRating ? [{ label: `Bintang ${minRating}${minRating < 5 ? ' ke atas' : ''}`, hapus: () => setMinRating(0) }] : []),
    ...(rentang
      ? [
          {
            label: `${formatMoney(rentang[0], store?.currency)} - ${Number.isFinite(rentang[1]) ? formatMoney(rentang[1], store?.currency) : '…'}`,
            hapus: () => {
              setRentang(null);
              setHargaMin('');
              setHargaMax('');
            },
          },
        ]
      : []),
  ];

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="flex gap-6 pb-6 pt-2">
      {/* ---------- Panel filter kiri ---------- */}
      <aside
        className={cn(
          'tanpa-bilah shrink-0 text-[13px]',
          filterHp ? 'fixed inset-0 z-40 overflow-y-auto bg-white p-4 dark:bg-ink-900' : 'hidden w-[190px] self-start overscroll-contain lg:sticky lg:top-[calc(var(--tinggi-header,120px)+12px)] lg:block lg:max-h-[calc(100vh-var(--tinggi-header,120px)-24px)] lg:overflow-y-auto',
        )}
      >
        {filterHp && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-base font-semibold">Filter</span>
            <button type="button" aria-label="Tutup filter" onClick={() => setFilterHp(false)}>
              <X size={18} />
            </button>
          </div>
        )}
        {opsiKategori.length > 0 && (
          <BagianFilter judul="Kategori">
            <DaftarLipat
              baris={opsiKategori.map((c) => (
                <Centang key={c.id} checked={kategori.includes(c.id)} onChange={() => setKategori((v) => toggle(v, c.id))} jumlah={c.jumlah}>
                  {c.name}
                </Centang>
              ))}
            />
          </BagianFilter>
        )}
        {opsiMerek.length > 0 && (
          <BagianFilter judul="Merek">
            <DaftarLipat
              baris={opsiMerek.map((m) => (
                <Centang
                  key={m.nama}
                  checked={merek.some((x) => x.toLowerCase() === m.nama.toLowerCase())}
                  onChange={() =>
                    setMerek((v) =>
                      v.some((x) => x.toLowerCase() === m.nama.toLowerCase())
                        ? v.filter((x) => x.toLowerCase() !== m.nama.toLowerCase())
                        : [...v, m.nama],
                    )
                  }
                  jumlah={m.jumlah}
                >
                  {m.nama}
                </Centang>
              ))}
            />
          </BagianFilter>
        )}
        <BagianFilter judul="Layanan & Promo">
          <Centang checked={stokAda} onChange={() => setStokAda(!stokAda)}>
            Stok tersedia
          </Centang>
          <Centang checked={diskonSaja} onChange={() => setDiskonSaja(!diskonSaja)}>
            Diskon
          </Centang>
        </BagianFilter>
        <BagianFilter judul="Harga">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const a = Number(hargaMin) || 0;
              const b = Number(hargaMax) || 0;
              setRentang(a || b ? [a, b || Number.POSITIVE_INFINITY] : null);
            }}
          >
            <input
              aria-label="Harga minimum"
              inputMode="numeric"
              placeholder="Min"
              value={hargaMin}
              onChange={(e) => setHargaMin(e.target.value.replace(/\D/g, ''))}
              className="h-8 w-[62px] rounded-sm border border-ink-200 bg-white px-2 text-xs outline-none transition-colors duration-200 focus:border-brand-500 dark:border-ink-700 dark:bg-ink-900"
            />
            <span className="text-ink-400">-</span>
            <input
              aria-label="Harga maksimum"
              inputMode="numeric"
              placeholder="Max"
              value={hargaMax}
              onChange={(e) => setHargaMax(e.target.value.replace(/\D/g, ''))}
              className="h-8 w-[62px] rounded-sm border border-ink-200 bg-white px-2 text-xs outline-none transition-colors duration-200 focus:border-brand-500 dark:border-ink-700 dark:bg-ink-900"
            />
            <button
              type="submit"
              aria-label="Terapkan harga"
              className="grid h-8 w-8 place-items-center rounded-sm bg-brand-600 text-white transition-opacity duration-300 hover:opacity-90"
            >
              <ChevronRight size={16} />
            </button>
          </form>
        </BagianFilter>
        <BagianFilter judul="Penilaian">
          {[5, 4, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMinRating(minRating === n ? 0 : n)}
              className={cn(
                'flex h-6 items-center gap-1.5 transition-colors duration-300',
                minRating === n ? 'font-medium text-brand-600' : 'text-ink-600 hover:text-brand-600 dark:text-ink-300',
              )}
            >
              <Bintang nilai={n} ukuran={13} />
              {n < 5 && <span>ke atas</span>}
            </button>
          ))}
        </BagianFilter>
        {filterHp && (
          <button
            type="button"
            onClick={() => setFilterHp(false)}
            className="mt-4 h-10 w-full rounded-sm bg-brand-600 text-sm uppercase text-white"
          >
            Tampilkan {formatNumber(shown.length)} produk
          </button>
        )}
      </aside>

      {/* ---------- Isi hasil ---------- */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-100 pb-3 dark:border-ink-800">
          <div>
            <h1 className="text-[22px] leading-8 text-ink-800 dark:text-ink-100">{judul}</h1>
            <p className="text-[13px] text-ink-500">
              {loading ? 'Memuat produk…' : `${formatNumber(shown.length)} produk ditemukan${q ? ` untuk "${q}"` : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[13px] text-ink-500">
            <button
              type="button"
              onClick={() => setFilterHp(true)}
              className="flex h-8 items-center gap-1.5 rounded-sm border border-ink-200 px-3 lg:hidden dark:border-ink-700"
            >
              <SlidersHorizontal size={14} /> Filter
            </button>
            <label className="flex items-center gap-2">
              <span className="hidden sm:inline">Urutkan berdasarkan:</span>
              <select
                aria-label="Urutkan produk"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-8 w-[170px] rounded-sm border border-ink-200 bg-white px-2 text-[13px] text-ink-800 outline-none transition-colors duration-200 hover:border-brand-400 focus:border-brand-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="hidden items-center gap-1.5 sm:flex">
              Lihat:
              <button
                type="button"
                aria-label="Tampilan kisi"
                aria-pressed={tampilan === 'kisi'}
                onClick={() => setTampilan('kisi')}
                className={cn('transition-colors duration-200', tampilan === 'kisi' ? 'text-brand-600' : 'text-ink-300 hover:text-ink-500')}
              >
                <LayoutGrid size={18} />
              </button>
              <button
                type="button"
                aria-label="Tampilan daftar"
                aria-pressed={tampilan === 'daftar'}
                onClick={() => setTampilan('daftar')}
                className={cn('transition-colors duration-200', tampilan === 'daftar' ? 'text-brand-600' : 'text-ink-300 hover:text-ink-500')}
              >
                <List size={18} />
              </button>
            </span>
          </div>
        </div>

        {chip.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 text-xs">
            {chip.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.hapus}
                className="flex items-center gap-1 rounded-sm border border-brand-200 bg-brand-50 px-2 py-1 text-brand-700 transition-colors duration-200 hover:border-brand-400 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
              >
                {c.label} <X size={12} />
              </button>
            ))}
            <button type="button" onClick={hapusSemua} className="text-ink-500 transition-colors duration-200 hover:text-brand-600">
              Hapus semua
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-4">
            <KerangkaKisi jumlah={8} kolom="lg:grid-cols-4" />
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-ink-100 text-ink-400 dark:bg-ink-800">
              <Search size={28} />
            </span>
            <p className="mt-4 text-lg text-ink-700 dark:text-ink-200">Produk tidak ditemukan</p>
            <p className="mt-1 text-sm text-ink-500">
              {q ? `Tidak ada produk yang cocok dengan "${q}". Coba kata kunci lain.` : 'Coba longgarkan filternya.'}
            </p>
            {chip.length > 0 && (
              <button
                type="button"
                onClick={hapusSemua}
                className="mt-4 h-9 border border-brand-600 px-4 text-sm text-brand-600 transition-colors duration-300 hover:bg-brand-50"
              >
                Hapus semua filter
              </button>
            )}
          </div>
        ) : tampilan === 'kisi' ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {potongan.map((k) => (
              <KartuProduk key={k.key} kelompok={k} currency={store?.currency} gaya="cari" lokasi={lokasiToko(store)} />
            ))}
          </div>
        ) : (
          <div className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
            {potongan.map((k) => (
              <BarisDaftar key={k.key} k={k} currency={store?.currency} lokasi={lokasiToko(store)} />
            ))}
          </div>
        )}

        {totalHalaman > 1 && (
          <Paginasi
            halaman={halaman}
            total={totalHalaman}
            onPilih={(n) => {
              setHalaman(n);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </div>
    </div>
  );
}

function BagianFilter({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <section className="border-b border-ink-100 py-3 first:pt-0 dark:border-ink-800">
      <h3 className="mb-2 text-sm text-ink-800 dark:text-ink-100">{judul}</h3>
      {children}
    </section>
  );
}

function Centang({
  checked,
  onChange,
  jumlah,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  jumlah?: number;
  children: ReactNode;
}) {
  return (
    <label className="flex h-6 cursor-pointer items-center gap-2 text-ink-600 transition-colors duration-300 hover:text-brand-600 dark:text-ink-300">
      <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-brand-600" checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {jumlah !== undefined && <span className="text-[11px] text-ink-400">{jumlah}</span>}
    </label>
  );
}

/** Daftar panjang dilipat; "Lihat Lebih Banyak" membukanya dengan animasi tinggi 0,5 dtk. */
function DaftarLipat({ baris, batas = 8 }: { baris: ReactNode[]; batas?: number }) {
  const [buka, setBuka] = useState(false);
  const lebih = baris.length > batas;
  const TINGGI = 24;
  return (
    <div>
      <div
        className="overflow-hidden transition-[max-height] duration-500"
        style={{ maxHeight: buka || !lebih ? baris.length * TINGGI + 4 : batas * TINGGI }}
      >
        {baris}
      </div>
      {lebih && (
        <button
          type="button"
          onClick={() => setBuka(!buka)}
          className="mt-1 text-[13px] text-brand-600 transition-colors duration-300 hover:text-brand-800"
        >
          {buka ? 'Lihat Lebih Sedikit' : 'Lihat Lebih Banyak'}
        </button>
      )}
    </div>
  );
}

function BarisDaftar({ k, currency, lokasi }: { k: KelompokProduk; currency?: string; lokasi: string }) {
  const p = k.wakil;
  return (
    <Link
      to={`/toko/produk?id=${p.id}`}
      data-kartu-produk=""
      className="flex gap-4 bg-white py-4 transition-shadow duration-300 hover:shadow-[0_2px_12px_rgba(0,0,0,0.12)] dark:bg-ink-900"
    >
      <div className="relative h-[140px] w-[140px] shrink-0 bg-white dark:bg-ink-900">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-ink-300">
            <ShoppingBag size={30} />
          </div>
        )}
        {k.habis && (
          <span className="absolute left-1 top-1 rounded-sm bg-ink-800/80 px-1.5 py-0.5 text-[11px] text-white">Stok habis</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="line-clamp-2 text-base text-ink-800 dark:text-ink-100">{p.name}</div>
        <div className="text-lg text-brand-600">{formatMoney(k.hargaMin, currency)}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          {k.ratingCount > 0 && (
            <>
              <Bintang nilai={k.ratingAvg} ukuran={12} />
              <span>({formatNumber(k.ratingCount)})</span>
            </>
          )}
          {k.terjual > 0 && <span>{formatNumber(k.terjual)} terjual</span>}
        </div>
        {p.brand && <div className="text-xs text-ink-500">Merek: {p.brand}</div>}
        <div className="text-xs text-ink-400">{lokasi}</div>
        {k.anggota.length > 1 && <div className="text-xs text-ink-400">{k.anggota.length} variasi</div>}
      </div>
    </Link>
  );
}

function Paginasi({ halaman, total, onPilih }: { halaman: number; total: number; onPilih: (n: number) => void }) {
  const nomor: (number | 'lompat')[] = [];
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - halaman) <= 2) nomor.push(n);
    else if (nomor[nomor.length - 1] !== 'lompat') nomor.push('lompat');
  }
  const kotak = 'grid h-8 min-w-8 place-items-center rounded-sm border px-2 transition-colors duration-200';
  return (
    <nav aria-label="Halaman" className="mt-8 flex items-center justify-end gap-2 text-sm">
      <button
        type="button"
        aria-label="Halaman sebelumnya"
        disabled={halaman <= 1}
        onClick={() => onPilih(halaman - 1)}
        className={cn(kotak, 'border-ink-200 hover:border-brand-500 hover:text-brand-600 disabled:opacity-40 dark:border-ink-700')}
      >
        <ChevronLeft size={14} />
      </button>
      {nomor.map((n, i) =>
        n === 'lompat' ? (
          <span key={`l${i}`} className="px-1 text-ink-400">
            •••
          </span>
        ) : (
          <button
            key={n}
            type="button"
            aria-current={n === halaman ? 'page' : undefined}
            onClick={() => onPilih(n)}
            className={cn(
              kotak,
              n === halaman ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 hover:border-brand-500 hover:text-brand-600 dark:border-ink-700',
            )}
          >
            {n}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Halaman berikutnya"
        disabled={halaman >= total}
        onClick={() => onPilih(halaman + 1)}
        className={cn(kotak, 'border-ink-200 hover:border-brand-500 hover:text-brand-600 disabled:opacity-40 dark:border-ink-700')}
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
