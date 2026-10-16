import { useEffect, useRef, useState, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff, Store, X } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useNavigate } from '@/lib/router';
import { cn } from '@/lib/format';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { fetchPublicCatalog, type PublicCatalogStore } from '@/lib/publicCatalog';
import { useModalMasuk, type ModeMasuk } from '@/stores/modalMasuk';

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

export const TOMBOL_AUTH =
  'h-12 w-full rounded-md bg-brand-600 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-brand-600';

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

/* ------------------------------------------------------------------ */
/* Pop-up (layar lebar) atau halaman penuh (HP)                        */
/* ------------------------------------------------------------------ */

/** Mulai lebar ini masuk/daftar tampil sebagai pop-up; di bawahnya halaman penuh. */
const MEDIA_POPUP = '(min-width: 768px)';

export function pakaiModal(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MEDIA_POPUP).matches;
}

export function useLayarLebar(): boolean {
  const [lebar, setLebar] = useState(pakaiModal);
  useEffect(() => {
    const mq = window.matchMedia(MEDIA_POPUP);
    const ubah = () => setLebar(mq.matches);
    mq.addEventListener('change', ubah);
    return () => mq.removeEventListener('change', ubah);
  }, []);
  return lebar;
}

function alamatMasuk(mode: ModeMasuk, next: string | null): string {
  if (mode === 'lupa') return '/toko/lupa-sandi';
  const q = new URLSearchParams();
  if (mode === 'daftar') q.set('tab', 'daftar');
  if (next) q.set('next', next);
  return `/toko/masuk${q.toString() ? `?${q}` : ''}`;
}

/** Buka masuk/daftar: pop-up di layar lebar, halaman masuk di HP. */
export function useBukaMasuk() {
  const navigate = useNavigate();
  const bukaModal = useModalMasuk((s) => s.bukaModal);
  return (mode: ModeMasuk = 'masuk', next: string | null = null) => {
    if (pakaiModal()) bukaModal(mode, next);
    else navigate(alamatMasuk(mode, next));
  };
}

/**
 * Pengendali klik untuk tautan ke halaman masuk yang sudah ada: di layar lebar
 * perpindahan halaman dibatalkan dan pop-up dibuka; di HP tautan jalan biasa.
 */
export function useKlikMasuk() {
  const bukaModal = useModalMasuk((s) => s.bukaModal);
  return (mode: ModeMasuk = 'masuk', next: string | null = null) =>
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (!pakaiModal()) return;
      e.preventDefault();
      bukaModal(mode, next);
    };
}

function useKunciGulir() {
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
}

export function LogoToko({ toko }: { toko: PublicCatalogStore | null }) {
  const nama = toko?.name ?? 'TokoKu';
  return (
    <Link to="/toko" aria-label={`Beranda ${nama}`} className="inline-flex items-center">
      {toko?.logo_url ? (
        <img src={toko.logo_url} alt={nama} className="h-10 w-auto max-w-[200px] object-contain" />
      ) : (
        <span className="flex items-center gap-2 text-xl font-bold text-brand-700">
          <Store size={24} /> {nama}
        </span>
      )}
    </Link>
  );
}

/**
 * Pop-up masuk di layar lebar: halaman di belakangnya tetap, hanya diburamkan.
 * Tutup lewat tombol X, klik di luar kartu, atau tombol Esc.
 */
