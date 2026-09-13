import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff, QrCode, Store, Truck, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { fetchPublicCatalog, type PublicCatalogStore } from '@/lib/publicCatalog';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export const LABEL_AUTH = 'text-[13px] font-medium text-black/70';

export const KOLOM_AUTH =
  'h-11 w-full rounded-xl border border-black/[0.12] bg-white px-3.5 text-sm text-[#0b0c1a] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-black/30 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15';

export const KOLOM_GALAT = 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/15';

export const TOMBOL_AUTH =
  'h-11 w-full rounded-xl bg-brand-500 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:bg-black/[0.06] disabled:text-black/35';

/** Huruf condensed miring yang sama dengan hero beranda toko. */
const HURUF_BALAP = "font-['Barlow_Condensed',ui-sans-serif,sans-serif] italic";

/** Tujuan setelah masuk hanya boleh halaman toko, bukan alamat sembarang. */
export function tujuanAman(v: string | null): string {
  return v && v.startsWith('/toko') ? v : '/toko/akun';
}

let janjiToko: Promise<PublicCatalogStore | null> | null = null;

/** Nama, logo & banner toko untuk halaman masuk (diambil sekali per kunjungan). */
export function useTokoPublik(): PublicCatalogStore | null {
  const [toko, setToko] = useState<PublicCatalogStore | null>(null);
  useEffect(() => {
    let alive = true;
    janjiToko ??= fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((d) => d.store)
      .catch(() => null);
    void janjiToko.then((t) => alive && setToko(t));
    return () => {
      alive = false;
    };
  }, []);
  return toko;
}

function LogoToko({ toko, kecil = false }: { toko: PublicCatalogStore | null; kecil?: boolean }) {
  const nama = toko?.name ?? 'TokoKu';
  return (
    <Link to="/toko" aria-label={`Beranda ${nama}`} className="inline-flex items-center rounded-lg bg-white px-3 py-2 shadow-sm">
      {toko?.logo_url ? (
        <img src={toko.logo_url} alt={nama} className={cn('w-auto object-contain', kecil ? 'h-6' : 'h-7')} />
      ) : (
        <span className="flex items-center gap-1.5 text-sm font-bold text-[#0b0c1a]">
          <Store size={16} /> {nama}
        </span>
      )}
    </Link>
  );
}

const MOTIF_BENDERA =
  'pointer-events-none absolute opacity-[0.06] [background:repeating-conic-gradient(#fff_0_25%,transparent_0_50%)_0_0/22px_22px]';

/**
 * Kerangka halaman masuk/daftar/lupa sandi: tanpa navbar & footer toko,
 * memenuhi layar dan tidak bisa digulir. Desktop dibelah dua: panel visual
 * gelap (banner toko + judul balap + jaminan COD/QRIS) di kiri dan panel
 * formulir putih di kanan. Di HP panel visual menyusut jadi pita gelap berisi
 * logo, dan formulir tampil sebagai lembar putih di bawahnya.
 */
export function KerangkaAuth({
  children,
  kaki,
  label = 'Akun Pembeli',
  kembali = { to: '/toko', teks: 'Kembali ke toko' },
}: {
  children: ReactNode;
  /** Baris kecil di dasar panel formulir (mis. persetujuan syarat). */
  kaki?: ReactNode;
  /** Label kecil di atas judul besar panel visual. */
  label?: string;
  kembali?: { to: string; teks: string };
}) {
  const toko = useTokoPublik();

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const lama = [html.style.overflow, body.style.overflow];
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = lama[0];
      body.style.overflow = lama[1];
    };
  }, []);

  const tautanKembali = (terang: boolean) => (
    <Link
      to={kembali.to}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm transition-colors duration-150',
        terang ? 'text-white/70 hover:text-white' : 'text-black/55 hover:text-black',
      )}
    >
      <ArrowLeft size={16} /> {kembali.teks}
    </Link>
  );

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0b0c1a] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,44%)]">
      {/* ---------- Panel visual (desktop) ---------- */}
      <section className="relative hidden overflow-hidden text-white lg:block">
        {toko?.pdp_banner_url && (
          <img
            src={toko.pdp_banner_url}
            alt=""
            // Diperbesar ke deretan sprocket di kanan banner: teks promo bawaan banner
            // ("GEAR TYPE 520") keluar dari bingkai supaya tidak bersaing dengan judul.
            className="absolute inset-0 h-full w-full origin-[78%_55%] scale-[1.35] object-cover object-[82%_50%] [mask-image:linear-gradient(to_bottom,#000_50%,transparent_82%)]"
          />
        )}
        {/* Sisa teks banner di tepi atas & kiri digelapkan ke warna panel. */}
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_bottom,#0b0c1a_0%,transparent_32%),linear-gradient(to_right,#0b0c1a_0%,transparent_28%)]" />
        <div aria-hidden className={cn(MOTIF_BENDERA, 'bottom-0 left-0 h-56 w-80 [mask-image:linear-gradient(to_top_right,black,transparent_70%)]')} />
        <div className="absolute left-10 top-8">
          <LogoToko toko={toko} />
        </div>
        <div className="absolute inset-x-10 bottom-10">
          <div className={cn(HURUF_BALAP, 'text-base font-bold uppercase tracking-wide text-brand-400')}>{label}</div>
          <p className={cn(HURUF_BALAP, 'mt-1 text-[56px] font-extrabold uppercase leading-[0.9] tracking-tight 2xl:text-[64px]')}>
            Gear Set Presisi.
            <br />
            Dikirim ke Garasi Anda.
          </p>
          <p className="mt-3 max-w-[440px] text-sm text-white/65">
            Masuk untuk checkout lebih cepat, melacak pesanan, dan menyimpan alamat pengiriman.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-5 text-xs text-white/70">
            <li className="flex items-center gap-1.5">
              <Wallet size={14} /> Bayar di tempat (COD)
            </li>
            <li className="flex items-center gap-1.5">
              <QrCode size={14} /> QRIS
            </li>
            <li className="flex items-center gap-1.5">
              <Truck size={14} /> Dikirim ke alamat Anda
            </li>
          </ul>
        </div>
      </section>

      {/* ---------- Panel formulir ---------- */}
      <div className="flex h-dvh flex-col lg:h-full lg:p-3">
        <div className="relative flex h-16 shrink-0 items-center justify-between overflow-hidden px-5 lg:hidden">
          <div aria-hidden className={cn(MOTIF_BENDERA, 'inset-y-0 right-0 w-48 [mask-image:linear-gradient(to_left,black,transparent)]')} />
          <LogoToko toko={toko} kecil />
          <span className="relative">{tautanKembali(true)}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col rounded-t-[20px] bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-2 lg:rounded-[24px] lg:px-12 lg:py-5">
          <div className="hidden h-9 shrink-0 items-center justify-end lg:flex">{tautanKembali(false)}</div>
          {/* Gulir di sini hanya cadangan untuk layar yang sangat pendek. */}
          <div className="tanpa-bilah flex min-h-0 flex-1 flex-col overflow-y-auto py-4">
            <div className="mx-auto mt-4 w-full max-w-[400px] lg:my-auto">{children}</div>
          </div>
          {kaki && <div className="shrink-0 pt-2 text-center text-xs leading-relaxed text-black/45">{kaki}</div>}
        </div>
      </div>
    </main>
  );
}

