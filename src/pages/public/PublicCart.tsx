import { useEffect, useMemo, useState } from 'react';
import { Heart, MapPin, Minus, Plus, ShoppingBag, ShoppingCart, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PublicShell } from '@/components/layout/PublicShell';
import { cn, formatMoney } from '@/lib/format';
import { Link, useNavigate } from '@/lib/router';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { fetchPublicCatalog } from '@/lib/publicCatalog';
import { useCustomer } from '@/lib/customerAccount';
import { useKlikMasuk } from '@/components/public/KerangkaAuth';
import { usePublicCart } from '@/stores/publicCart';
import { useWishlist } from '@/stores/wishlist';

// Sasaran sentuh di HP: 16px terlalu kecil untuk jari, jadi ukurannya ikut
// lebar layar dan berhenti di 20px.
const KOTAK = 'h-[clamp(1.125rem,5vw,1.25rem)] w-[clamp(1.125rem,5vw,1.25rem)] shrink-0 cursor-pointer accent-brand-600';

/**
 * Keranjang dengan susunan keranjang Lazada: baris "Pilih semua" + Hapus,
 * kartu toko berisi barang bercentang, lalu panel kanan Lokasi dan
 * Ringkasan Pesanan dengan tombol Checkout. Hanya barang yang dicentang yang
 * dibawa ke checkout.
 */
