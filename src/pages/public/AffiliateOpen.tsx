import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { PublicShell } from '@/components/layout/PublicShell';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { cn } from '@/lib/format';
import { useCustomer } from '@/lib/customerAccount';
import { affiliateApi, type Hasil } from '@/lib/affiliate';

/** Pesan galat contoh untuk merender keadaan layar di mode pengembangan. */
const PESAN_FIXTURE: Record<string, string> = {
  'galat-kode': 'Affiliasi tidak terdaftar di database',
  'galat-produk': 'Produk tidak terdaftar di database',
  'galat-mati': 'Produk ini sudah tidak diaffiliasikan lagi',
  'galat-izin': 'Link affiliasi ini tidak diperkenankan. Silahkan hubungi pemilik link affiliasi ini',
  'undangan-hilang': 'Undangan tidak ditemukan. Minta pengundang mengirim ulang.',
  'undangan-kedaluwarsa': 'Undangan ini sudah kedaluwarsa. Minta pengundang mengirim ulang.',
};
const FIXTURE = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('fixture') : null;

/**
 * Permintaan yang sedang berjalan per alamat. StrictMode menjalankan efek dua kali
 * saat pengembangan; tanpa ini satu kunjungan tercatat sebagai dua klik.
 */
const sedangDibuka = new Map<string, Promise<Hasil<{ redirect: string }>>>();

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Jaringan putus atau galat server: gangguan sementara, bukan salah link. */
const gangguanSementara = (r: Hasil<unknown>) => r.status === 0 || r.status >= 500;

/**
 * Halaman pembuka link affiliate (`/aff/{KODE}`, `/aff/{KODE}/{id produk}`)
 * dan undangan (`/aff/undangan/{token}`). Server yang memeriksa, mencatat klik,
 * dan memasang cookie; halaman ini hanya meneruskan pengunjung ke tujuan atau
 * menampilkan pesan galat Sejoli bila link tidak sah.
 */
export function AffiliateOpen() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useCustomer((s) => s.token);
  const [galat, setGalat] = useState<string | null>(FIXTURE && FIXTURE !== 'memuat' ? PESAN_FIXTURE[FIXTURE] ?? null : null);
  const bagian = location.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const undangan = bagian[0] === 'undangan';

  useEffect(() => {
    if (FIXTURE) return;
    let batal = false;
    async function buka() {
      const q = new URLSearchParams(location.search);
      const kunci = location.pathname + location.search;
      let janji = sedangDibuka.get(kunci);
      if (!janji) {
        const minta = () =>
          undangan
            ? affiliateApi.openInvitation({ store_id: PUBLIC_STORE_ID, token: bagian[1] ?? '' })
            : affiliateApi.click(
                {
                  store_id: PUBLIC_STORE_ID,
                  code: bagian[0] ?? '',
                  product_id: bagian[1] ?? null,
                  utm_source: q.get('utm_source'),
                  utm_media: q.get('utm_media'),
                },
                token,
              );
        // Sinyal HP sering putus sesaat. Satu percobaan ulang menyelamatkan klik
        // (dan komisi affiliate) tanpa membuat pengunjung menunggu lama.
        janji = minta().then(async (r) => {
          if (!gangguanSementara(r)) return r;
          await new Promise((selesai) => window.setTimeout(selesai, 1200));
          return minta();
        });
        sedangDibuka.set(kunci, janji);
        window.setTimeout(() => sedangDibuka.delete(kunci), 10_000);
      }
      const r = await janji;
      if (batal) return;
      if (r.data?.redirect) {
        navigate(r.data.redirect, { replace: true });
        return;
      }
      // Halaman ini ada untuk mengantar pengunjung ke produk. Gangguan yang bukan
      // salah link (jaringan, galat server, batas laju) tidak boleh menahannya
      // di layar galat: pengunjung tetap diantar, hanya kliknya yang tidak tercatat.
      if (gangguanSementara(r) || r.status === 429) {
        const tujuan = undangan ? '/toko/masuk?tab=daftar' : POLA_UUID.test(bagian[1] ?? '') ? `/toko/produk?id=${bagian[1]}` : '/toko';
        navigate(tujuan, { replace: true });
        return;
      }
      setGalat(r.error ?? 'Terjadi kesalahan pada link affiliasi. Kontak pemilik website ini');
    }
    void buka();
    return () => {
      batal = true;
    };
    // Sekali per alamat: membuka ulang link yang sama tidak perlu dicatat dua kali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <PublicShell>
      <div className="mx-auto max-w-md py-10" data-affiliate-buka={galat ? 'galat' : 'memuat'}>
        {galat ? (
          <div className="rounded-lg bg-white p-6 text-center shadow-card dark:bg-ink-900 sm:p-8">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40">
              <AlertTriangle size={22} />
            </span>
            <h1 className="mt-3 text-lg font-semibold text-ink-900 dark:text-ink-100">
              {undangan || FIXTURE?.startsWith('undangan') ? 'Undangan tidak bisa dipakai' : 'Kesalahan pada link affiliasi'}
            </h1>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300" role="alert">
              {galat}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                to="/toko"
                className="inline-flex h-[44px] items-center justify-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-600"
              >
                Ke toko
              </Link>
              {(undangan || FIXTURE?.startsWith('undangan')) && (
                <Link
                  to="/toko/masuk?tab=daftar"
                  className={cn(
                    'inline-flex h-[44px] items-center justify-center rounded-md border border-ink-200 px-5 text-sm font-medium text-ink-700 transition-colors duration-150 hover:bg-ink-50',
                    'dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800',
                  )}
                >
                  Daftar tanpa undangan
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-sm text-ink-500" aria-busy="true">
            <Loader2 size={28} className="animate-spin text-brand-500" />
            Membuka toko...
          </div>
        )}
      </div>
    </PublicShell>
  );
}