/** Label di atas kolom, slot opsional di kanan label, dan tempat pesan galat setinggi tetap. */
export function Bidang({
  id,
  label,
  kanan,
  galat,
  slotGalat = true,
  className,
  children,
}: {
  id: string;
  label: string;
  kanan?: ReactNode;
  galat?: string;
  slotGalat?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className={LABEL_AUTH}>
          {label}
        </label>
        {kanan}
      </div>
      {children}
      {slotGalat && <PesanGalat teks={galat} />}
    </div>
  );
}

/** Tempat pesan galat di bawah kolom (tingginya tetap supaya susunan tidak melompat). */
export function PesanGalat({ teks }: { teks?: string }) {
  return (
    <div className="min-h-[18px] pt-1 text-xs leading-[14px] text-rose-600" role={teks ? 'alert' : undefined}>
      {teks}
    </div>
  );
}

export function KolomSandi({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  galat = false,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  galat?: boolean;
}) {
  const [lihat, setLihat] = useState(false);
  return (
    <div
      className={cn(
        'flex h-11 items-center rounded-xl border bg-white transition-[border-color,box-shadow] duration-150 focus-within:ring-4',
        galat
          ? 'border-rose-500 focus-within:ring-rose-500/15'
          : 'border-black/[0.12] focus-within:border-brand-500 focus-within:ring-brand-500/15',
      )}
    >
      <input
        id={id}
        aria-label={label}
        type={lihat ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-full min-w-0 flex-1 rounded-xl bg-transparent px-3.5 text-sm text-[#0b0c1a] outline-none placeholder:text-black/30"
      />
      <button
        type="button"
        onClick={() => setLihat(!lihat)}
        aria-label={lihat ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
        className="grid h-full w-11 shrink-0 place-items-center text-black/40 transition-colors duration-150 hover:text-black/70"
      >
        {lihat ? <Eye size={17} /> : <EyeOff size={17} />}
      </button>
    </div>
  );
}

export function PemisahAtau() {
  return (
    <div className="flex items-center gap-3 py-4 text-xs text-black/35">
      <span className="h-px flex-1 bg-black/10" /> atau <span className="h-px flex-1 bg-black/10" />
    </div>
  );
}

function LogoGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Tombol Google bergaya toko. Bila toko sudah mengisi GOOGLE_CLIENT_ID,
 * tombol resmi Google dipasang transparan di atasnya sehingga klik diproses
 * Google; bila belum, klik memberi tahu bahwa fitur belum diaktifkan.
 */
export function TombolGoogle({ googleId, onKredensial }: { googleId: string | null; onKredensial: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const terbaru = useRef(onKredensial);
  terbaru.current = onKredensial;

  useEffect(() => {
    if (!googleId) return;
    const pasang = () => {
      const g = window.google;
      const el = ref.current;
      if (!g || !el) return;
      g.accounts.id.initialize({ client_id: googleId, callback: ({ credential }) => terbaru.current(credential) });
      g.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: el.offsetWidth || 340, text: 'continue_with', locale: 'id' });
    };
    if (window.google) {
      pasang();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = pasang;
    document.head.appendChild(s);
  }, [googleId]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (!googleId) toast.error('Masuk dengan Google belum diaktifkan toko.');
        }}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-black/[0.12] bg-white text-sm font-medium text-[#0b0c1a] transition-colors duration-150 hover:bg-black/[0.03]"
      >
        <LogoGoogle /> Lanjutkan dengan Google
      </button>
      {googleId && <div ref={ref} className="absolute inset-0 flex items-center overflow-hidden opacity-[0.011]" />}
    </div>
  );
}