export function PublicCart() {
  const navigate = useNavigate();
  const lines = usePublicCart((s) => s.lines);
  const updateQty = usePublicCart((s) => s.updateQty);
  const remove = usePublicCart((s) => s.remove);
  const favorit = useWishlist((s) => s.ids);
  const toggleFavorit = useWishlist((s) => s.toggle);
  const token = useCustomer((s) => s.token);
  const klikMasuk = useKlikMasuk();
  const me = useCustomer((s) => s.me);
  const [namaToko, setNamaToko] = useState('');
  const [pilih, setPilih] = useState<string[]>(() => lines.map((l) => l.product_id));

  useEffect(() => {
    let alive = true;
    fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((d) => alive && setNamaToko(d.store?.name ?? ''))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Barang yang dihapus ikut keluar dari pilihan.
  useEffect(() => {
    setPilih((p) => p.filter((id) => lines.some((l) => l.product_id === id)));
  }, [lines]);

  const terpilih = useMemo(() => lines.filter((l) => pilih.includes(l.product_id)), [lines, pilih]);
  const subtotal = terpilih.reduce((sum, l) => sum + l.price * l.qty, 0);
  const qtyTerpilih = terpilih.reduce((sum, l) => sum + l.qty, 0);
  const semua = lines.length > 0 && terpilih.length === lines.length;

  const pilihSemua = () => setPilih(semua ? [] : lines.map((l) => l.product_id));
  const togglePilih = (id: string) => setPilih((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function hapusTerpilih() {
    if (!terpilih.length) return;
    terpilih.forEach((l) => remove(l.product_id));
    toast.success(`${terpilih.length} barang dihapus dari keranjang.`);
  }

  function checkout() {
    if (!terpilih.length) {
      toast.error('Centang minimal satu barang untuk checkout.');
      return;
    }
    navigate(semua ? '/toko/checkout' : `/toko/checkout?pilih=${terpilih.map((l) => l.product_id).join(',')}`);
  }

  if (lines.length === 0) {
    return (
      <PublicShell wide>
        <div className="flex flex-col items-center py-16 text-center">
          <span className="grid h-40 w-40 place-items-center rounded-full bg-white text-brand-500 shadow-sm dark:bg-ink-900">
            <ShoppingCart size={72} strokeWidth={1.4} />
          </span>
          <p className="mt-6 text-xl text-ink-600 dark:text-ink-300">Kamu belum menambahkan produk</p>
          <div className="mt-6 flex w-[250px] flex-col gap-3">
            {!token && (
              <Link
                to={`/toko/masuk?next=${encodeURIComponent('/toko/keranjang')}`}
                onClick={klikMasuk('masuk', '/toko/keranjang')}
                className="flex h-10 items-center justify-center rounded-sm bg-brand-600 text-sm text-white transition-opacity duration-300 ease-out hover:opacity-90"
              >
                Masuk/Daftar
              </Link>
            )}
            <Link
              to="/toko"
              className="flex h-10 items-center justify-center rounded-sm border border-brand-600 bg-white text-sm text-brand-600 transition-colors duration-300 ease-out hover:bg-brand-50 dark:bg-ink-900"
            >
              Mulai belanja
            </Link>
          </div>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell wide>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_388px] lg:items-start">
        <div className="space-y-3">
          <div className="flex h-12 items-center justify-between bg-white px-4 text-sm dark:bg-ink-900">
            <label className="flex cursor-pointer items-center gap-3 uppercase text-ink-600 dark:text-ink-300">
              <input type="checkbox" className={KOTAK} checked={semua} onChange={pilihSemua} aria-label="Pilih semua barang" />
              Pilih semua ({lines.length} barang)
            </label>
            <button
              type="button"
              onClick={hapusTerpilih}
              disabled={!terpilih.length}
              className="flex items-center gap-1.5 uppercase text-ink-500 transition-colors duration-300 hover:text-brand-600 disabled:opacity-40"
            >
              <Trash2 size={16} /> Hapus
            </button>
          </div>

          <div className="bg-white dark:bg-ink-900">
            <div className="flex h-12 items-center gap-3 border-b border-ink-100 px-4 text-sm dark:border-ink-800">
              <input type="checkbox" className={KOTAK} checked={semua} onChange={pilihSemua} aria-label="Pilih semua barang toko ini" />
              <Store size={16} className="text-ink-500" />
              <Link to="/toko" className="font-medium text-ink-800 transition-colors duration-300 hover:text-brand-600 dark:text-ink-100">
                {namaToko || 'Toko'}
              </Link>
            </div>

            {lines.map((line) => {
              const fav = favorit.includes(line.product_id);
              const tautan = `/toko/produk?id=${line.product_id}`;
              return (
                <div key={line.product_id} className="flex items-start gap-3 border-b border-ink-100 px-4 py-4 last:border-b-0 dark:border-ink-800">
                  <input
                    type="checkbox"
                    className={cn(KOTAK, 'mt-8')}
                    checked={pilih.includes(line.product_id)}
                    onChange={() => togglePilih(line.product_id)}
                    aria-label={`Pilih ${line.name}`}
                  />
                  <Link to={tautan} className="h-20 w-20 shrink-0 overflow-hidden bg-white ring-1 ring-ink-100 dark:bg-ink-900 dark:ring-ink-800">
                    {line.image_url ? (
                      <img src={line.image_url} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                        <ShoppingBag size={22} />
                      </div>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_150px_130px] lg:gap-4">
                    <Link
                      to={tautan}
                      className="line-clamp-2 text-sm leading-5 text-ink-800 transition-colors duration-300 hover:text-brand-600 dark:text-ink-100"
                    >
                      {line.name}
                    </Link>
                    <div className="mt-1 lg:mt-0 lg:text-center">
                      <div className="text-lg text-brand-600">{formatMoney(line.price)}</div>
                      <div className="mt-1 flex gap-3 text-ink-400 lg:justify-center">
                        <button
                          type="button"
                          aria-label={fav ? 'Hapus dari favorit' : 'Tambah ke favorit'}
                          onClick={() => toast.success(toggleFavorit(line.product_id) ? 'Masuk ke Favorit.' : 'Dihapus dari Favorit.')}
                          className={cn('-m-2 p-2 transition-colors duration-300', fav ? 'text-rose-500' : 'hover:text-rose-500')}
                        >
                          <Heart size={17} className={fav ? 'fill-rose-500' : ''} />
                        </button>
                        <button
                          type="button"
                          aria-label="Hapus"
                          onClick={() => remove(line.product_id)}
                          className="-m-2 p-2 transition-colors duration-300 hover:text-brand-600"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center lg:mt-0 lg:justify-end lg:self-start">
                      <button
                        type="button"
                        aria-label="Kurangi"
                        onClick={() => updateQty(line.product_id, line.qty - 1)}
                        disabled={line.qty <= 1}
                        className="grid h-8 w-8 place-items-center bg-ink-100 text-ink-600 transition-colors duration-200 hover:bg-ink-200 disabled:opacity-40 dark:bg-ink-800 dark:text-ink-300"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm tabular-nums">{line.qty}</span>
                      <button
                        type="button"
                        aria-label="Tambah"
                        onClick={() => updateQty(line.product_id, line.qty + 1)}
                        className="grid h-8 w-8 place-items-center bg-ink-100 text-ink-600 transition-colors duration-200 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="bg-white p-4 text-sm lg:sticky lg:top-[calc(var(--tinggi-header,118px)+16px)] dark:bg-ink-900">
          <h2 className="text-ink-500">Lokasi</h2>
          <div className="mt-2 flex items-start gap-2 border-b border-ink-100 pb-4 dark:border-ink-800">
            <MapPin size={16} className="mt-0.5 shrink-0 text-ink-400" />
            <span className="min-w-0 flex-1 text-ink-700 dark:text-ink-200">
              {me?.address || (token ? 'Alamat belum diisi di akun.' : 'Masuk untuk memakai alamat pengirimanmu.')}
            </span>
          </div>
          <h2 className="mt-4 text-lg text-ink-800 dark:text-ink-100">Ringkasan Pesanan</h2>
          <div className="mt-3 flex justify-between text-ink-600 dark:text-ink-300">
            <span>Subtotal ({qtyTerpilih} barang)</span>
            <span className="tabular-nums">{formatMoney(subtotal)}</span>
          </div>
          <div className="mt-2 flex justify-between text-ink-600 dark:text-ink-300">
            <span>Ongkos Kirim</span>
            <span className="text-xs">Dikonfirmasi toko</span>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-4 dark:border-ink-800">
            <span className="text-ink-800 dark:text-ink-100">Total</span>
            <span className="text-lg text-brand-600 tabular-nums">{formatMoney(subtotal)}</span>
          </div>
          <button
            type="button"
            onClick={checkout}
            disabled={!terpilih.length}
            className="mt-4 h-10 w-full rounded-sm bg-brand-600 text-sm uppercase text-white transition-opacity duration-300 ease-out hover:opacity-90 disabled:opacity-50"
          >
            Checkout ({qtyTerpilih})
          </button>
        </aside>
      </div>
    </PublicShell>
  );
}
