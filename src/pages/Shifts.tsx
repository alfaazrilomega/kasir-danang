import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Calculator,
  Calendar,
  ClipboardList,
  Clock,
  CreditCard,
  DoorClosed,
  DoorOpen,
  Download,
  Eye,
  History,
  Printer,
  QrCode,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullRecentOrders, pullShifts } from '@/lib/sync';
import { cn, formatDate, formatDateTime, formatMoney, uuid } from '@/lib/format';
import type { CashMovement, Order, Shift } from '@/types';
import { denomsFor, totalOf, type Counts } from '@/lib/cashCount';
import { computeBreakdown, printShiftReport } from '@/lib/shiftReport';
import { recordMovement } from '@/lib/shiftHelpers';
import {
  buildCsv,
  csvFilename,
  dateTime as csvDateTime,
  downloadCsv,
  int as csvInt,
} from '@/lib/csvFormat';

type StatusFilter = 'all' | 'active' | 'closed';

const QUICK_AMOUNTS_IDR = [50000, 100000, 200000, 500000, 1000000];

function isoDate(d: Date) {
  // Tanggal kalender LOKAL, bukan UTC. toISOString() di WIB (UTC+7) masih
  // menunjuk hari kemarin sampai pukul 07.00, sehingga rentang bawaan yang
  // berakhir "hari ini" ikut membuang transaksi yang dibuat dini hari —
  // pesanan website tengah malam sempat hilang dari antrian staf karenanya.
  const lokal = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return lokal.toISOString().slice(0, 10);
}

