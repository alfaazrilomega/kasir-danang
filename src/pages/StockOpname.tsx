// Stock Opname: perhitungan stok fisik dengan selisih dan posting.
//
// Menu ini sebelumnya hanya menampilkan 10 produk berstok menipis lalu
// mengarahkan ke halaman Produk — tidak ada lembar hitung, tidak ada selisih,
// dan tidak ada penyesuaian stok.
//
// Alur sekarang: buat sesi (stok sistem dibekukan) -> isi hasil hitung fisik ->
// posting. Posting dijalankan fungsi database post_stock_opname() supaya
// atomik: selisih ditulis ke stock_movements 'adjust' dan products.stock_qty
// disamakan dengan hasil hitung.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ClipboardCheck,
  Download,
  Loader2,
  PackageSearch,
  Play,
  Save,
  Search,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullInventoryReference, pullStockOpnames, postStockOpname } from '@/lib/sync';
import { cn, formatNumber, isUuid, uuid, errorMessage } from '@/lib/format';
import type { StockOpname, StockOpnameItem } from '@/types';

export function StockOpnamePage() {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    pullInventoryReference(storeId);
    pullStockOpnames(storeId);
  }, [storeId]);

  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const opnames =
    useLiveQuery(() => db.stock_opnames.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const items: StockOpnameItem[] =
    useLiveQuery(
      () =>
        activeId
          ? db.stock_opname_items.where('opname_id').equals(activeId).toArray()
          : Promise.resolve<StockOpnameItem[]>([]),
      [activeId],
    ) ?? [];

  const sorted = useMemo(
    () => [...opnames].sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [opnames],
  );
  const active = useMemo(
    () => sorted.find((o) => o.id === activeId) ?? null,
    [sorted, activeId],
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Pilih sesi draft terbaru otomatis supaya petugas langsung bisa lanjut.
  useEffect(() => {
    if (activeId || !sorted.length) return;
    setActiveId((sorted.find((o) => o.status === 'draft') ?? sorted[0]).id);
  }, [sorted, activeId]);

  useEffect(() => {
    setCounts(
      Object.fromEntries(
        items.map((i) => [i.product_id, i.counted_qty == null ? '' : String(i.counted_qty)]),
      ),
    );
    // Hanya saat sesi berganti; kalau ikut `items`, ketikan tertimpa tiap sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .map((i) => {
        const p = productById.get(i.product_id);
        const raw = counts[i.product_id];
        const counted = raw === '' || raw === undefined ? null : Number(raw);
        const variance = counted == null ? null : counted - Number(i.system_qty);
        return { item: i, product: p, counted, variance };
      })
      .filter((r) => (r.product ? true : false))
      .filter((r) =>
        !term
          ? true
          : r.product!.name.toLowerCase().includes(term) ||
            (r.product!.sku ?? '').toLowerCase().includes(term) ||
            (r.product!.barcode ?? '').toLowerCase().includes(term),
      )
      .filter((r) => (onlyDiff ? r.variance != null && r.variance !== 0 : true))
      .sort((a, b) => (a.product!.name || '').localeCompare(b.product!.name || ''));
  }, [items, productById, counts, q, onlyDiff]);

  const summary = useMemo(() => {
    let counted = 0;
    let plus = 0;
    let minus = 0;
    for (const i of items) {
      const raw = counts[i.product_id];
      if (raw === '' || raw === undefined) continue;
      counted += 1;
      const v = Number(raw) - Number(i.system_qty);
      if (v > 0) plus += v;
      if (v < 0) minus += v;
    }
    return { total: items.length, counted, plus, minus };
  }, [items, counts]);

  async function createSession() {
    if (!storeId) return;
    const tracked = products.filter((p) => p.track_stock);
    if (!tracked.length) {
      toast.error('Tidak ada produk dengan pelacakan stok aktif.');
      return;
    }
    setBusy(true);
    try {
      const api = getBackendClient();
      const opname: StockOpname = {
        id: uuid(),
        store_id: storeId,
        status: 'draft',
        note: null,
        counted_by: isUuid(profile?.id) ? profile!.id : null,
        started_at: new Date().toISOString(),
        posted_at: null,
        created_at: new Date().toISOString(),
      };
      const opnameItems: StockOpnameItem[] = tracked.map((p) => ({
        id: uuid(),
        opname_id: opname.id,
        product_id: p.id,
        system_qty: Number(p.stock_qty ?? 0),
        counted_qty: null,
        note: null,
      }));

      let serverItemCount = opnameItems.length;
      let serverReason = '';
      if (navigator.onLine) {
        // Header sesi wajib berhasil; tanpa itu tidak ada induk untuk itemnya.
        const { error } = await api.from('stock_opnames').insert(opname);
        if (error) throw error;

        // Item SENGAJA tidak dilempar. Aplikasi ini offline-first: lembar hitung
        // tetap berguna walau servernya menolak (mis. produk baru ada di
        // IndexedDB dan belum pernah tersimpan ke Postgres). Yang penting
        // pengguna diberi tahu apa adanya, bukan dibiarkan mengira semuanya beres.
        const { error: itemErr } = await api.from('stock_opname_items').insert(opnameItems);
        if (itemErr) serverReason = itemErr.message;

        const { data: saved } = await api
          .from('stock_opname_items')
          .select('id')
          .eq('opname_id', opname.id);
        serverItemCount = Array.isArray(saved) ? saved.length : 0;
      }

      await db.stock_opnames.put(opname);
      await db.stock_opname_items.bulkPut(opnameItems);
      setActiveId(opname.id);

      if (navigator.onLine && serverItemCount < opnameItems.length) {
        toast.warning(
          `Sesi dibuat, tapi hanya ${serverItemCount} dari ${opnameItems.length} produk ` +
            `tersimpan di server. Produk yang belum tersinkron tidak akan ikut ` +
            `disesuaikan saat posting.` +
            (serverReason ? ` Penyebab: ${serverReason}` : ''),
          { duration: 12000 },
        );
      } else {
        toast.success(`Sesi opname dibuat untuk ${tracked.length} produk.`);
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal membuat sesi opname.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!active) return;
    setBusy(true);
    try {
      const api = getBackendClient();
      const updated: StockOpnameItem[] = items.map((i) => {
        const raw = counts[i.product_id];
        return {
          ...i,
          counted_qty: raw === '' || raw === undefined ? null : Number(raw),
        };
      });
      if (navigator.onLine) {
        const { error } = await api.from('stock_opname_items').upsert(updated);
        if (error) throw error;
      }
      await db.stock_opname_items.bulkPut(updated);
      toast.success('Hasil hitung disimpan.');
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyimpan.'));
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!active) return;
    if (summary.counted === 0) {
      toast.error('Belum ada produk yang dihitung.');
      return;
    }
    const belum = summary.total - summary.counted;
    const pesan =
      `Posting opname ini?\n\n` +
      `Dihitung : ${summary.counted} dari ${summary.total} produk\n` +
      `Selisih  : +${formatNumber(summary.plus)} / ${formatNumber(summary.minus)}\n\n` +
      (belum > 0 ? `${belum} produk belum dihitung dan stoknya TIDAK diubah.\n\n` : '') +
      `Stok produk akan disamakan dengan hasil hitung dan tidak bisa dibatalkan.`;
    if (!confirm(pesan)) return;

    setBusy(true);
    try {
      await saveDraftSilent();
      const { error } = await postStockOpname(active.id, storeId);
      if (error) throw new Error(error.message);
      toast.success('Opname diposting. Stok sudah disesuaikan.');
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal memposting opname.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraftSilent() {
    const api = getBackendClient();
    const updated: StockOpnameItem[] = items.map((i) => {
      const raw = counts[i.product_id];
      return { ...i, counted_qty: raw === '' || raw === undefined ? null : Number(raw) };
    });
    if (navigator.onLine) {
      const { error } = await api.from('stock_opname_items').upsert(updated);
      if (error) throw error;
    }
    await db.stock_opname_items.bulkPut(updated);
  }

  const locked = active?.status !== 'draft';

  /**
   * Unduh lembar opname yang sedang dilihat.
   *
   * Mengikuti baris yang tampil di layar, termasuk hasil pencarian dan filter
   * "hanya selisih" — supaya yang diunduh sama persis dengan yang dilihat.
   */
  async function exportSesi() {
    if (!active) {
      toast.error('Belum ada sesi opname yang dibuka.');
      return;
    }
    if (!rows.length) {
      toast.error('Tidak ada baris untuk diekspor.');
      return;
    }
    const { buildCsv, csvFilename, dateTime, downloadCsv, int, text } = await import('@/lib/csvFormat');
    const headers = [
      'SKU', 'Barcode', 'Nama Produk', 'Stok Sistem', 'Hitung Fisik', 'Selisih', 'Catatan',
      'Sesi Dimulai', 'Status Sesi',
    ];
    const statusLabel =
      active.status === 'posted' ? 'Diposting' : active.status === 'draft' ? 'Draf' : 'Dibatalkan';
    const data = rows.map((r) => [
      text(r.product?.sku),
      text(r.product?.barcode),
      text(r.product?.name),
      int(r.item.system_qty),
      // Belum dihitung dibedakan dari dihitung nol: yang satu kosong, yang lain 0.
      r.counted == null ? '' : int(r.counted),
      r.variance == null ? '' : int(r.variance),
      text(r.item.note),
      dateTime(active.started_at),
      statusLabel,
    ]);
    downloadCsv(csvFilename('stock-opname'), buildCsv(headers, data));
    toast.success(`${data.length} baris opname diekspor.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-3xl bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-4 text-white">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <ClipboardCheck size={22} /> Stock Opname
          </div>
          <p className="mt-0.5 text-sm text-white/80">
            Hitung stok fisik, bandingkan dengan sistem, lalu posting selisihnya.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportSesi()} disabled={!active} variant="onBrandSoft">
            <Download size={16} /> Export CSV
          </Button>
          <Button onClick={createSession} disabled={busy} variant="onBrand">
            <Play size={16} /> Mulai Sesi Baru
          </Button>
        </div>
      </div>

      {sorted.length > 0 && (
        <Card className="p-3">
          <div className="flex flex-wrap gap-1.5">
            {sorted.slice(0, 8).map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveId(o.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition',
                  o.id === activeId
                    ? 'bg-brand-600 text-white'
                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300',
                )}
              >
                {new Date(o.started_at).toLocaleString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {o.status !== 'draft' && ` · ${o.status === 'posted' ? 'diposting' : 'batal'}`}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!active ? (
        <Card className="p-4">
          <EmptyState
            icon={<PackageSearch size={24} />}
            title="Belum ada sesi opname"
            description="Mulai sesi baru untuk membekukan stok sistem, lalu isi hasil hitung fisik."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-ink-500">Produk</div>
              <div className="mt-1 text-2xl font-bold">{summary.total}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-ink-500">Sudah Dihitung</div>
              <div className="mt-1 text-2xl font-bold text-brand-600">{summary.counted}</div>
              <div className="text-xs text-ink-500">{summary.total - summary.counted} belum</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-ink-500">Selisih Lebih</div>
              <div className="mt-1 text-2xl font-bold text-emerald-600">
                +{formatNumber(summary.plus)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-ink-500">Selisih Kurang</div>
              <div className="mt-1 text-2xl font-bold text-rose-600">
                {formatNumber(summary.minus)}
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-ink-200 px-2 py-1.5 dark:border-ink-700">
                  <Search size={15} className="text-ink-400" />
                  <input
                    className="w-56 bg-transparent text-sm focus:outline-none"
                    placeholder="Cari nama / SKU / barcode"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300">
                  <input
                    type="checkbox"
                    checked={onlyDiff}
                    onChange={(e) => setOnlyDiff(e.target.checked)}
                  />
                  Hanya yang selisih
                </label>
              </div>
              {!locked && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={saveDraft} disabled={busy}>
                    <Save size={14} /> Simpan Draft
                  </Button>
                  <Button onClick={post} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{' '}
                    Posting
                  </Button>
                </div>
              )}
            </div>

            {locked && (
              <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                Sesi ini sudah {active.status === 'posted' ? 'diposting' : 'dibatalkan'} dan tidak
                bisa diubah lagi. Mulai sesi baru untuk opname berikutnya.
              </p>
            )}

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="pb-2">Produk</th>
                    <th className="pb-2 text-right">Stok Sistem</th>
                    <th className="pb-2 text-right">Hitung Fisik</th>
                    <th className="pb-2 text-right">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, product, counted, variance }) => (
                    <tr key={item.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-2.5">
                        <div className="font-medium">{product!.name}</div>
                        <div className="font-mono text-[10px] text-ink-500">
                          {product!.sku ?? '—'}
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatNumber(Number(item.system_qty))}
                      </td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          className="w-24 rounded-lg border border-ink-200 px-2 py-1 text-right text-sm dark:border-ink-700 dark:bg-ink-900"
                          value={counts[item.product_id] ?? ''}
                          disabled={locked}
                          placeholder="—"
                          onChange={(e) =>
                            setCounts((c) => ({ ...c, [item.product_id]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        {variance == null ? (
                          <span className="text-ink-400">—</span>
                        ) : variance === 0 ? (
                          <Badge>cocok</Badge>
                        ) : (
                          <span
                            className={cn(
                              'font-semibold tabular-nums',
                              variance > 0 ? 'text-emerald-600' : 'text-rose-600',
                            )}
                          >
                            {variance > 0 ? '+' : ''}
                            {formatNumber(variance)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="py-8 text-center text-sm text-ink-500">
                  Tidak ada produk yang cocok dengan filter.
                </p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
