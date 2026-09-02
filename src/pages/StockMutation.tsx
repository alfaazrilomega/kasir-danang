// Halaman Mutasi Stok: riwayat pergerakan stok yang bisa disaring dan diekspor.
//
// Sebelumnya menu ini hanya panel kecil di Dashboard yang menampilkan 20 baris
// terakhir tanpa filter dan tanpa export, padahal datanya puluhan ribu baris.
//
// Sumber mutasi: penjualan POS ('sale'), restock/penyesuaian dari halaman
// Produk ('restock'/'adjust'), retur ('refund'), dan posting Stock Opname
// ('adjust'). Halaman ini hanya membaca; stok tidak pernah diubah dari sini.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Download,
  PackageSearch,
  RotateCcw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { pullInventoryReference, pullStockMovements } from '@/lib/sync';
import { cn, formatDateTime, formatNumber } from '@/lib/format';
import type { StockMovementType } from '@/types';

const TYPE_LABELS: Record<StockMovementType, string> = {
  sale: 'Penjualan',
  restock: 'Restock',
  adjust: 'Penyesuaian',
  refund: 'Retur / Kembali',
};

const PULL_LIMIT = 1000;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export function StockMutation() {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';

  const [from, setFrom] = useState(() => daysAgoIso(30));
  const [to, setTo] = useState(todayIso);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | StockMovementType>('all');

  useEffect(() => {
    if (!storeId) return;
    pullInventoryReference(storeId);
    pullStockMovements(storeId, PULL_LIMIT);
  }, [storeId]);

  const movements =
    useLiveQuery(
      () => db.stock_movements.where('store_id').equals(storeId).toArray(),
      [storeId],
    ) ?? [];
  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    // Batas atas dibuat inklusif sampai akhir hari supaya mutasi hari ini ikut.
    const startMs = new Date(`${from}T00:00:00`).getTime();
    const endMs = new Date(`${to}T23:59:59.999`).getTime();
    return movements
      .filter((m) => {
        const ts = new Date(m.created_at).getTime();
        return ts >= startMs && ts <= endMs;
      })
      .filter((m) => (typeFilter === 'all' ? true : m.type === typeFilter))
      .filter((m) => {
        if (!term) return true;
        const p = m.product_id ? productById.get(m.product_id) : null;
        return (
          (p?.name ?? '').toLowerCase().includes(term) ||
          (p?.sku ?? '').toLowerCase().includes(term) ||
          (p?.barcode ?? '').toLowerCase().includes(term) ||
          (m.reason ?? '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [movements, from, to, typeFilter, q, productById]);

  const summary = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    const perType = new Map<string, number>();
    for (const m of filtered) {
      const d = Number(m.qty_delta ?? 0);
      if (d > 0) masuk += d;
      else keluar += d;
      perType.set(m.type, (perType.get(m.type) ?? 0) + 1);
    }
    return { masuk, keluar, net: masuk + keluar, perType: [...perType.entries()] };
  }, [filtered]);

  const atLimit = movements.length >= PULL_LIMIT;

  async function exportCsv() {
    if (!filtered.length) {
      toast.message('Tidak ada mutasi untuk diekspor pada filter ini.');
      return;
    }
    const { exportStockMovementsBySKU } = await import('@/lib/exportUtils');
    const count = await exportStockMovementsBySKU(filtered);
    toast.success(`${count} baris mutasi diekspor.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-3xl bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-4 text-white">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <RotateCcw size={22} /> Mutasi Stok
          </div>
          <p className="mt-0.5 text-sm text-white/80">
            Riwayat stok masuk, keluar, retur, dan penyesuaian. Halaman ini hanya membaca.
          </p>
        </div>
        <Button
          onClick={exportCsv}
          variant="onBrand"
          disabled={filtered.length === 0}
        >
          <Download size={16} /> Export CSV
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Total Mutasi</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(filtered.length)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-ink-500">
            <ArrowUpRight size={13} /> Stok Masuk
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            +{formatNumber(summary.masuk)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-ink-500">
            <ArrowDownLeft size={13} /> Stok Keluar
          </div>
          <div className="mt-1 text-2xl font-bold text-rose-600">
            {formatNumber(summary.keluar)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Netto</div>
          <div
            className={cn(
              'mt-1 text-2xl font-bold',
              summary.net > 0 ? 'text-emerald-600' : summary.net < 0 ? 'text-rose-600' : '',
            )}
          >
            {summary.net > 0 ? '+' : ''}
            {formatNumber(summary.net)}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 px-2 py-1.5 dark:border-ink-700">
            <Search size={15} className="text-ink-400" />
            <input
              className="w-56 bg-transparent text-sm focus:outline-none"
              placeholder="Cari produk / SKU / barcode / alasan"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-xl border border-ink-200 bg-white px-2 text-sm dark:border-ink-700 dark:bg-ink-900"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | StockMovementType)}
          >
            <option value="all">Semua jenis</option>
            {(Object.keys(TYPE_LABELS) as StockMovementType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-2 py-1 dark:border-ink-700">
            <CalendarDays size={15} className="text-ink-400" />
            <input
              type="date"
              className="bg-transparent text-sm focus:outline-none"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-ink-400">—</span>
            <input
              type="date"
              className="bg-transparent text-sm focus:outline-none"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {summary.perType.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {summary.perType.map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs dark:bg-ink-800"
              >
                <span className="font-medium">
                  {TYPE_LABELS[type as StockMovementType] ?? type}
                </span>
                <span className="text-ink-500">{formatNumber(count)}</span>
              </span>
            ))}
          </div>
        )}

        {atLimit && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            Menampilkan {formatNumber(PULL_LIMIT)} mutasi terbaru saja. Riwayat lebih lama masih
            tersimpan di server tetapi tidak ditarik ke perangkat ini.
          </p>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            icon={<PackageSearch size={24} />}
            title="Tidak ada mutasi"
            description="Tidak ada pergerakan stok pada rentang tanggal dan filter ini."
          />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="pb-2">Waktu</th>
                  <th className="pb-2">Produk</th>
                  <th className="pb-2">Jenis</th>
                  <th className="pb-2 pr-6 text-right">Perubahan</th>
                  <th className="pb-2 w-1/3">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((m) => {
                  const p = m.product_id ? productById.get(m.product_id) : null;
                  const delta = Number(m.qty_delta ?? 0);
                  return (
                    <tr key={m.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-2.5 whitespace-nowrap text-xs">
                        {formatDateTime(m.created_at)}
                      </td>
                      <td className="py-2.5">
                        <div className="font-medium">{p?.name ?? '(produk terhapus)'}</div>
                        <div className="font-mono text-[10px] text-ink-500">{p?.sku ?? '—'}</div>
                      </td>
                      <td className="py-2.5">
                        <Badge>{TYPE_LABELS[m.type] ?? m.type}</Badge>
                      </td>
                      <td
                        className={cn(
                          'py-2.5 pr-6 text-right font-semibold tabular-nums whitespace-nowrap',
                          delta > 0 ? 'text-emerald-600' : 'text-rose-600',
                        )}
                      >
                        {delta > 0 ? '+' : ''}
                        {formatNumber(delta)}
                      </td>
                      <td className="py-2.5 text-xs text-ink-500">
                        <span className="line-clamp-2">{m.reason ?? '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p className="mt-2 text-center text-xs text-ink-500">
                Menampilkan 300 dari {formatNumber(filtered.length)} baris. Persempit filter, atau
                gunakan Export CSV untuk data lengkap.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
