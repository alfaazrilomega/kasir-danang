import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CalendarClock, PackageSearch, Truck, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { useNavigate } from '@/lib/router';
import { pullPurchases, pullSuppliers } from '@/lib/sync';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { NADA_TAHAP, statusNota } from '@/lib/supplierTracking';

/**
 * Tracking supplier di Dashboard: barang yang masih ditunggu, yang terlambat
 * datang, dan utang yang mendekati atau lewat jatuh tempo, diurutkan dari yang
 * paling mendesak.
 */
export function SupplierTrackingCard() {
  const navigate = useNavigate();
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';

  useEffect(() => {
    if (!storeId) return;
    void pullSuppliers(storeId);
    void pullPurchases(storeId);
  }, [storeId]);

  const purchases =
    useLiveQuery(() => db.purchases.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const suppliers =
    useLiveQuery(() => db.suppliers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const namaSupplier = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const data = useMemo(() => {
    const aktif = purchases
      .map((p) => ({ p, st: statusNota(p) }))
      .filter((x) => x.st.tahap === 'dipesan' || x.st.tahap === 'diterima');
    const menunggu = aktif.filter((x) => x.st.tahap === 'dipesan');
    const terlambat = menunggu.filter((x) => x.st.telatTerima > 0);
    const tempo = aktif.filter((x) => x.st.hariKeJatuhTempo !== null && x.st.hariKeJatuhTempo <= 7);
    const utang = purchases.reduce((sum, p) => sum + statusNota(p).sisa, 0);
    // Paling mendesak dulu: lewat jatuh tempo, terlambat datang, lalu yang terdekat.
    const skor = (x: (typeof aktif)[number]) => {
      const tempoSkor = x.st.hariKeJatuhTempo === null ? 999 : x.st.hariKeJatuhTempo;
      return Math.min(tempoSkor, x.st.telatTerima > 0 ? -x.st.telatTerima : 500);
    };
    const urut = [...aktif].sort((a, b) => skor(a) - skor(b));
    return { menunggu, terlambat, tempo, utang, urut };
  }, [purchases]);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Truck size={16} className="text-brand-600" /> Tracking Supplier
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">Barang yang ditunggu dan utang supplier yang perlu dipantau.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/suppliers')}
          className="text-xs font-semibold text-brand-600 hover:underline"
        >
          Lihat per supplier
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Ringkas icon={PackageSearch} label="Menunggu barang" value={formatNumber(data.menunggu.length)} />
        <Ringkas
          icon={AlertTriangle}
          label="Terlambat datang"
          value={formatNumber(data.terlambat.length)}
          tone={data.terlambat.length ? 'text-rose-600' : undefined}
        />
        <Ringkas
          icon={CalendarClock}
          label="Jatuh tempo ≤ 7 hari"
          value={formatNumber(data.tempo.length)}
          tone={data.tempo.length ? 'text-amber-600' : undefined}
        />
        <Ringkas icon={Wallet} label="Sisa utang" value={formatMoney(data.utang, store?.currency)} />
      </div>

      <div className="mt-4 space-y-2">
        {data.urut.length === 0 ? (
          <p className="rounded-xl bg-ink-50 p-4 text-center text-sm text-ink-500 dark:bg-ink-800/50">
            Tidak ada nota supplier yang sedang berjalan.
          </p>
        ) : (
          data.urut.slice(0, 6).map(({ p, st }) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate('/purchases')}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-ink-800 dark:hover:bg-brand-950/30"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {namaSupplier.get(p.supplier_id ?? '') ?? 'Tanpa supplier'}
                  <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-500">{p.invoice_number}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-ink-500">
                  {st.tahap === 'dipesan' && p.expected_date && (
                    <span className={st.telatTerima > 0 ? 'font-semibold text-rose-600' : ''}>
                      Perkiraan jadi {formatDate(p.expected_date)}
                      {st.telatTerima > 0 ? ` · terlambat ${st.telatTerima} hari` : ''}
                    </span>
                  )}
                  {st.hariKeJatuhTempo !== null && p.due_date && (
                    <span
                      className={
                        st.hariKeJatuhTempo < 0
                          ? 'font-semibold text-rose-600'
                          : st.hariKeJatuhTempo <= 7
                            ? 'font-semibold text-amber-600'
                            : ''
                      }
                    >
                      Jatuh tempo {formatDate(p.due_date)}
                      {st.hariKeJatuhTempo < 0
                        ? ` · lewat ${-st.hariKeJatuhTempo} hari`
                        : ` · ${st.hariKeJatuhTempo} hari lagi`}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {st.sisa > 0 && (
                  <span className="text-xs font-semibold text-amber-600">{formatMoney(st.sisa, store?.currency)}</span>
                )}
                <Badge tone={NADA_TAHAP[st.tahap]}>{st.label}</Badge>
              </div>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

function Ringkas({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Truck;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <Icon size={13} /> {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}
