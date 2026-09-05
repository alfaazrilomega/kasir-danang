import { useMemo } from 'react';
import { ChevronLeft, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PublicShell } from '@/components/layout/PublicShell';
import { formatMoney } from '@/lib/format';
import { Link, useNavigate } from '@/lib/router';
import { usePublicCart } from '@/stores/publicCart';

export function PublicCart() {
  const navigate = useNavigate();
  const lines = usePublicCart((s) => s.lines);
  const updateQty = usePublicCart((s) => s.updateQty);
  const remove = usePublicCart((s) => s.remove);

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.price * l.qty, 0), [lines]);
  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);

  return (
    <PublicShell>
      <div className="space-y-4">
        <Link
          to="/toko"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand-600"
        >
          <ChevronLeft size={16} /> Lanjut belanja
        </Link>

        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">Keranjang</h1>
          {lines.length > 0 && <span className="text-xs text-ink-500">{totalQty} barang</span>}
        </div>

        {lines.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              icon={<ShoppingBag size={24} />}
              title="Keranjang masih kosong"
              description="Yuk pilih produk dulu di katalog."
              action={<Button onClick={() => navigate('/toko')}>Lihat Katalog</Button>}
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
            <Card className="divide-y divide-ink-100 dark:divide-ink-800">
              {lines.map((line) => (
                <div key={line.product_id} className="flex items-center gap-3 p-3.5">
                  <Link
                    to={`/toko/produk?id=${line.product_id}`}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-ink-100 dark:bg-ink-800"
                  >
                    {line.image_url ? (
                      <img src={line.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-ink-300 dark:text-ink-600">
                        <ShoppingBag size={20} />
                      </div>
                    )}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link to={`/toko/produk?id=${line.product_id}`}>
                      <div className="line-clamp-2 text-sm font-medium leading-5 hover:text-brand-600">
                        {line.name}
                      </div>
                    </Link>
                    <div className="mt-0.5 text-sm font-bold text-brand-600">
                      {formatMoney(line.price)}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="grid h-7 w-7 place-items-center rounded-full bg-ink-100 hover:bg-ink-200 dark:bg-ink-800"
                        onClick={() => updateQty(line.product_id, line.qty - 1)}
                        aria-label="Kurangi"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{line.qty}</span>
                      <button
                        className="grid h-7 w-7 place-items-center rounded-full bg-ink-100 hover:bg-ink-200 dark:bg-ink-800"
                        onClick={() => updateQty(line.product_id, line.qty + 1)}
                        aria-label="Tambah"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        className="ml-1 grid h-7 w-7 place-items-center rounded-full text-ink-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                        onClick={() => remove(line.product_id)}
                        aria-label="Hapus"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="shrink-0 self-start text-sm font-semibold tabular-nums">
                    {formatMoney(line.price * line.qty)}
                  </div>
                </div>
              ))}
            </Card>

            <Card className="space-y-3 p-4 lg:sticky lg:top-20">
              <div className="text-sm font-semibold">Ringkasan</div>
              <div className="flex justify-between text-sm text-ink-600 dark:text-ink-300">
                <span>Subtotal ({totalQty} barang)</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-ink-600 dark:text-ink-300">
                <span>Ongkir</span>
                <span className="text-xs">Dihitung saat konfirmasi</span>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-3 text-base font-bold dark:border-ink-800">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
              <Button className="w-full" size="lg" onClick={() => navigate('/toko/checkout')}>
                Checkout
              </Button>
            </Card>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
