import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Minus, Plus, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PublicShell } from '@/components/layout/PublicShell';
import { Link, useLocation, useNavigate } from '@/lib/router';
import { formatMoney } from '@/lib/format';
import { fetchPublicCatalog, type PublicCatalogData, type PublicCatalogProduct } from '@/lib/publicCatalog';
import { PUBLIC_STORE_ID } from '@/lib/config';
import { usePublicCart } from '@/stores/publicCart';

const EMPTY: PublicCatalogData = { store: null, categories: [], products: [] };

/**
 * Halaman detail produk ala marketplace: foto besar, harga, stok, stepper
 * jumlah, dan DUA aksi terpisah — Tambah ke Keranjang (digabung belanjaan
 * lain) vs Beli Sekarang (langsung checkout, keranjang tidak disentuh).
 *
 * ID produk lewat query string (?id=...) karena router aplikasi ini cocok
 * path persis, tidak mendukung path param dinamis.
 */
export function PublicProductDetail() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const productId = new URLSearchParams(search).get('id') ?? '';

  const [catalog, setCatalog] = useState<PublicCatalogData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const add = usePublicCart((s) => s.add);
  const setBuyNow = usePublicCart((s) => s.setBuyNow);

  useEffect(() => {
    let alive = true;
    fetchPublicCatalog(PUBLIC_STORE_ID)
      .then((data) => alive && setCatalog(data))
      .catch((err) => alive && toast.error(err instanceof Error ? err.message : 'Gagal memuat produk.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Pindah antar produk (lewat "produk lainnya") harus mengulang jumlahnya.
  useEffect(() => setQty(1), [productId]);

  const { store, categories, products } = catalog;
  const product: PublicCatalogProduct | undefined = products.find((p) => p.id === productId);
  const categoryName = categories.find((c) => c.id === product?.category_id)?.name;
  const outOfStock = !!product?.track_stock && Number(product?.stock_qty ?? 0) <= 0;

  const related = useMemo(() => {
    if (!product) return [];
    const sameCategory = products.filter(
      (p) => p.id !== product.id && p.category_id === product.category_id,
    );
    const pool = sameCategory.length >= 4 ? sameCategory : products.filter((p) => p.id !== product.id);
    return pool.slice(0, 4);
  }, [products, product]);

  if (loading) {
    return (
      <PublicShell>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
          <div className="space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
            <div className="h-8 w-1/3 animate-pulse rounded bg-ink-100 dark:bg-ink-800" />
          </div>
        </div>
      </PublicShell>
    );
  }

  if (!product) {
    return (
      <PublicShell>
        <Card className="p-10 text-center">
          <p className="text-sm text-ink-500">Produk tidak ditemukan atau sudah tidak dijual.</p>
          <Button className="mt-4" onClick={() => navigate('/toko')}>Kembali ke Katalog</Button>
        </Card>
      </PublicShell>
    );
  }

  function addToCart() {
    if (!product) return;
    add(
      { product_id: product.id, name: product.name, price: Number(product.base_price), image_url: product.image_url },
      qty,
    );
    toast.success(`${product.name} ×${qty} masuk keranjang.`);
  }

  function buyNow() {
    if (!product) return;
    setBuyNow({
      product_id: product.id,
      name: product.name,
      price: Number(product.base_price),
      image_url: product.image_url,
      qty,
    });
    navigate('/toko/checkout?mode=direct');
  }

  return (
    <PublicShell>
      <div className="space-y-5">
        <Link
          to="/toko"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand-600"
        >
          <ChevronLeft size={16} /> Kembali ke katalog
        </Link>

        <div className="grid gap-5 md:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="aspect-square bg-ink-100 dark:bg-ink-800">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                  <ShoppingBag size={56} />
                </div>
              )}
            </div>
          </Card>

          <div className="space-y-4">
            <div>
              <div className="text-xs text-ink-500">{categoryName ?? 'Tanpa kategori'}</div>
              <h1 className="mt-1 text-2xl font-bold leading-tight">{product.name}</h1>
              <div className="mt-2 text-3xl font-bold text-brand-600">
                {formatMoney(Number(product.base_price), store?.currency)}
              </div>
              <div className="mt-2">
                {outOfStock ? (
                  <Badge tone="warning">Stok habis</Badge>
                ) : product.track_stock ? (
                  <Badge tone="success">Stok tersedia · {Number(product.stock_qty)} pcs</Badge>
                ) : (
                  <Badge tone="neutral">Siap dipesan</Badge>
                )}
              </div>
            </div>

            {product.description && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Deskripsi</div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                  {product.description}
                </p>
              </div>
            )}

            <Card className="flex items-center justify-between p-3.5">
              <span className="text-sm font-medium">Jumlah</span>
              <div className="flex items-center gap-2">
                <button
                  className="grid h-9 w-9 place-items-center rounded-full bg-ink-100 hover:bg-ink-200 disabled:opacity-40 dark:bg-ink-800"
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                  disabled={qty <= 1}
                  aria-label="Kurangi"
                >
                  <Minus size={14} />
                </button>
                <span className="w-8 text-center font-semibold">{qty}</span>
                <button
                  className="grid h-9 w-9 place-items-center rounded-full bg-ink-100 hover:bg-ink-200 dark:bg-ink-800"
                  onClick={() => setQty((n) => n + 1)}
                  aria-label="Tambah"
                >
                  <Plus size={14} />
                </button>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={outOfStock} onClick={addToCart}>
                Tambah ke Keranjang
              </Button>
              <Button disabled={outOfStock} onClick={buyNow}>
                Beli Sekarang
              </Button>
            </div>

            <Card className="space-y-2.5 p-4 text-xs text-ink-600 dark:text-ink-300">
              <div className="flex items-start gap-2">
                <Truck size={15} className="mt-0.5 shrink-0 text-brand-600" />
                <span>
                  Dikirim ke alamat yang kamu isi saat checkout. Ongkir dihitung dan
                  diinformasikan toko saat konfirmasi pesanan.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-600" />
                <span>
                  Pesanan tidak langsung ditagih. Toko mengonfirmasi ketersediaan barang lebih
                  dulu, baru pembayaran diproses.
                </span>
              </div>
            </Card>
          </div>
        </div>

        {related.length > 0 && (
          <div className="space-y-2.5 border-t border-ink-100 pt-5 dark:border-ink-800">
            <h2 className="text-base font-bold">Produk Lainnya</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {related.map((p) => (
                <Link key={p.id} to={`/toko/produk?id=${p.id}`}>
                  <Card className="overflow-hidden">
                    <div className="aspect-square bg-ink-100 dark:bg-ink-800">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                          <ShoppingBag size={24} />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{p.name}</div>
                      <div className="mt-1 text-sm font-bold text-brand-600">
                        {formatMoney(Number(p.base_price), store?.currency)}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
