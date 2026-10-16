import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { db } from '@/lib/db';
import { useNavigate } from '@/lib/router';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/format';
import { NADA_TAHAP, statusNota } from '@/lib/supplierTracking';
import type { Purchase, PurchaseItem, Supplier } from '@/types';

/**
 * Tracking satu supplier: seluruh nota beserta tahapnya (menunggu barang,
 * diterima, lunas), total belanja, pembayaran, sisa utang, dan barang yang
 * paling sering dibeli dari supplier ini.
 */
export function SupplierTrackingModal({
  supplier,
  onClose,
  currency,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  currency?: string;
}) {
  const navigate = useNavigate();
  const supplierId = supplier?.id ?? '';
  const purchases =
    useLiveQuery(
      () =>
        supplier
          ? db.purchases.where('store_id').equals(supplier.store_id).filter((p) => p.supplier_id === supplierId).toArray()
          : Promise.resolve([] as Purchase[]),
      [supplierId],
    ) ?? [];
  const ids = purchases.map((p) => p.id);
  const items =
    useLiveQuery(
      () => (ids.length ? db.purchase_items.where('purchase_id').anyOf(ids).toArray() : Promise.resolve([] as PurchaseItem[])),
      [ids.join(',')],
    ) ?? [];

  const ringkas = useMemo(() => {
    const berjalan = purchases.filter((p) => p.status !== 'canceled');
    const baris = [...purchases]
      .sort((a, b) => String(b.order_date ?? b.created_at).localeCompare(String(a.order_date ?? a.created_at)))
      .map((p) => ({ p, st: statusNota(p) }));
    const barang = new Map<string, number>();
    const batal = new Set(purchases.filter((p) => p.status === 'canceled').map((p) => p.id));
    for (const it of items) {
      if (batal.has(it.purchase_id)) continue;
      barang.set(it.name, (barang.get(it.name) ?? 0) + Number(it.received_qty || it.qty || 0));
    }
    return {
      nota: berjalan.length,
      total: berjalan.reduce((s, p) => s + Number(p.total), 0),
      dibayar: berjalan.reduce((s, p) => s + Number(p.paid_amount ?? 0), 0),
      sisa: baris.reduce((s, x) => s + x.st.sisa, 0),
      menunggu: baris.filter((x) => x.st.tahap === 'dipesan').length,
      baris,
      barang: [...barang.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [purchases, items]);

  if (!supplier) return null;

  return (
    <Modal open onClose={onClose} title={`Tracking ${supplier.name}`} size="xl">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ['Nota', formatNumber(ringkas.nota)],
              ['Menunggu barang', formatNumber(ringkas.menunggu)],
              ['Total belanja', formatMoney(ringkas.total, currency)],
              ['Sudah dibayar', formatMoney(ringkas.dibayar, currency)],
              ['Sisa utang', formatMoney(ringkas.sisa, currency)],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
              <div className="text-[11px] text-ink-500">{k}</div>
              <div className={cn('mt-0.5 font-bold', k === 'Sisa utang' && ringkas.sisa > 0 && 'text-amber-600')}>{v}</div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr>
                <th className="py-2">Nota</th>
                <th className="py-2">Tanggal</th>
                <th className="py-2">Perkiraan jadi</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Dibayar</th>
                <th className="py-2 text-right">Sisa</th>
                <th className="py-2 pl-4">Jatuh tempo</th>
              </tr>
            </thead>
            <tbody>
              {ringkas.baris.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-ink-500">
                    Belum ada nota dari supplier ini.
                  </td>
                </tr>
              ) : (
                ringkas.baris.map(({ p, st }) => (
                  <tr key={p.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-2 font-mono text-xs font-semibold">{p.invoice_number}</td>
                    <td className="py-2 text-xs">{p.order_date ? formatDate(p.order_date) : '-'}</td>
                    <td className={cn('py-2 text-xs', st.telatTerima > 0 && 'font-semibold text-rose-600')}>
                      {p.expected_date ? formatDate(p.expected_date) : '-'}
                      {st.telatTerima > 0 ? ` (terlambat ${st.telatTerima} hari)` : ''}
                    </td>
                    <td className="py-2">
                      <Badge tone={NADA_TAHAP[st.tahap]}>{st.label}</Badge>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(Number(p.total), currency)}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(Number(p.paid_amount ?? 0), currency)}</td>
                    <td className={cn('py-2 text-right tabular-nums', st.sisa > 0 && 'font-semibold text-amber-600')}>
                      {formatMoney(st.sisa, currency)}
                    </td>
                    <td
                      className={cn(
                        'py-2 pl-4 text-xs',
                        st.hariKeJatuhTempo !== null && st.hariKeJatuhTempo < 0 && 'font-semibold text-rose-600',
                      )}
                    >
                      {p.due_date ? formatDate(p.due_date) : '-'}
                      {st.hariKeJatuhTempo !== null && st.hariKeJatuhTempo < 0 ? ` (lewat ${-st.hariKeJatuhTempo} hari)` : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {ringkas.barang.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
              Barang yang paling sering dibeli
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ringkas.barang.map(([nama, qty]) => (
                <span key={nama} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs dark:bg-ink-800">
                  {nama} <strong>{formatNumber(qty)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
          <Button onClick={() => navigate('/purchases')}>Buka Pembelian Supplier</Button>
        </div>
      </div>
    </Modal>
  );
}
