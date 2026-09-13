// Ulasan produk toko online: staf membalas atau menyembunyikan ulasan pembeli.
// Pembeli menulisnya dari halaman akun setelah pesanannya selesai
// (lihat /api/customer/reviews).
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, EyeOff, MessageSquareText, Star, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Bintang } from '@/components/public/Bintang';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullInventoryReference } from '@/lib/sync';
import { cn, formatDateTime, formatNumber } from '@/lib/format';
import type { ProductReview } from '@/types';

type Filter = 'semua' | 'belum-dibalas' | 'disembunyikan';

export function ProductFeedback() {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [filter, setFilter] = useState<Filter>('semua');
  const [reviews, setReviews] = useState<ProductReview[] | null>(null);
  const [draf, setDraf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const produk = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function muat() {
    const { data, error } = await getBackendClient()
      .from('product_reviews')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setReviews((data ?? []) as ProductReview[]);
  }

  useEffect(() => {
    if (!storeId) return;
    void muat();
    void pullInventoryReference(storeId);
    // muat hanya bergantung pada storeId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const tampil = (reviews ?? []).filter((r) =>
    filter === 'semua' ? true : filter === 'disembunyikan' ? r.is_hidden : !r.seller_reply && !r.is_hidden,
  );
  const belumDibalas = (reviews ?? []).filter((r) => !r.seller_reply && !r.is_hidden).length;

  async function simpan(id: string, patch: Record<string, unknown>, pesan: string) {
    setBusy(id);
    const { error } = await getBackendClient().from('product_reviews').update(patch).eq('id', id);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(pesan);
    await muat();
  }

  function namaProduk(id: string) {
    const p = produk.get(id);
    return p ? `${p.name}${p.variant_name ? ` (${p.variant_name})` : p.sku ? ` (${p.sku})` : ''}` : 'Produk terhapus';
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-4 text-white">
        <div className="flex items-center gap-2 text-xl font-bold">
          <MessageSquareText size={22} /> Ulasan Produk
        </div>
        <p className="mt-0.5 text-sm text-white/80">
          Balas atau sembunyikan ulasan pembeli. Balasan tampil sebagai "Balasan Penjual" di halaman produk.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['semua', `Semua (${formatNumber((reviews ?? []).length)})`],
            ['belum-dibalas', `Belum dibalas (${formatNumber(belumDibalas)})`],
            ['disembunyikan', 'Disembunyikan'],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium transition',
              filter === value ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 hover:bg-ink-100 dark:bg-ink-900 dark:text-ink-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {reviews === null ? (
        <div className="h-32 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
      ) : tampil.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<Star size={24} />}
            title="Belum ada ulasan"
            description="Ulasan ditulis pembeli dari akunnya setelah pesanannya selesai."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {tampil.map((r) => (
            <Card key={r.id} className={cn('space-y-2 p-4', r.is_hidden && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-ink-500">{namaProduk(r.product_id)}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Bintang nilai={r.rating} />
                    <span className="text-[11px] text-ink-400">
                      {r.reviewer_name} · {formatDateTime(r.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-ink-500">
                    <ThumbsUp size={12} /> {formatNumber(r.helpful_count ?? 0)}
                  </span>
                  {r.is_hidden && <Badge>disembunyikan</Badge>}
                </div>
              </div>
              {(r.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {r.tags.map((t) => (
                    <span key={t} className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] dark:bg-ink-800">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {r.body && <p className="whitespace-pre-line text-sm">{r.body}</p>}
              {(r.images ?? []).length > 0 && (
                <div className="flex gap-2">
                  {r.images.map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noreferrer" className="h-16 w-16 overflow-hidden rounded-lg ring-1 ring-ink-100 dark:ring-ink-800">
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
              <textarea
                className="input min-h-[60px] w-full"
                aria-label="Balasan penjual"
                placeholder="Balas ulasan ini (tampil sebagai Balasan Penjual)…"
                value={draf[r.id] ?? r.seller_reply ?? ''}
                onChange={(e) => setDraf({ ...draf, [r.id]: e.target.value })}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => simpan(r.id, { is_hidden: !r.is_hidden }, r.is_hidden ? 'Ulasan ditampilkan.' : 'Ulasan disembunyikan.')}
                >
                  {r.is_hidden ? <Eye size={13} /> : <EyeOff size={13} />} {r.is_hidden ? 'Tampilkan' : 'Sembunyikan'}
                </Button>
                <Button
                  size="sm"
                  disabled={busy === r.id}
                  onClick={() => {
                    const balasan = (draf[r.id] ?? r.seller_reply ?? '').trim();
                    void simpan(
                      r.id,
                      { seller_reply: balasan || null, replied_at: balasan ? new Date().toISOString() : null },
                      'Balasan tersimpan.',
                    );
                  }}
                >
                  Simpan Balasan
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