export function DialogMasuk({ onTutup, children }: { onTutup: () => void; children: ReactNode }) {
  const toko = useTokoPublik();
  const tutupTerbaru = useRef(onTutup);
  tutupTerbaru.current = onTutup;
  useKunciGulir();

  useEffect(() => {
    const tekan = (e: KeyboardEvent) => e.key === 'Escape' && tutupTerbaru.current();
    window.addEventListener('keydown', tekan);
    return () => window.removeEventListener('keydown', tekan);
  }, []);

  return (
    <div
      className="tanpa-bilah fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm [animation:latar-muncul_150ms_ease-out]"
      onMouseDown={(e) => e.target === e.currentTarget && onTutup()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="judul-auth"
        className="permukaan-terang relative w-full max-w-[440px] rounded-lg bg-white px-10 pb-8 pt-9 shadow-[0_16px_48px_rgba(0,0,0,0.2)] [animation:dialog-muncul_180ms_ease-out]"
      >
        <button
          type="button"
          aria-label="Tutup"
          onClick={onTutup}
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-black/45 transition-colors duration-150 hover:bg-black/[0.05] hover:text-black"
        >
          <X size={18} />
        </button>
        <div className="flex justify-center">
          <LogoToko toko={toko} />
        </div>
        {children}
      </section>
    </div>
  );
}

/** Halaman masuk di HP: layar penuh, ringkas, tanpa navbar & footer toko. */
export function KerangkaAuth({ children, kembali = '/toko' }: { children: ReactNode; kembali?: string }) {
  const toko = useTokoPublik();
  useKunciGulir();
  return (
    <main className="permukaan-terang fixed inset-0 overflow-hidden bg-white">
      <div className="tanpa-bilah h-full overflow-y-auto px-6 pb-6 pt-3">
        <div className="mx-auto w-full max-w-[400px]">
          <div className="relative flex h-12 items-center justify-center">
            <Link
              to={kembali}
              aria-label="Kembali"
              className="absolute left-0 -ml-2 grid h-10 w-10 place-items-center rounded-full text-black/60 transition-colors duration-150 hover:bg-black/[0.05]"
            >
              <ArrowLeft size={22} />
            </Link>
            <LogoToko toko={toko} />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Kontrol formulir                                                    */
/* ------------------------------------------------------------------ */

/**
 * Kolom dengan label mengambang: di tengah kolom saat kosong, pindah ke garis
 * tepi atas saat kolom difokus atau terisi.
 */
export function KolomApung({
  id,
  label,
  galat = false,
  kanan,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'placeholder'> & {
  id: string;
  label: string;
  galat?: boolean;
  kanan?: ReactNode;
}) {
  return (
    <div className="relative">
      <input
        {...input}
        id={id}
        aria-label={label}
        placeholder=" "
        className={cn(
          'peer h-[52px] w-full rounded-md border bg-white px-3.5 text-[15px] text-[#1a1a1a] outline-none transition-[border-color,box-shadow] duration-150',
          kanan && 'pr-12',
          galat
            ? 'border-rose-500 focus:ring-1 focus:ring-rose-500'
            : 'border-black/25 hover:border-black/40 focus:border-brand-600 focus:ring-1 focus:ring-brand-600',
          className,
        )}
      />
      <label
        htmlFor={id}
        className={cn(
          'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 bg-white px-1 text-[15px] text-black/50 transition-all duration-150',
          'peer-focus:top-0 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-xs',
          galat ? 'text-rose-600 peer-focus:text-rose-600' : 'peer-focus:text-brand-600',
        )}
      >
        {label}
      </label>
      {kanan && <div className="absolute inset-y-0 right-0 flex items-center">{kanan}</div>}
    </div>
  );
}

export function KolomSandi({
  id,
  label,
  value,
  onChange,
  autoComplete,
  galat = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  galat?: boolean;
}) {
  const [lihat, setLihat] = useState(false);
  return (
    <KolomApung
      id={id}
      label={label}
      type={lihat ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      galat={galat}
      kanan={
        <button
          type="button"
          onClick={() => setLihat(!lihat)}
          aria-label={lihat ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
          className="grid h-full w-12 place-items-center text-black/45 transition-colors duration-150 hover:text-black/75"
        >
          {lihat ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      }
    />
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

// black/40 di atas putih cuma 2,85:1, di bawah ambang keterbacaan 3:1, dan itu
// berlaku di mode terang maupun gelap. black/55 memberi 4,3:1.
export function PemisahAtau() {
  return (
    <div className="flex items-center gap-4 py-5 text-[11px] font-medium uppercase tracking-wider text-black/55">
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
        className="flex h-12 w-full items-center gap-4 rounded-md border border-black/20 bg-white px-4 text-left text-[15px] text-[#1a1a1a] transition-colors duration-150 hover:bg-black/[0.03]"
      >
        <LogoGoogle /> Lanjutkan dengan Google
      </button>
      {googleId && <div ref={ref} className="absolute inset-0 flex items-center overflow-hidden opacity-[0.011]" />}
    </div>
  );
}
