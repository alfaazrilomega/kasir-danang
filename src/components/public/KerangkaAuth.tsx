import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Store } from 'lucide-react';
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

export const KOLOM_AUTH =
  'h-10 w-full rounded-[2px] border border-black/[0.14] bg-white px-3 text-sm text-black/80 outline-none transition-colors duration-200 placeholder:text-black/35 focus:border-black/55 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100';

export const TOMBOL_AUTH =
  'h-10 w-full rounded-[2px] bg-brand-600 text-sm uppercase text-white shadow-[0_1px_1px_rgba(0,0,0,0.09)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60';

/** Tujuan setelah masuk hanya boleh halaman toko, bukan alamat sembarang. */
export function tujuanAman(v: string | null): string {
  return v && v.startsWith('/toko') ? v : '/toko/akun';
}

let janjiToko: Promise<PublicCatalogStore | null> | null = null;

/** Nama & logo toko untuk halaman masuk (diambil sekali per kunjungan). */
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

/**
 * Kerangka halaman masuk/daftar/lupa sandi ala Shopee, tanpa navbar dan tanpa
 * footer: memenuhi layar dan tidak bisa digulir. `panelMerek` = latar warna
 * toko dengan logo besar di kiri (masuk & daftar); tanpa itu latar abu-abu
 * dengan kartu di tengah (reset kata sandi).
 */
export function KerangkaAuth({ children, panelMerek = true }: { children: ReactNode; panelMerek?: boolean }) {
  const toko = useTokoPublik();
  const nama = toko?.name ?? 'TokoKu';

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

  const logo = (ukuran: string, ikon: number) => (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden bg-white text-brand-600', ukuran)}>
      {toko?.logo_url ? <img src={toko.logo_url} alt="" className="h-full w-full object-cover" /> : <Store size={ikon} strokeWidth={1.6} />}
    </span>
  );

  return (
    <main className={cn('fixed inset-0 overflow-hidden', panelMerek ? 'bg-brand-600' : 'bg-[#f5f5f5] dark:bg-ink-950')}>
      <div
        className={cn(
          'mx-auto flex h-full w-full max-w-[1040px] flex-col items-center justify-center gap-5 px-4',
          panelMerek && 'lg:flex-row lg:justify-between',
        )}
      >
        {panelMerek && (
          <Link to="/toko" aria-label={`Kembali ke ${nama}`} className="hidden w-[440px] flex-col items-center text-center text-white lg:flex">
            {logo('h-[160px] w-[160px] rounded-[28px] shadow-lg', 84)}
            <span className="mt-6 text-5xl font-semibold tracking-tight">{nama}</span>
            <span className="mt-4 text-2xl font-medium">Belanja Mudah, Dikirim ke Rumah</span>
          </Link>
        )}
        <Link
          to="/toko"
          className={cn('flex items-center gap-2 text-lg font-bold', panelMerek ? 'text-white lg:hidden' : 'text-brand-700 dark:text-brand-200')}
        >
          {logo('h-9 w-9 rounded-lg', 18)}
          {nama}
        </Link>
        {children}
      </div>
    </main>
  );
}

export function KartuAuth({ children, lebar = 'max-w-[400px]' }: { children: ReactNode; lebar?: string }) {
  return (
    <div
      className={cn(
        'max-h-[calc(100dvh-96px)] w-full overflow-y-auto rounded-[4px] bg-white px-[30px] pb-[30px] pt-[22px] shadow-[0_3px_10px_rgba(0,0,0,0.14)] dark:bg-ink-900',
        lebar,
      )}
    >
      {children}
    </div>
  );
}

/** Tempat pesan galat di bawah kolom (tingginya tetap, seperti jarak antar kolom di Shopee). */
export function PesanGalat({ teks }: { teks?: string }) {
  return (
    <div className="min-h-[30px] pt-1 text-xs text-rose-600" role={teks ? 'alert' : undefined}>
      {teks}
    </div>
  );
}

export function KolomSandi({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  kanan,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  kanan?: ReactNode;
}) {
  const [lihat, setLihat] = useState(false);
  return (
    <div className="flex h-10 items-center rounded-[2px] border border-black/[0.14] bg-white transition-colors duration-200 focus-within:border-black/55 dark:border-ink-700 dark:bg-ink-900">
      <input
        aria-label={label}
        type={lihat ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        autoComplete={autoComplete}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-black/80 outline-none placeholder:text-black/35 dark:text-ink-100"
      />
      <button
        type="button"
        onClick={() => setLihat(!lihat)}
        aria-label={lihat ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
        className="grid h-full w-10 shrink-0 place-items-center text-black/40 transition-colors duration-150 hover:text-black/70"
      >
        {lihat ? <Eye size={17} /> : <EyeOff size={17} />}
      </button>
      {kanan}
    </div>
  );
}

export function PemisahAtau() {
  return (
    <div className="flex items-center gap-4 py-[14px] text-xs uppercase text-black/25">
      <span className="h-px flex-1 bg-black/10" /> Atau <span className="h-px flex-1 bg-black/10" />
    </div>
  );
}

function LogoGoogle() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Tombol Google bergaya Shopee. Bila toko sudah mengisi GOOGLE_CLIENT_ID,
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
        className="flex h-10 w-full items-center justify-center gap-2 rounded-[2px] border border-black/25 bg-white text-sm text-black/85 transition-colors duration-150 hover:bg-black/[0.02] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
      >
        <LogoGoogle /> Google
      </button>
      {googleId && <div ref={ref} className="absolute inset-0 overflow-hidden opacity-[0.011]" />}
    </div>
  );
}
