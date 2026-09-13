import { ShoppingBag } from 'lucide-react';
import { Link } from '@/lib/router';
import { cn, formatMoney, formatNumber } from '@/lib/format';
import { Bintang } from '@/components/public/Bintang';
import type { KelompokProduk } from '@/lib/publicCatalog';

/**
 * Kartu produk mengikuti kartu Lazada: rata tanpa bingkai dan tanpa tombol,
 * seluruh kartu adalah tautan ke halaman produk, dan saat disorot muncul
 * bayangan lembut. `gaya="cari"` dipakai di halaman hasil pencarian: bayangan
 * muncul dengan animasi 0,3 detik dan ada baris "terjual | rating".
 */
export function KartuProduk({
  kelompok,
  currency,
  gaya = 'beranda',
  lokasi,
}: {
  kelompok: KelompokProduk;
  currency?: string;
  gaya?: 'beranda' | 'cari';
  /** Lokasi toko di pojok kanan bawah kartu hasil pencarian. */
  lokasi?: string;
}) {
  const p = kelompok.wakil;
  const harga = kelompok.hargaMin;
  const coret = Number(p.compare_at_price ?? 0);
  const diskon = coret > harga && harga > 0 ? Math.round((1 - harga / coret) * 100) : 0;
  const bervariasi = kelompok.anggota.length > 1;

  return (
    <Link
      to={`/toko/produk?id=${p.id}`}
      data-kartu-produk=""
      className={cn(
        'flex h-full flex-col overflow-hidden bg-white hover:shadow-[0_2px_12px_rgba(0,0,0,0.16)] dark:bg-ink-900',
        gaya === 'cari' && 'transition-shadow duration-300',
      )}
    >
      <div className="relative aspect-square bg-white dark:bg-ink-900">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
            <ShoppingBag size={30} />
          </div>
        )}
        {kelompok.habis && (
          <div className="absolute inset-0 grid place-items-center bg-white/60 dark:bg-ink-900/60">
            <span className="rounded-sm bg-ink-800/80 px-2 py-1 text-xs font-medium text-white">Stok habis</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-2 pb-3 pt-2">
        <span className="line-clamp-2 min-h-9 text-sm leading-[18px] text-ink-800 dark:text-ink-100">{p.name}</span>
        <span className="mt-1.5 text-lg leading-6 text-brand-600">{formatMoney(harga, currency)}</span>
        {gaya === 'beranda' ? (
          <>
            {diskon > 0 && (
              <span className="text-xs text-ink-400">
                <span className="line-through">{formatMoney(coret, currency)}</span>
                <span className="ml-1 text-ink-700 dark:text-ink-300">-{diskon}%</span>
              </span>
            )}
            {kelompok.ratingCount > 0 && (
              <span className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
                <Bintang nilai={kelompok.ratingAvg} ukuran={11} />({formatNumber(kelompok.ratingCount)})
              </span>
            )}
          </>
        ) : (
          <>
            {diskon > 0 && (
              <span className="text-[11px]">
                <span className="text-ink-600 dark:text-ink-300">Hemat {diskon}%</span>{' '}
                <span className="text-ink-400 line-through">{formatMoney(coret, currency)}</span>
              </span>
            )}
            {(kelompok.terjual > 0 || kelompok.ratingCount > 0 || lokasi) && (
              <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-500">
                {kelompok.terjual > 0 && <span>{formatNumber(kelompok.terjual)} terjual</span>}
                {kelompok.terjual > 0 && kelompok.ratingCount > 0 && <span className="text-ink-300">|</span>}
                {kelompok.ratingCount > 0 && (
                  <>
                    <Bintang nilai={kelompok.ratingAvg} ukuran={11} />
                    <span className="text-ink-400">({formatNumber(kelompok.ratingCount)})</span>
                  </>
                )}
                {lokasi && (
                  <span className="ml-auto max-w-[50%] truncate text-[11px] text-ink-400" title={lokasi}>
                    {lokasi}
                  </span>
                )}
              </span>
            )}
          </>
        )}
        {bervariasi && <span className="mt-0.5 text-[11px] text-ink-400">{kelompok.anggota.length} variasi</span>}
      </div>
    </Link>
  );
}
