// Halaman Retur Barang.
//
// Alurnya mengikuti permintaan client: kasir mengetik NOMOR PEMESANAN, sistem
// menarik pesanannya, lalu kasir memilih barang mana yang dikembalikan.
//
// Nomor pesanan platform (mis. nomor Shopee) juga dikenali, karena pembeli
// marketplace merujuk pesanannya dengan nomor itu, bukan nomor internal kita.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PackageX, RotateCcw, Search, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { pullOrderReturns, pullRecentOrders, pullReference } from '@/lib/sync';
import { cn, errorMessage, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import {
  buildDraftLines,
  findOrderByNumber,
  refundTotal,
  saveOrderReturn,
  validateDraft,
  type OrderLookup,
  type ReturnDraftLine,
} from '@/lib/orderReturns';

export default function OrderReturns() {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const store = useLiveQuery(() => db.stores.get(storeId), [storeId]);
  const currency = store?.currency;

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<OrderLookup | null>(null);
  const [lines, setLines] = useState<ReturnDraftLine[]>([]);
  const [reason, setReason] = useState('');
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    pullReference(storeId);
    pullRecentOrders(storeId, 200);
    pullOrderReturns(storeId);
  }, [storeId]);

  const history = useLiveQuery(
    () => (storeId ? db.order_returns.where('store_id').equals(storeId).toArray() : []),
    [storeId],
  ) ?? [];

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50),
    [history],
  );

  const total = refundTotal(lines);
  const dipilih = lines.filter((l) => Number(l.qty || 0) > 0).length;

  async function search() {
    if (!storeId) return;
    if (!query.trim()) {
      toast.error('Isi nomor pemesanan lebih dulu.');
      return;
    }
    setSearching(true);
    try {
      const hasil = await findOrderByNumber(storeId, query);
      if (!hasil) {
        setFound(null);
        setLines([]);
        toast.error('Pesanan dengan nomor itu tidak ditemukan.');
        return;
      }
      setFound(hasil);
      setLines(buildDraftLines(hasil));
      setReason('');
    } finally {
      setSearching(false);
    }
  }

  function patch(id: string, next: Partial<ReturnDraftLine>) {
    setLines((rows) => rows.map((r) => (r.order_item_id === id ? { ...r, ...next } : r)));
  }

  function reset() {
    setFound(null);
    setLines([]);
    setQuery('');
    setReason('');
  }

  async function submit() {
    if (!found) return;
    const err = validateDraft(lines);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const hasil = await saveOrderReturn({
        storeId,
        order: found.order,
        lines,
        reason,
        actorId: profile?.id ?? null,
      });
      toast.success(
        `Retur ${hasil.order_number} tersimpan. Refund ${formatMoney(hasil.refund_amount, currency)}.`,
      );
      reset();
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyimpan retur.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Retur Barang</h1>
            <p className="text-sm opacity-80">
              Cari pesanan lewat nomor pemesanan, lalu pilih barang yang dikembalikan.
            </p>
          </div>
          <Badge tone="neutral" className="!bg-white/15 !text-white">
            {formatNumber(history.length)} retur tercatat
          </Badge>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Input
              label="Nomor pemesanan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search();
              }}
              placeholder="cth. #260812-173300-TokoAplikasiKasir-Shopee"
              hint="Nomor pesanan platform (Shopee/TikTok) juga bisa dipakai."
            />
          </div>
          <Button type="button" onClick={() => void search()} disabled={searching}>
            <Search size={15} /> {searching ? 'Mencari…' : 'Cari Pesanan'}
          </Button>
          {found && (
            <Button type="button" variant="secondary" onClick={reset}>
              Bersihkan
            </Button>
          )}
        </div>
      </Card>

      {found && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-3 dark:border-ink-800">
            <div>
              <div className="font-mono text-sm font-semibold">{found.order.order_number}</div>
              <div className="text-xs text-ink-500 dark:text-ink-400">
                {formatDateTime(found.order.created_at)} ·{' '}
                {formatMoney(Number(found.order.total), currency)}
                {found.order.external_order_no && (
                  <> · No. platform {found.order.external_order_no}</>
                )}
              </div>
            </div>
            <Badge tone={dipilih ? 'warning' : 'neutral'}>
              {dipilih} barang dipilih
            </Badge>
          </div>

          <div className="space-y-2">
            {lines.map((line) => {
              const habis = line.max_qty <= 0;
              return (
                <div
                  key={line.order_item_id}
                  className={cn(
                    'rounded-xl border px-3 py-2.5',
                    habis
                      ? 'border-ink-200 opacity-60 dark:border-ink-700'
                      : Number(line.qty) > 0
                        ? 'border-brand-400 bg-brand-50/50 dark:border-brand-500/40 dark:bg-brand-950/20'
                        : 'border-ink-200 dark:border-ink-700',
                  )}
                >
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold">{line.name}</div>
                    <div className="text-xs text-ink-500 dark:text-ink-400">
                      Bisa diretur: {formatNumber(line.max_qty)}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      label="Qty retur"
                      type="number"
                      min="0"
                      max={line.max_qty}
                      value={line.qty}
                      disabled={habis}
                      onChange={(e) =>
                        patch(line.order_item_id, { qty: Number(e.target.value) })
                      }
                    />
                    <Input
                      label="Refund per barang"
                      type="number"
                      min="0"
                      value={line.refund_price}
                      disabled={habis}
                      onChange={(e) =>
                        patch(line.order_item_id, { refund_price: Number(e.target.value) })
                      }
                    />
                    <Input
                      label="Catatan (opsional)"
                      value={line.note}
                      disabled={habis}
                      onChange={(e) => patch(line.order_item_id, { note: e.target.value })}
                      placeholder="cth. kemasan sobek"
                    />
                  </div>
                  <label
                    className={cn(
                      'mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm',
                      habis && 'cursor-not-allowed',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={line.restock}
                      disabled={habis}
                      onChange={(e) => patch(line.order_item_id, { restock: e.target.checked })}
                    />
                    <span>
                      Barang layak jual, kembalikan ke stok
                      {!line.restock && (
                        <span className="ml-1 text-ink-500 dark:text-ink-400">
                          — stok tidak bertambah
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Input
              label="Alasan retur"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="cth. barang tidak sesuai pesanan"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                Total refund{' '}
                <span className="text-lg font-bold">{formatMoney(total, currency)}</span>
              </div>
              <Button type="button" onClick={() => void submit()} disabled={busy || !dipilih}>
                <Undo2 size={15} /> {busy ? 'Menyimpan…' : 'Simpan Retur'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Riwayat Retur</h2>
        {sortedHistory.length === 0 ? (
          <EmptyState
            icon={<PackageX size={24} />}
            title="Belum ada retur"
            description="Retur yang tersimpan akan muncul di sini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-500 dark:text-ink-400">
                <tr>
                  <th className="px-2 py-2">No. Pemesanan</th>
                  <th className="px-2 py-2">Tanggal</th>
                  <th className="px-2 py-2">Alasan</th>
                  <th className="px-2 py-2 text-right">Refund</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((row) => (
                  <tr key={row.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="px-2 py-2 font-mono text-xs">{row.order_number}</td>
                    <td className="px-2 py-2">{formatDateTime(row.created_at)}</td>
                    <td className="px-2 py-2 text-ink-600 dark:text-ink-300">{row.reason ?? '—'}</td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {formatMoney(Number(row.refund_amount), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
        <RotateCcw size={12} /> Barang yang dikembalikan ke stok ikut tercatat di Mutasi Stok
        sebagai Retur, dan nilai refund memotong pendapatan di Laporan.
      </p>
    </div>
  );
}