export function Shifts() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const currency = store?.currency;
  const [openModal, setOpenModal] = useState<'open' | 'close' | 'in' | 'out' | null>(null);
  const [detailShift, setDetailShift] = useState<Shift | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (storeId) {
      pullShifts(storeId);
      pullRecentOrders(storeId, 500);
    }
  }, [storeId]);

  // Re-render every minute to keep the duration timer fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const shifts =
    useLiveQuery(async () => {
      const list = await db.shifts.where('store_id').equals(storeId).toArray();
      list.sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1));
      return list;
    }, [storeId]) ?? [];

  const activeShift = shifts.find((s) => !s.closed_at) ?? null;

  const allMovements =
    useLiveQuery(() => db.cash_movements.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const allOrders =
    useLiveQuery(() => db.orders.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  // Movements + orders for the active shift.
  const activeMovements = useMemo(() => {
    if (!activeShift) return [];
    return allMovements
      .filter((m) => m.shift_id === activeShift.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [allMovements, activeShift]);

  const activeOrders = useMemo(() => {
    if (!activeShift) return [];
    return ordersForShift(allOrders, activeShift);
  }, [allOrders, activeShift]);

  const activeBreakdown = useMemo(() => computeBreakdown(activeOrders), [activeOrders]);

  const movementTotals = useMemo(() => {
    if (!activeShift) return { sales: 0, in: 0, out: 0, expected: 0 };
    let ins = 0, outs = 0;
    for (const m of activeMovements) {
      if (m.type === 'in') ins += Number(m.amount);
      else if (m.type === 'out') outs += Number(m.amount);
    }
    const cashSales = activeBreakdown.cash.total;
    return {
      sales: cashSales,
      in: ins,
      out: outs,
      expected: Number(activeShift.opening_cash) + cashSales + ins - outs,
    };
  }, [activeMovements, activeShift, activeBreakdown]);

  // Filtered history.
  const filteredHistory = useMemo(() => {
    const f = new Date(from + 'T00:00:00').getTime();
    const t = new Date(to + 'T23:59:59').getTime();
    return shifts.filter((s) => {
      if (statusFilter === 'active' && s.closed_at) return false;
      if (statusFilter === 'closed' && !s.closed_at) return false;
      const ts = new Date(s.opened_at).getTime();
      return ts >= f && ts <= t;
    });
  }, [shifts, statusFilter, from, to]);

  function exportHistoryCSV() {
    const headers = ['Buka', 'Tutup', 'Saldo Awal', 'Penjualan', 'Order', 'Saldo Akhir', 'Selisih', 'Status'];
    const rows = filteredHistory.map((s) => {
      const diff = (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
      return [
        csvDateTime(s.opened_at),
        csvDateTime(s.closed_at),
        csvInt(s.opening_cash),
        csvInt(s.total_sales),
        csvInt(s.total_orders),
        s.closing_cash == null ? '' : csvInt(s.closing_cash),
        s.closing_cash == null ? '' : csvInt(diff),
        s.closed_at ? 'Ditutup' : 'Aktif',
      ];
    });
    downloadCsv(csvFilename('shift', from + '_' + to), buildCsv(headers, rows));
  }

  function printReport(shift: Shift) {
    if (!store) return;
    const movements = allMovements.filter((m) => m.shift_id === shift.id);
    const orders = ordersForShift(allOrders, shift);
    printShiftReport({
      store,
      shift,
      movements,
      orders,
      cashierName: profile?.full_name ?? null,
    });
  }

  const durationLabel = activeShift ? formatDuration(now - new Date(activeShift.opened_at).getTime()) : null;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Shift &amp; Kas</h1>
          {activeShift ? (
            <div className="text-sm opacity-80 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
              <span className="inline-flex items-center gap-1">
                <Clock size={12} /> Berjalan {durationLabel}
              </span>
              <span>·</span>
              <span>Dibuka {formatDateTime(activeShift.opened_at)}</span>
              {profile?.full_name && (
                <>
                  <span>·</span>
                  <span>Kasir {profile.full_name}</span>
                </>
              )}
            </div>
          ) : (
            <p className="opacity-80 text-sm">Belum ada shift aktif.</p>
          )}
        </div>
        {!activeShift ? (
          <Button onClick={() => setOpenModal('open')} variant="onBrand">
            <DoorOpen size={16} /> Buka Shift
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setOpenModal('in')} variant="onBrand">
              <ArrowDownToLine size={16} /> Kas Masuk
            </Button>
            <Button onClick={() => setOpenModal('out')} variant="onBrand">
              <ArrowUpFromLine size={16} /> Kas Keluar
            </Button>
            <Button onClick={() => printReport(activeShift)} variant="onBrand">
              <Printer size={16} /> X-Report
            </Button>
            <Button onClick={() => setOpenModal('close')} className="bg-rose-600 hover:bg-rose-700">
              <DoorClosed size={16} /> Tutup Shift
            </Button>
          </div>
        )}
      </div>

      {activeShift && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Saldo awal" value={formatMoney(activeShift.opening_cash, currency)} icon={<Wallet size={16} />} />
            <Stat label="Penjualan cash" value={formatMoney(movementTotals.sales, currency)} icon={<ClipboardList size={16} />} />
            <Stat
              label="Kas masuk − keluar"
              value={formatMoney(movementTotals.in - movementTotals.out, currency)}
              icon={<ArrowDownToLine size={16} />}
            />
            <Stat
              label="Estimasi saldo akhir"
              value={formatMoney(movementTotals.expected, currency)}
              icon={<Wallet size={16} />}
              highlight
            />
          </div>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Penjualan per Metode Pembayaran</h3>
              <span className="text-xs text-ink-500">{activeOrders.length} order shift ini</span>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <PayTile icon={Banknote} label="Cash" data={activeBreakdown.cash} currency={currency} />
              <PayTile icon={QrCode} label="QRIS" data={activeBreakdown.qris} currency={currency} />
              <PayTile icon={Smartphone} label="E-wallet" data={activeBreakdown.ewallet} currency={currency} />
              <PayTile icon={CreditCard} label="Card" data={activeBreakdown.card} currency={currency} />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold mb-3">Pergerakan Kas Shift Ini</h3>
            {activeMovements.length === 0 ? (
              <p className="text-sm text-ink-500">Belum ada pergerakan.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-500 text-xs">
                    <tr>
                      <th className="py-2">Waktu</th>
                      <th className="py-2">Tipe</th>
                      <th className="py-2 text-right">Jumlah</th>
                      <th className="py-2">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMovements.map((m) => (
                      <tr key={m.id} className="border-t border-ink-100 dark:border-ink-800">
                        <td className="py-2">{formatDateTime(m.created_at)}</td>
                        <td className="py-2"><MovementBadge type={m.type} /></td>
                        <td className={`py-2 text-right font-semibold ${signClass(m.type)}`}>
                          {sign(m.type)}{formatMoney(Math.abs(Number(m.amount)), currency)}
                        </td>
                        <td className="py-2 text-ink-500">{m.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 dark:border-ink-700 px-2 py-1 text-sm">
            <Calendar size={14} className="text-ink-500" />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent focus:outline-none" />
            <span className="text-ink-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-transparent focus:outline-none" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-500">Status:</span>
            <div className="flex gap-1 rounded-full bg-ink-100 dark:bg-ink-800 p-1 text-xs font-semibold">
              {(['all', 'active', 'closed'] as StatusFilter[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setStatusFilter(v)}
                  className={cn(
                    'rounded-full px-2.5 py-1',
                    statusFilter === v ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
                  )}
                >
                  {v === 'all' ? 'Semua' : v === 'active' ? 'Aktif' : 'Tutup'}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={exportHistoryCSV}
              disabled={filteredHistory.length === 0}
            >
              <Download size={12} /> Export CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Riwayat Shift</h3>
          <History size={16} className="text-ink-500" />
        </div>
        {filteredHistory.length === 0 ? (
          <EmptyState
            title="Belum ada riwayat"
            description={shifts.length === 0 ? 'Buka shift untuk mulai mencatat kas.' : 'Tidak ada shift di rentang ini. Ubah filter atau tanggal.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Buka</th>
                  <th className="py-2">Tutup</th>
                  <th className="py-2 text-right">Durasi</th>
                  <th className="py-2 text-right">Saldo Awal</th>
                  <th className="py-2 text-right">Penjualan</th>
                  <th className="py-2 text-right">Saldo Akhir</th>
                  <th className="py-2 text-right">Selisih</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((s) => {
                  const diff = (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
                  const duration = s.closed_at
                    ? new Date(s.closed_at).getTime() - new Date(s.opened_at).getTime()
                    : now - new Date(s.opened_at).getTime();
                  return (
                    <tr key={s.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-2">{formatDateTime(s.opened_at)}</td>
                      <td className="py-2">{s.closed_at ? formatDateTime(s.closed_at) : '—'}</td>
                      <td className="py-2 text-right text-xs">{formatDuration(duration)}</td>
                      <td className="py-2 text-right">{formatMoney(s.opening_cash, currency)}</td>
                      <td className="py-2 text-right">{formatMoney(s.total_sales, currency)}</td>
                      <td className="py-2 text-right">{s.closing_cash != null ? formatMoney(s.closing_cash, currency) : '—'}</td>
                      <td className={`py-2 text-right font-semibold ${diff === 0 ? '' : diff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {s.closing_cash != null ? formatMoney(diff, currency) : '—'}
                      </td>
                      <td className="py-2">
                        <Badge tone={s.closed_at ? 'neutral' : 'success'}>{s.closed_at ? 'Closed' : 'Active'}</Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setDetailShift(s)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title="Detail"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => printReport(s)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title={s.closed_at ? 'Cetak Z-Report' : 'Cetak X-Report'}
                          >
                            <Printer size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ShiftModal
        mode={openModal}
        onClose={() => setOpenModal(null)}
        storeId={storeId}
        cashierId={profile?.id ?? null}
        activeShift={activeShift}
        expectedCash={movementTotals.expected}
        currency={currency}
      />

      <ShiftDetailModal
        shift={detailShift}
        onClose={() => setDetailShift(null)}
        allMovements={allMovements}
        allOrders={allOrders}
        currency={currency}
        onPrint={(s) => printReport(s)}
        now={now}
      />
    </div>
  );
}

function ordersForShift(orders: Order[], shift: Shift): Order[] {
  // Prefer the explicit shift_id link recorded by POS; fall back to time window.
  const linked = orders.filter((o) => o.shift_id === shift.id);
  if (linked.length > 0) return linked;
  const start = new Date(shift.opened_at).getTime();
  const end = shift.closed_at ? new Date(shift.closed_at).getTime() : Date.now();
  return orders.filter((o) => {
    const ts = new Date(o.created_at).getTime();
    return ts >= start && ts <= end;
  });
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

function Stat({
  label, value, icon, highlight,
}: { label: string; value: string; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <Card className={cn('p-4', highlight && 'bg-brand-50 dark:bg-brand-950/40')}>
      <div className="flex items-center gap-2 text-xs text-ink-500">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </Card>
  );
}

function PayTile({
  icon: Icon, label, data, currency,
}: { icon: typeof Banknote; label: string; data: { count: number; total: number }; currency: string | undefined }) {
  return (
    <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3">
      <div className="flex items-center gap-2 text-xs text-ink-500">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50">
          <Icon size={14} />
        </span>
        <span>{label}</span>
        <span className="ml-auto font-mono">{data.count}×</span>
      </div>
      <div className="mt-1 text-lg font-bold">{formatMoney(data.total, currency)}</div>
    </div>
  );
}

function MovementBadge({ type }: { type: CashMovement['type'] }) {
  const map: Record<CashMovement['type'], { label: string; tone: 'success' | 'info' | 'danger' | 'warning' | 'neutral' }> = {
    open: { label: 'Buka', tone: 'info' },
    close: { label: 'Tutup', tone: 'neutral' },
    in: { label: 'Kas Masuk', tone: 'success' },
    out: { label: 'Kas Keluar', tone: 'warning' },
    sale: { label: 'Penjualan', tone: 'success' },
    refund: { label: 'Refund', tone: 'danger' },
  };
  const v = map[type];
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

function sign(t: CashMovement['type']) {
  return t === 'out' || t === 'refund' ? '-' : '+';
}
function signClass(t: CashMovement['type']) {
  return t === 'out' || t === 'refund' ? 'text-rose-600' : 'text-emerald-600';
}

interface ShiftModalProps {
  mode: 'open' | 'close' | 'in' | 'out' | null;
  onClose: () => void;
  storeId: string;
  cashierId: string | null;
  activeShift: Shift | null;
  expectedCash: number;
  currency: string | undefined;
}

function ShiftModal({ mode, onClose, storeId, cashierId, activeShift, expectedCash, currency }: ShiftModalProps) {
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [useCount, setUseCount] = useState(false);
  const [counts, setCounts] = useState<Counts>({});
  const denoms = denomsFor(currency);

  useEffect(() => {
    setAmount(mode === 'close' ? expectedCash : 0);
    setNote('');
    setUseCount(mode === 'close');
    setCounts({});
  }, [mode, expectedCash]);

  // When user fills the denomination counter, update amount automatically.
  useEffect(() => {
    if (useCount) setAmount(totalOf(counts, denoms));
  }, [counts, useCount, denoms]);

  if (!mode) return null;
  const title =
    mode === 'open' ? 'Buka Shift'
    : mode === 'close' ? 'Tutup Shift'
    : mode === 'in' ? 'Kas Masuk'
    : 'Kas Keluar';

  const diff = mode === 'close' ? amount - expectedCash : 0;
  const isCash = mode === 'open' || mode === 'close';

  async function submit() {
    if (amount < 0) {
      toast.error('Nominal tidak boleh negatif.');
      return;
    }
    setBusy(true);
    const api = getBackendClient();
    try {
      if (mode === 'open') {
        const shift: Shift = {
          id: uuid(),
          store_id: storeId,
          cashier_id: cashierId,
          opened_at: new Date().toISOString(),
          closed_at: null,
          opening_cash: amount,
          closing_cash: null,
          expected_cash: null,
          total_sales: 0,
          total_orders: 0,
          notes: note || null,
        };
        await db.shifts.put(shift);
        if (navigator.onLine) await api.from('shifts').insert(shift);
        await recordMovement({ storeId, shiftId: shift.id, type: 'open', amount, note });
        toast.success('Shift dibuka.');
      } else if (mode === 'close' && activeShift) {
        const d = amount - expectedCash;
        const updated: Shift = {
          ...activeShift,
          closed_at: new Date().toISOString(),
          closing_cash: amount,
          expected_cash: expectedCash,
          notes: note || activeShift.notes,
        };
        await db.shifts.put(updated);
        if (navigator.onLine) {
          await api.from('shifts').update({
            closed_at: updated.closed_at,
            closing_cash: amount,
            expected_cash: expectedCash,
            notes: updated.notes,
          }).eq('id', activeShift.id);
        }
        await recordMovement({
          storeId,
          shiftId: activeShift.id,
          type: 'close',
          amount,
          note: `Selisih ${d}${note ? ' — ' + note : ''}`,
        });
        toast.success(d === 0 ? 'Shift ditutup, kas pas.' : `Shift ditutup. Selisih ${formatMoney(d, currency)}.`);
      } else if ((mode === 'in' || mode === 'out') && activeShift) {
        if (amount <= 0) {
          toast.error('Jumlah harus lebih dari 0.');
          setBusy(false);
          return;
        }
        await recordMovement({ storeId, shiftId: activeShift.id, type: mode, amount, note });
        toast.success(mode === 'in' ? 'Kas masuk dicatat.' : 'Kas keluar dicatat.');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title} size={isCash ? 'md' : 'sm'}>
      <div className="space-y-3">
        {mode === 'close' && (
          <div className="rounded-xl bg-brand-50 dark:bg-brand-950/40 p-3 text-sm">
            Estimasi saldo akhir (sistem):{' '}
            <span className="font-bold text-brand-700 dark:text-brand-300">{formatMoney(expectedCash, currency)}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5">
            {mode === 'open'
              ? 'Saldo awal laci (uang fisik)'
              : mode === 'close'
              ? 'Saldo akhir (uang fisik di laci)'
              : 'Jumlah'}
          </label>
          <Input
            type="number"
            value={amount || ''}
            onChange={(e) => {
              setUseCount(false);
              setAmount(parseFloat(e.target.value) || 0);
            }}
            placeholder="0"
          />
          {!isCash && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_AMOUNTS_IDR.map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className="rounded-lg border border-ink-200 dark:border-ink-700 px-2.5 py-1 text-xs font-semibold hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                >
                  {formatMoney(v, currency)}
                </button>
              ))}
            </div>
          )}
        </div>

        {isCash && (
          <>
            <button
              type="button"
              onClick={() => setUseCount((v) => !v)}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border-2 px-3 py-2 text-sm font-semibold transition',
                useCount
                  ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/30'
                  : 'border-dashed border-ink-200 dark:border-ink-700 hover:border-brand-300',
              )}
            >
              <span className="flex items-center gap-2">
                <Calculator size={14} /> Hitung per denominasi
              </span>
              <span className="text-xs text-ink-500">{useCount ? 'Aktif' : 'Klik untuk hitung'}</span>
            </button>

            {useCount && (
              <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 space-y-2">
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-ink-500">Denominasi</span>
                  <span className="font-semibold uppercase tracking-wide text-ink-500 text-center w-16">Qty</span>
                  <span className="w-2" />
                  <span className="font-semibold uppercase tracking-wide text-ink-500 text-right w-28">Subtotal</span>
                </div>
                {denoms.map((d) => {
                  const q = counts[d.value] ?? 0;
                  return (
                    <div key={d.value} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                      <span className="text-sm font-mono">{d.label}</span>
                      <input
                        type="number"
                        min={0}
                        value={q || ''}
                        onChange={(e) =>
                          setCounts({ ...counts, [d.value]: parseInt(e.target.value, 10) || 0 })
                        }
                        placeholder="0"
                        className="input !w-16 !py-1 text-center"
                      />
                      <span className="text-xs text-ink-400">×</span>
                      <span className="w-28 text-right text-sm font-mono">
                        {q > 0 ? formatMoney(q * d.value, currency) : <span className="text-ink-400">—</span>}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-ink-100 dark:border-ink-800 pt-2 flex items-center justify-between text-sm font-bold">
                  <span>Total hitungan</span>
                  <span>{formatMoney(totalOf(counts, denoms), currency)}</span>
                </div>
              </div>
            )}

            {mode === 'close' && amount > 0 && (
              <div
                className={cn(
                  'rounded-xl p-3 text-sm flex items-center justify-between',
                  diff === 0
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : diff > 0
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
                )}
              >
                <span>Selisih dengan sistem</span>
                <span className="font-bold">
                  {diff === 0 ? 'Kas pas' : `${diff > 0 ? '+' : ''}${formatMoney(diff, currency)}`}
                </span>
              </div>
            )}
          </>
        )}

        <TextArea
          label="Catatan"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            mode === 'open' ? 'Opsional — siapa yang membuka, dsb.'
            : mode === 'close' ? 'Opsional — alasan selisih, dsb.'
            : 'Opsional — alasan kas masuk/keluar'
          }
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy}>Simpan</Button>
        </div>
      </div>
    </Modal>
  );
}

function ShiftDetailModal({
  shift, onClose, allMovements, allOrders, currency, onPrint, now,
}: {
  shift: Shift | null;
  onClose: () => void;
  allMovements: CashMovement[];
  allOrders: Order[];
  currency: string | undefined;
  onPrint: (s: Shift) => void;
  now: number;
}) {
  if (!shift) return null;
  const movements = allMovements
    .filter((m) => m.shift_id === shift.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const orders = ordersForShift(allOrders, shift);
  const breakdown = computeBreakdown(orders);
  const cashIn = movements.filter((m) => m.type === 'in').reduce((s, m) => s + Number(m.amount), 0);
  const cashOut = movements.filter((m) => m.type === 'out').reduce((s, m) => s + Number(m.amount), 0);
  const expected = Number(shift.opening_cash) + breakdown.cash.total + cashIn - cashOut;
  const closing = shift.closing_cash != null ? Number(shift.closing_cash) : null;
  const diff = closing != null ? closing - expected : null;
  const duration = shift.closed_at
    ? new Date(shift.closed_at).getTime() - new Date(shift.opened_at).getTime()
    : now - new Date(shift.opened_at).getTime();

  return (
    <Modal open onClose={onClose} title={`Shift · ${formatDate(shift.opened_at)}`} size="lg">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <Info label="Buka" value={formatDateTime(shift.opened_at)} />
          <Info label="Tutup" value={shift.closed_at ? formatDateTime(shift.closed_at) : '—'} />
          <Info label="Durasi" value={formatDuration(duration)} />
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
            Penjualan per metode
          </div>
          <div className="grid gap-2 sm:grid-cols-4 text-sm">
            <PayTile icon={Banknote} label="Cash" data={breakdown.cash} currency={currency} />
            <PayTile icon={QrCode} label="QRIS" data={breakdown.qris} currency={currency} />
            <PayTile icon={Smartphone} label="E-wallet" data={breakdown.ewallet} currency={currency} />
            <PayTile icon={CreditCard} label="Card" data={breakdown.card} currency={currency} />
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
            Ringkasan kas
          </div>
          <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 text-sm space-y-1">
            <Row label="Saldo awal" value={formatMoney(Number(shift.opening_cash), currency)} />
            <Row label="Penjualan cash" value={`+${formatMoney(breakdown.cash.total, currency)}`} />
            {cashIn > 0 && <Row label="Kas masuk" value={`+${formatMoney(cashIn, currency)}`} />}
            {cashOut > 0 && <Row label="Kas keluar" value={`-${formatMoney(cashOut, currency)}`} />}
            <Row label="Estimasi saldo akhir" value={formatMoney(expected, currency)} bold />
            {closing != null && <Row label="Saldo fisik" value={formatMoney(closing, currency)} bold />}
            {diff != null && (
              <Row
                label="Selisih"
                value={`${diff > 0 ? '+' : ''}${formatMoney(diff, currency)}`}
                bold
                tone={diff === 0 ? undefined : diff > 0 ? 'success' : 'danger'}
              />
            )}
          </div>
        </div>

        {movements.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
              Pergerakan ({movements.length})
            </div>
            <div className="max-h-56 overflow-y-auto scrollbar-thin rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full text-sm">
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t first:border-t-0 border-ink-100 dark:border-ink-800">
                      <td className="py-2 px-3 text-xs text-ink-500 w-32">{formatDateTime(m.created_at)}</td>
                      <td className="py-2 px-2"><MovementBadge type={m.type} /></td>
                      <td className={`py-2 px-2 text-right font-semibold ${signClass(m.type)}`}>
                        {sign(m.type)}{formatMoney(Math.abs(Number(m.amount)), currency)}
                      </td>
                      <td className="py-2 px-3 text-ink-500 text-xs">{m.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {shift.notes && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1">Catatan</div>
            <p className="text-sm text-ink-700 dark:text-ink-200">{shift.notes}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-ink-100 dark:border-ink-800">
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
          <Button onClick={() => onPrint(shift)}>
            <Printer size={14} /> Cetak {shift.closed_at ? 'Z-Report' : 'X-Report'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function Row({
  label, value, bold, tone,
}: { label: string; value: string; bold?: boolean; tone?: 'success' | 'danger' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span
        className={cn(
          bold && 'font-bold',
          tone === 'success' && 'text-emerald-600',
          tone === 'danger' && 'text-rose-600',
        )}
      >
        {value}
      </span>
    </div>
  );
}

