import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from '@/lib/router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Calendar,
  ClipboardList,
  DollarSign,
  Download,
  Percent,
  Receipt,
  TrendingUp,
  UserCog,
  Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/dashboard/StatCard';
import { db } from '@/lib/db';
import { expenseCategoryLabel } from '@/lib/expenseCategories';
import { useAuth } from '@/stores/auth';
import { pullOrderReturns, pullExpenses, pullRecentOrders, pullShifts } from '@/lib/sync';
import { getBackendClient, type AdminUser } from '@/lib/api';
import { hasCapability, normalizeRole, roleLabel } from '@/lib/roles';
import { channelLabel } from '@/lib/channels';
import { countsAsSale } from '@/lib/orderStatus';
import { formatDate, formatDateTime, formatMoney, formatNumber, cn } from '@/lib/format';
import {
  buildCsv,
  csvFilename,
  date as csvDate,
  dateTime as csvDateTime,
  downloadCsv,
  int as csvInt,
  num as csvNum,
  text as csvText,
} from '@/lib/csvFormat';
import type { Order, OrderItem, PaymentMethod, Product, Shift } from '@/types';

type Tab = 'daily' | 'shift' | 'cashier' | 'channel' | 'pnl' | 'best';
type Preset = 'today' | '7d' | '30d' | 'this-month' | 'last-month' | 'custom';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  card: 'Kartu',
  transfer: 'Transfer',
  ewallet: 'E-wallet',
  qris: 'QRIS',
  other: 'Lainnya',
};
const PAYMENT_COLORS: Record<PaymentMethod, string> = {
  cash: '#10b981',
  card: '#0ea5e9',
  transfer: '#ec4899',
  ewallet: '#f59e0b',
  qris: '#7c4dff',
  other: '#94a3b8',
};

const TABS = ['daily', 'shift', 'cashier', 'channel', 'pnl', 'best'] as const;
const TAB_LABELS: Record<Tab, string> = {
  daily: 'Harian',
  shift: 'Per Shift',
  cashier: 'Per Kasir',
  channel: 'Channel & Piutang',
  pnl: 'Laba Rugi',
  best: 'Best Sellers',
};

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Hari Ini' },
  { id: '7d', label: '7 Hari' },
  { id: '30d', label: '30 Hari' },
  { id: 'this-month', label: 'Bulan Ini' },
  { id: 'last-month', label: 'Bulan Lalu' },
];

export function Reports() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  // Hanya admin/manager yang boleh melihat rekap per kasir (butuh daftar user).
  const canSeeCashierReport = hasCapability(profile?.role, 'manageUsers');
  const { search } = useLocation();
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(window.location.search));
  const [preset, setPreset] = useState<Preset>('7d');
  const [from, setFrom] = useState(() => presetRange('7d')!.from);
  const [to, setTo] = useState(() => presetRange('7d')!.to);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [detailCashier, setDetailCashier] = useState<string | null>(null);

  useEffect(() => {
    if (storeId) {
      pullRecentOrders(storeId, 500);
      pullShifts(storeId);
      pullExpenses(storeId);
      pullOrderReturns(storeId);
    }
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !canSeeCashierReport) return;
    let alive = true;
    getBackendClient()
      .admin.listUsers()
      .then(({ data }) => {
        if (alive) setUsers(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, [storeId, canSeeCashierReport]);

  const orders =
    useLiveQuery(() => db.orders.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  /**
   * Saring seluruh laporan ke satu channel saja.
   *
   * Client menjelaskan lewat contoh nyata: laporan Harian tanggal 1-30 hanya
   * menampilkan total gabungan semua channel per hari, sementara yang mereka
   * butuhkan untuk rapat adalah bisa melihat "tanggal 1-30 khusus TikTok Shop"
   * — bukan cuma total per channel untuk seluruh rentang tanggal (yang sudah
   * ada di tab Channel & Piutang). Saringan ini bukan cuma untuk tab Harian:
   * dipasang di sumber datanya (`cur`/`prev`/`canceledInRange`) supaya SEMUA
   * tab — Harian, Per Shift, Per Kasir, Laba Rugi, Best Sellers — ikut
   * memperlihatkan angka channel itu saja, konsisten satu sama lain.
   */
  const [channelFilter, setChannelFilter] = useState('all');
  const channelRows =
    useLiveQuery(() => db.sales_channels.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const scopedOrders = useMemo(
    () =>
      channelFilter === 'all'
        ? orders
        : orders.filter((o) => (o.sales_channel ?? 'offline') === channelFilter),
    [orders, channelFilter],
  );
  // Daftar pilihan dropdown diambil dari channel yang benar-benar dipakai di
  // seluruh riwayat pesanan, bukan dari master channel — channel yang sudah
  // dihapus tapi masih punya pesanan lama tetap harus bisa disaring.
  const channelCodesInData = useMemo(
    () => [...new Set(orders.map((o) => o.sales_channel ?? 'offline'))].sort(),
    [orders],
  );
  const items = useLiveQuery(() => db.order_items.toArray(), []) ?? [];
  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const shifts =
    useLiveQuery(() => db.shifts.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const expenses =
    useLiveQuery(() => db.expenses.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const ranges = useMemo(() => {
    const fStart = new Date(from + 'T00:00:00').getTime();
    const tEnd = new Date(to + 'T23:59:59').getTime();
    const span = tEnd - fStart;
    const prevEnd = fStart - 1;
    const prevStart = prevEnd - span;
    return { fStart, tEnd, prevStart, prevEnd };
  }, [from, to]);

  const orderReturns = useLiveQuery(() => db.order_returns.toArray(), []) ?? [];

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const cur = useMemo(
    () =>
      scopedOrders.filter((o) => {
        const ts = new Date(o.created_at).getTime();
        return ts >= ranges.fStart && ts <= ranges.tEnd && countsAsSale(o);
      }),
    [scopedOrders, ranges],
  );
  const prev = useMemo(
    () =>
      scopedOrders.filter((o) => {
        const ts = new Date(o.created_at).getTime();
        return ts >= ranges.prevStart && ts <= ranges.prevEnd && countsAsSale(o);
      }),
    [scopedOrders, ranges],
  );

  // Retur dipetakan ke periode lewat tanggal returnya, bukan tanggal pesanan
  // aslinya: uang keluar pada saat retur dicatat.
  const sumRefunds = (start: number, end: number) =>
    orderReturns
      .filter((r) => {
        const ts = new Date(r.created_at).getTime();
        return ts >= start && ts <= end;
      })
      .reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
  const curRefunds = useMemo(
    () => sumRefunds(ranges.fStart, ranges.tEnd),
    [orderReturns, ranges],
  );
  const prevRefunds = useMemo(
    () => sumRefunds(ranges.prevStart, ranges.prevEnd),
    [orderReturns, ranges],
  );

  const curStats = useMemo(
    () => computeStats(cur, items, productById, curRefunds),
    [cur, items, productById, curRefunds],
  );

  // Pengeluaran operasional pada rentang aktif. Hanya tabel expenses yang
  // dibaca — cash_movements 'out' sengaja diabaikan supaya biaya yang dibayar
  // tunai dari laci tidak terhitung dua kali.
  const expensesInRange = useMemo(
    () => expenses.filter((e) => e.expense_date >= from && e.expense_date <= to),
    [expenses, from, to],
  );
  const expenseTotal = useMemo(
    () => expensesInRange.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [expensesInRange],
  );
  const expenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expensesInRange) {
      map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expensesInRange]);
  const netProfit = curStats.gross - expenseTotal;
  const prevStats = useMemo(
    () => computeStats(prev, items, productById, prevRefunds),
    [prev, items, productById, prevRefunds],
  );

  const trends = {
    sales: pctChange(curStats.sales, prevStats.sales),
    count: pctChange(curStats.count, prevStats.count),
    aov: pctChange(curStats.aov, prevStats.aov),
    gross: pctChange(curStats.gross, prevStats.gross),
  };

  const dailyBuckets = useMemo(() => {
    const map = new Map<
      string,
      { date: string; orders: number; sales: number; tax: number; discount: number }
    >();
    for (const o of cur) {
      const d = isoDate(new Date(o.created_at));
      const v = map.get(d) ?? { date: d, orders: 0, sales: 0, tax: 0, discount: 0 };
      v.orders += 1;
      v.sales += Number(o.total);
      v.tax += Number(o.tax);
      v.discount += Number(o.discount);
      map.set(d, v);
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [cur]);

  const chartData = useMemo(() => {
    const buckets = new Map<string, number>();
    // Pre-fill every day in range to avoid sparse bars.
    for (let t = ranges.fStart; t <= ranges.tEnd; t += 86400000) {
      buckets.set(isoDate(new Date(t)), 0);
    }
    for (const o of cur) {
      const k = isoDate(new Date(o.created_at));
      buckets.set(k, (buckets.get(k) ?? 0) + Number(o.total));
    }
    return Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, sales]) => ({
        date,
        label: formatDate(date, { day: '2-digit', month: 'short' }),
        sales,
      }));
  }, [cur, ranges]);

  const payments = useMemo(() => {
    const tally = new Map<PaymentMethod, { total: number; count: number }>();
    for (const o of cur) {
      const v = tally.get(o.payment_method) ?? { total: 0, count: 0 };
      v.total += Number(o.total);
      v.count += 1;
      tally.set(o.payment_method, v);
    }
    return Array.from(tally.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [cur]);
  const paymentsTotal = payments.reduce((s, p) => s + p.total, 0);

  const bestSellers = useMemo(() => {
    const orderIds = new Set(cur.map((o) => o.id));
    const tally = new Map<
      string,
      { name: string; sku: string | null; qty: number; revenue: number; cost: number; image: string | null }
    >();
    let totalQty = 0;
    for (const it of items as OrderItem[]) {
      if (!orderIds.has(it.order_id)) continue;
      const product = it.product_id ? productById.get(it.product_id) : null;
      const cost = Number(it.cost_price ?? product?.cost_price ?? 0);
      const key = it.product_id ?? it.name;
      const prev = tally.get(key) ?? { name: it.name, sku: product?.sku ?? null, qty: 0, revenue: 0, cost: 0, image: null };
      prev.qty += it.qty;
      prev.revenue += it.price * it.qty;
      prev.cost += cost * it.qty;
      if (product?.sku) prev.sku = product.sku;
      tally.set(key, prev);
      totalQty += it.qty;
    }
    for (const p of products) {
      const v = tally.get(p.id);
      if (v) {
        v.image = p.image_url;
        if (p.sku) v.sku = p.sku;
      }
    }
    return Array.from(tally.values())
      .map((v) => ({
        ...v,
        profit: v.revenue - v.cost,
        share: totalQty ? v.qty / totalQty : 0,
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [cur, items, products, productById]);
  const topQty = bestSellers[0]?.qty ?? 0;

  const shiftsInRange = useMemo(() => {
    return shifts
      .filter((s) => {
        const ts = new Date(s.opened_at).getTime();
        return ts >= ranges.fStart && ts <= ranges.tEnd;
      })
      .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1));
  }, [shifts, ranges]);

  const shiftTotals = useMemo(() => {
    let openingCash = 0,
      sales = 0,
      ordersN = 0,
      diff = 0,
      hasDiff = 0;
    for (const s of shiftsInRange) {
      openingCash += s.opening_cash;
      sales += s.total_sales;
      ordersN += s.total_orders;
      if (s.closing_cash != null) {
        diff += (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
        hasDiff += 1;
      }
    }
    return { openingCash, sales, orders: ordersN, diff, hasDiff };
  }, [shiftsInRange]);

  const canceledInRange = useMemo(
    () =>
      scopedOrders.filter((o) => {
        const ts = new Date(o.created_at).getTime();
        return ts >= ranges.fStart && ts <= ranges.tEnd && o.order_status === 'canceled';
      }),
    [scopedOrders, ranges],
  );

  const cashierRows = useMemo(
    () =>
      buildCashierRows({
        orders: cur,
        canceled: canceledInRange,
        items,
        productById,
        shifts: shiftsInRange,
        users,
      }),
    [cur, canceledInRange, items, productById, shiftsInRange, users],
  );
  // Rekap per channel + piutang yang belum cair pada rentang ini.
  const channelReport = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        orders: number;
        sales: number;
        adjustment: number;
        receivable: number;
        overdue: number;
        tempoOrders: number;
      }
    >();
    for (const order of cur) {
      const code = order.sales_channel ?? 'offline';
      const row = map.get(code) ?? {
        code,
        name: channelLabel(code, channelRows),
        orders: 0,
        sales: 0,
        adjustment: 0,
        receivable: 0,
        overdue: 0,
        tempoOrders: 0,
      };
      row.orders += 1;
      row.sales += Number(order.total);
      row.adjustment += Number(order.adjustment_amount ?? 0);
      if (order.payment_term === 'tempo') {
        row.tempoOrders += 1;
        const rest = Math.max(0, Number(order.total) - Number(order.paid_amount ?? 0));
        row.receivable += rest;
        if (rest > 0 && order.due_date && new Date(`${order.due_date}T23:59:59`) < new Date()) {
          row.overdue += rest;
        }
      }
      map.set(code, row);
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [cur, channelRows]);

  const channelTotals = useMemo(
    () =>
      channelReport.reduce(
        (acc, row) => ({
          sales: acc.sales + row.sales,
          receivable: acc.receivable + row.receivable,
          overdue: acc.overdue + row.overdue,
          adjustment: acc.adjustment + row.adjustment,
        }),
        { sales: 0, receivable: 0, overdue: 0, adjustment: 0 },
      ),
    [channelReport],
  );

  const cashierTotals = useMemo(
    () =>
      cashierRows.reduce(
        (acc, row) => ({
          sales: acc.sales + row.sales,
          orders: acc.orders + row.orders,
          gross: acc.gross + row.gross,
          variance: acc.variance + row.variance,
          active: acc.active + (row.orders > 0 ? 1 : 0),
        }),
        { sales: 0, orders: 0, gross: 0, variance: 0, active: 0 },
      ),
    [cashierRows],
  );
  const topCashierSales = cashierRows[0]?.sales ?? 0;
  const detailRow = cashierRows.find((row) => row.id === detailCashier) ?? null;
  const detailOrders = useMemo(() => {
    if (!detailRow) return [];
    return cur
      .filter((o) => (o.cashier_id ?? UNASSIGNED) === detailRow.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 8);
  }, [cur, detailRow]);
  const detailShifts = useMemo(() => {
    if (!detailRow) return [];
    return shiftsInRange.filter((s) => (s.cashier_id ?? UNASSIGNED) === detailRow.id);
  }, [shiftsInRange, detailRow]);

  // Deep link `/reports?tab=cashier` dari dashboard admin.
  useEffect(() => {
    setTab(tabFromSearch(search));
  }, [search]);

  // Tab kasir hanya untuk admin — jangan tinggalkan tab aktif yang tidak terlihat.
  useEffect(() => {
    if (tab === 'cashier' && !canSeeCashierReport) setTab('daily');
  }, [tab, canSeeCashierReport]);

  function applyPreset(p: Preset) {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function handleDateChange(which: 'from' | 'to', value: string) {
    setPreset('custom');
    if (which === 'from') setFrom(value);
    else setTo(value);
  }

  function exportCSV() {
    // Semua ekspor CSV memakai format bersama (pemisah ";", angka & tanggal
    // lokal) supaya berkasnya langsung rapi saat dibuka di Excel.
    let headers: string[] = [];
    const rows: unknown[][] = [];
    if (tab === 'daily') {
      headers = ['Tanggal', 'Pesanan', 'Penjualan', 'Pajak', 'Diskon'];
      for (const d of dailyBuckets) {
        rows.push([csvDate(d.date), csvInt(d.orders), csvInt(d.sales), csvInt(d.tax), csvInt(d.discount)]);
      }
    } else if (tab === 'best') {
      headers = ['SKU', 'Produk', 'Qty', 'Pendapatan', 'HPP', 'Laba', 'Porsi (%)'];
      for (const b of bestSellers) {
        rows.push([
          csvText(b.sku), csvText(b.name), csvInt(b.qty), csvInt(b.revenue),
          csvInt(b.cost), csvInt(b.profit), csvNum(b.share * 100, 1),
        ]);
      }
    } else if (tab === 'cashier') {
      headers = [
        'Kasir', 'Role', 'Shift', 'Order', 'Batal', 'Penjualan', 'Rata-rata per Order',
        'Diskon', 'HPP', 'Laba Kotor', 'Margin (%)', 'Item Terjual', 'Tunai',
        'Non-Tunai', 'Selisih Kas', 'Transaksi Terakhir',
      ];
      for (const c of cashierRows) {
        const nonCash = c.byMethod.card + c.byMethod.ewallet + c.byMethod.qris;
        rows.push([
          csvText(c.name), csvText(c.role), csvInt(c.shifts), csvInt(c.orders),
          csvInt(c.canceled), csvInt(c.sales), csvInt(c.aov), csvInt(c.discount),
          csvInt(c.cogs), csvInt(c.gross), csvNum(c.margin, 1), csvInt(c.qty),
          csvInt(c.byMethod.cash), csvInt(nonCash),
          c.varianceCount ? csvInt(c.variance) : '',
          csvDateTime(c.lastOrder),
        ]);
      }
    } else if (tab === 'channel') {
      headers = ['Channel', 'Order', 'Penjualan', 'Penyesuaian', 'Order Tempo', 'Piutang', 'Lewat Tempo'];
      for (const c of channelReport) {
        rows.push([
          csvText(c.name), csvInt(c.orders), csvInt(c.sales), csvInt(c.adjustment),
          csvInt(c.tempoOrders), csvInt(c.receivable), csvInt(c.overdue),
        ]);
      }
    } else if (tab === 'pnl') {
      headers = ['Keterangan', 'Nilai'];
      rows.push(['Pendapatan (netto, tanpa ongkir)', csvInt(curStats.revenue)]);
      rows.push(['Ongkir ditagihkan (diteruskan ke kurir)', csvInt(curStats.shipping)]);
      rows.push(['Retur / refund', csvInt(curStats.refunds)]);
      rows.push(['HPP', csvInt(curStats.cogs)]);
      rows.push(['Laba kotor', csvInt(curStats.gross)]);
      rows.push(['Pengeluaran operasional', csvInt(expenseTotal)]);
      for (const [cat, amount] of expenseByCategory) {
        rows.push(['  ' + expenseCategoryLabel(cat), csvInt(amount)]);
      }
      rows.push(['Laba bersih', csvInt(netProfit)]);
      rows.push(['Margin kotor (%)', csvNum(curStats.margin, 1)]);
      rows.push([
        'Margin bersih (%)',
        csvNum(curStats.revenue ? (netProfit / curStats.revenue) * 100 : 0, 1),
      ]);
      rows.push(['Pajak terkumpul', csvInt(curStats.tax)]);
      rows.push(['Total diskon', csvInt(curStats.discount)]);
    } else {
      headers = ['Buka', 'Tutup', 'Saldo Awal', 'Penjualan', 'Saldo Akhir', 'Selisih'];
      for (const s of shiftsInRange) {
        const diff = (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
        rows.push([
          csvDateTime(s.opened_at), csvDateTime(s.closed_at), csvInt(s.opening_cash),
          csvInt(s.total_sales), s.closing_cash === null || s.closing_cash === undefined ? '' : csvInt(s.closing_cash),
          csvInt(diff),
        ]);
      }
    }
    // Nama berkas menyebut channel yang sedang disaring, supaya berkas yang
    // dibawa ke rapat jelas isinya cuma satu channel, bukan gabungan semua.
    const namaChannel =
      channelFilter === 'all'
        ? ''
        : '_' + channelLabel(channelFilter, channelRows).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(
      csvFilename('laporan-' + tab + namaChannel, from + '_' + to),
      buildCsv(headers, rows),
    );
  }

  const trendHint = 'vs periode sebelumnya';

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Laporan</h1>
            <p className="opacity-80 text-sm">Rekap penjualan, laba-rugi, dan analitik produk.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-ink-900">
            <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm">
              <Calendar size={14} />
              <input
                type="date"
                value={from}
                onChange={(e) => handleDateChange('from', e.target.value)}
                className="bg-transparent focus:outline-none"
              />
              <span className="text-ink-400">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => handleDateChange('to', e.target.value)}
                className="bg-transparent focus:outline-none"
              />
            </div>
            {/* Saring seluruh laporan ke satu channel: "tanggal 1-30 khusus
                TikTok Shop", bukan cuma total gabungan semua channel per hari. */}
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="rounded-full bg-white px-3 py-1.5 text-sm text-ink-900 focus:outline-none"
              title="Saring seluruh laporan ke satu channel"
            >
              <option value="all">Semua channel</option>
              {channelCodesInData.map((code) => (
                <option key={code} value={code}>
                  {channelLabel(code, channelRows)}
                </option>
              ))}
            </select>
            <Button onClick={exportCSV} variant="onBrand">
              <Download size={16} /> Export CSV
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition',
                preset === p.id
                  ? 'bg-white text-brand-700'
                  : 'bg-white/15 text-white hover:bg-white/25',
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Custom</span>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={DollarSign}
          label="Total Penjualan"
          value={formatMoney(curStats.sales, store?.currency)}
          trend={trends.sales}
          hint={trendHint}
        />
        <StatCard
          icon={ClipboardList}
          label="Jumlah Pesanan"
          value={formatNumber(curStats.count)}
          trend={trends.count}
          hint={trendHint}
        />
        <StatCard
          icon={Receipt}
          label="Rata-rata / Order"
          value={formatMoney(curStats.aov, store?.currency)}
          trend={trends.aov}
          hint={trendHint}
        />
        <StatCard
          icon={TrendingUp}
          label="Laba Kotor"
          value={formatMoney(curStats.gross, store?.currency)}
          trend={trends.gross}
          hint={`Margin ${curStats.margin.toFixed(1)}%`}
        />
        <StatCard
          icon={Percent}
          label="Diskon Diberikan"
          value={formatMoney(curStats.discount, store?.currency)}
          hint={
            curStats.sales
              ? `${((curStats.discount / curStats.sales) * 100).toFixed(1)}% dari penjualan`
              : 'Belum ada penjualan'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Tren Penjualan Harian</h3>
            <span className="text-xs text-ink-500">
              {formatDate(from)} → {formatDate(to)}
            </span>
          </div>
          {curStats.sales === 0 ? (
            <div className="h-64 grid place-items-center text-sm text-ink-500">
              Tidak ada penjualan pada rentang ini.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="4 4"
                    vertical={false}
                    className="stroke-ink-200 dark:stroke-ink-800"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={compact}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(90,65,229,0.08)' }}
                    contentStyle={{
                      borderRadius: 12,
                      border: 'none',
                      background: 'rgba(20,24,38,0.95)',
                      color: '#fff',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: number) => [formatMoney(value, store?.currency), 'Penjualan']}
                  />
                  <Bar dataKey="sales" fill="#5A41E5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Metode Pembayaran</h3>
            <span className="text-xs text-ink-500">{formatNumber(curStats.count)} order</span>
          </div>
          {payments.length === 0 ? (
            <p className="text-sm text-ink-500 py-8 text-center">Belum ada transaksi.</p>
          ) : (
            <>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                {payments.map((p) => (
                  <div
                    key={p.method}
                    style={{
                      width: `${paymentsTotal ? (p.total / paymentsTotal) * 100 : 0}%`,
                      background: PAYMENT_COLORS[p.method],
                    }}
                  />
                ))}
              </div>
              <ul className="mt-4 space-y-3 text-sm">
                {payments.map((p) => (
                  <li key={p.method} className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: PAYMENT_COLORS[p.method] }}
                    />
                    <span className="flex-1 font-medium">{PAYMENT_LABELS[p.method]}</span>
                    <span className="text-ink-500 text-xs">
                      {paymentsTotal ? ((p.total / paymentsTotal) * 100).toFixed(0) : 0}%
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(p.total, store?.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-1 rounded-full bg-ink-100 dark:bg-ink-800 p-1 w-fit text-sm font-semibold">
        {TABS.filter((t) => t !== 'cashier' || canSeeCashierReport).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-full px-4 py-1.5 transition',
              tab === t
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                : 'text-ink-600 hover:text-brand-700 dark:text-ink-300 dark:hover:text-brand-200',
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'daily' && (
        <Card className="p-5">
          {dailyBuckets.length === 0 ? (
            <EmptyState
              title="Tidak ada penjualan"
              description="Tidak ada transaksi pada rentang tanggal ini."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Tanggal</th>
                  <th className="py-2 text-right">Pesanan</th>
                  <th className="py-2 text-right">Penjualan</th>
                  <th className="py-2 text-right">Pajak</th>
                  <th className="py-2 text-right">Diskon</th>
                </tr>
              </thead>
              <tbody>
                {dailyBuckets.map((d) => (
                  <tr key={d.date} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-2 font-medium">{formatDate(d.date)}</td>
                    <td className="py-2 text-right">{d.orders}</td>
                    <td className="py-2 text-right">{formatMoney(d.sales, store?.currency)}</td>
                    <td className="py-2 text-right">{formatMoney(d.tax, store?.currency)}</td>
                    <td className="py-2 text-right text-rose-600">
                      {formatMoney(d.discount, store?.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink-200 dark:border-ink-700 font-semibold">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right">{curStats.count}</td>
                  <td className="py-2 text-right">{formatMoney(curStats.sales, store?.currency)}</td>
                  <td className="py-2 text-right">{formatMoney(curStats.tax, store?.currency)}</td>
                  <td className="py-2 text-right text-rose-600">
                    {formatMoney(curStats.discount, store?.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}

      {tab === 'shift' && (
        <Card className="p-5">
          {shiftsInRange.length === 0 ? (
            <EmptyState
              title="Belum ada shift"
              description="Tidak ada shift yang dibuka pada rentang ini."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Buka</th>
                  <th className="py-2">Tutup</th>
                  <th className="py-2 text-right">Saldo Awal</th>
                  <th className="py-2 text-right">Penjualan</th>
                  <th className="py-2 text-right">Order</th>
                  <th className="py-2 text-right">Selisih</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {shiftsInRange.map((s) => {
                  const diff = (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
                  return (
                    <tr key={s.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-2">{formatDate(s.opened_at)}</td>
                      <td className="py-2">{s.closed_at ? formatDate(s.closed_at) : '—'}</td>
                      <td className="py-2 text-right">
                        {formatMoney(s.opening_cash, store?.currency)}
                      </td>
                      <td className="py-2 text-right">
                        {formatMoney(s.total_sales, store?.currency)}
                      </td>
                      <td className="py-2 text-right">{s.total_orders}</td>
                      <td
                        className={`py-2 text-right font-semibold ${
                          diff === 0 ? '' : diff > 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {s.closing_cash != null ? formatMoney(diff, store?.currency) : '—'}
                      </td>
                      <td className="py-2">
                        <Badge tone={s.closed_at ? 'neutral' : 'success'}>
                          {s.closed_at ? 'Closed' : 'Active'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink-200 dark:border-ink-700 font-semibold">
                  <td className="py-2" colSpan={2}>
                    Total ({shiftsInRange.length} shift)
                  </td>
                  <td className="py-2 text-right">
                    {formatMoney(shiftTotals.openingCash, store?.currency)}
                  </td>
                  <td className="py-2 text-right">
                    {formatMoney(shiftTotals.sales, store?.currency)}
                  </td>
                  <td className="py-2 text-right">{shiftTotals.orders}</td>
                  <td
                    className={`py-2 text-right ${
                      shiftTotals.diff === 0
                        ? ''
                        : shiftTotals.diff > 0
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                    }`}
                  >
                    {shiftTotals.hasDiff ? formatMoney(shiftTotals.diff, store?.currency) : '—'}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}

      {tab === 'cashier' && canSeeCashierReport && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
                <UserCog size={19} />
              </span>
              <div>
                <h3 className="font-semibold">Laporan per Kasir</h3>
                <p className="mt-0.5 text-xs text-ink-500">
                  Performa masing-masing kasir pada {formatDate(from)} → {formatDate(to)}. Klik baris
                  untuk rincian.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="brand">{formatNumber(cashierTotals.active)} kasir aktif</Badge>
              {cashierTotals.variance !== 0 && (
                <Badge tone={cashierTotals.variance > 0 ? 'success' : 'danger'}>
                  Selisih kas {formatMoney(cashierTotals.variance, store?.currency)}
                </Badge>
              )}
            </div>
          </div>

          {cashierRows.length === 0 ? (
            <EmptyState
              title="Belum ada data kasir"
              description="Tidak ada transaksi atau shift pada rentang ini."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                  <tr>
                    <th className="rounded-l-lg px-3 py-2.5">Kasir</th>
                    <th className="px-3 py-2.5 text-right">Shift</th>
                    <th className="px-3 py-2.5 text-right">Order</th>
                    <th className="px-3 py-2.5">Kontribusi</th>
                    <th className="px-3 py-2.5 text-right">Penjualan</th>
                    <th className="px-3 py-2.5 text-right">Rata-rata</th>
                    <th className="px-3 py-2.5 text-right">Laba Kotor</th>
                    <th className="rounded-r-lg px-3 py-2.5 text-right">Selisih Kas</th>
                  </tr>
                </thead>
                <tbody>
                  {cashierRows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setDetailCashier(row.id)}
                      className="cursor-pointer border-t border-ink-100 transition-colors hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                            {initials(row.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{row.name}</span>
                            <span className="block truncate text-xs text-ink-500">
                              {row.role ?? 'Akun tidak ditemukan'}
                              {row.canceled > 0 && ` · ${row.canceled} batal`}
                            </span>
                          </span>
                          {row.openShift && <Badge tone="success">Shift aktif</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.shifts)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.orders)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{
                                width: `${topCashierSales ? (row.sales / topCashierSales) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-ink-500">
                            {cashierTotals.sales
                              ? ((row.sales / cashierTotals.sales) * 100).toFixed(0)
                              : 0}
                            %
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(row.sales, store?.currency)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-500">
                        {formatMoney(row.aov, store?.currency)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-medium tabular-nums',
                          row.gross < 0 ? 'text-rose-600' : 'text-emerald-600',
                        )}
                      >
                        {formatMoney(row.gross, store?.currency)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-semibold tabular-nums',
                          !row.varianceCount
                            ? 'text-ink-400'
                            : row.variance === 0
                              ? ''
                              : row.variance > 0
                                ? 'text-emerald-600'
                                : 'text-rose-600',
                        )}
                      >
                        {row.varianceCount ? formatMoney(row.variance, store?.currency) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink-200 font-semibold dark:border-ink-700">
                    <td className="px-3 py-3" colSpan={2}>
                      Total {formatNumber(cashierRows.length)} kasir
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatNumber(cashierTotals.orders)}
                    </td>
                    <td />
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(cashierTotals.sales, store?.currency)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-500">
                      {formatMoney(
                        cashierTotals.orders ? cashierTotals.sales / cashierTotals.orders : 0,
                        store?.currency,
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(cashierTotals.gross, store?.currency)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(cashierTotals.variance, store?.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'channel' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Penjualan per Channel</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Offline vs marketplace, termasuk piutang yang belum cair pada{' '}
                {formatDate(from)} → {formatDate(to)}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={channelTotals.receivable > 0 ? 'warning' : 'success'}>
                Piutang {formatMoney(channelTotals.receivable, store?.currency)}
              </Badge>
              {channelTotals.overdue > 0 && (
                <Badge tone="danger">
                  Lewat tempo {formatMoney(channelTotals.overdue, store?.currency)}
                </Badge>
              )}
            </div>
          </div>

          {channelReport.length === 0 ? (
            <EmptyState
              title="Belum ada penjualan"
              description="Tidak ada transaksi pada rentang tanggal ini."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                  <tr>
                    <th className="rounded-l-lg px-3 py-2.5">Channel</th>
                    <th className="px-3 py-2.5 text-right">Order</th>
                    <th className="px-3 py-2.5">Porsi</th>
                    <th className="px-3 py-2.5 text-right">Penjualan</th>
                    <th className="px-3 py-2.5 text-right">Penyesuaian</th>
                    <th className="px-3 py-2.5 text-right">Order Tempo</th>
                    <th className="rounded-r-lg px-3 py-2.5 text-right">Piutang</th>
                  </tr>
                </thead>
                <tbody>
                  {channelReport.map((row) => (
                    <tr
                      key={row.code}
                      className="border-t border-ink-100 transition-colors hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                    >
                      <td className="px-3 py-3 font-semibold">{row.name}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.orders)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{
                                width: `${channelTotals.sales ? (row.sales / channelTotals.sales) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-ink-500">
                            {channelTotals.sales
                              ? ((row.sales / channelTotals.sales) * 100).toFixed(0)
                              : 0}
                            %
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(row.sales, store?.currency)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right tabular-nums',
                          row.adjustment < 0 ? 'text-rose-600' : row.adjustment > 0 ? 'text-emerald-600' : 'text-ink-400',
                        )}
                      >
                        {row.adjustment === 0
                          ? '—'
                          : `${row.adjustment > 0 ? '+' : ''}${formatMoney(row.adjustment, store?.currency)}`}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatNumber(row.tempoOrders)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-semibold tabular-nums',
                          row.overdue > 0
                            ? 'text-rose-600'
                            : row.receivable > 0
                              ? 'text-amber-600'
                              : 'text-emerald-600',
                        )}
                      >
                        {formatMoney(row.receivable, store?.currency)}
                        {row.overdue > 0 && (
                          <div className="text-[11px] font-normal text-rose-600">
                            {formatMoney(row.overdue, store?.currency)} lewat tempo
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink-200 font-semibold dark:border-ink-700">
                    <td className="px-3 py-3" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(channelTotals.sales, store?.currency)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(channelTotals.adjustment, store?.currency)}
                    </td>
                    <td />
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(channelTotals.receivable, store?.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-ink-500">
            Kolom penyesuaian menampilkan total selisih dari harga tayang awal — biasanya potongan
            marketplace yang dicatat lewat "Sesuaikan harga" di Riwayat Transaksi.
          </p>
        </Card>
      )}

      {tab === 'pnl' && (
        <Card className="p-5 max-w-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              Laba Rugi {formatDate(from)} → {formatDate(to)}
            </h3>
            <Badge tone={curStats.margin >= 0 ? 'success' : 'danger'}>
              Margin {curStats.margin.toFixed(1)}%
            </Badge>
          </div>

          {curStats.revenue === 0 ? (
            <EmptyState
              title="Belum ada pendapatan"
              description="Belum ada transaksi pada rentang ini untuk dihitung."
            />
          ) : (
            <>
              <div className="mb-5">
                <div className="text-xs text-ink-500 mb-1">
                  Komposisi pendapatan
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <div
                    className="bg-rose-400"
                    style={{
                      width: `${Math.min(
                        100,
                        curStats.revenue ? (curStats.cogs / curStats.revenue) * 100 : 0,
                      )}%`,
                    }}
                  />
                  <div
                    className="bg-emerald-500"
                    style={{
                      width: `${Math.max(
                        0,
                        curStats.revenue ? (curStats.gross / curStats.revenue) * 100 : 0,
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-ink-500 mt-2">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-rose-400" /> HPP
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Laba kotor
                  </span>
                </div>
              </div>

              <dl className="space-y-2 text-sm">
                <Row
                  label="Pendapatan (sebelum pajak)"
                  value={formatMoney(curStats.revenue, store?.currency)}
                />
                {curStats.refunds > 0 && (
                  <Row
                    label="Retur / refund"
                    value={`-${formatMoney(curStats.refunds, store?.currency)}`}
                    negative
                  />
                )}
                <Row
                  label="HPP (Cost of Goods Sold)"
                  value={`-${formatMoney(curStats.cogs, store?.currency)}`}
                  negative
                />
                <Row
                  label="Laba Kotor"
                  value={formatMoney(curStats.gross, store?.currency)}
                  bold
                />
                <hr className="border-ink-100 dark:border-ink-800" />
                <Row
                  label="Pengeluaran Operasional"
                  value={`-${formatMoney(expenseTotal, store?.currency)}`}
                  negative
                />
                {expenseByCategory.map(([cat, amount]) => (
                  <Row
                    key={cat}
                    label={`   ${expenseCategoryLabel(cat)}`}
                    value={formatMoney(amount, store?.currency)}
                    hint
                  />
                ))}
                <hr className="border-ink-100 dark:border-ink-800" />
                <Row
                  label="Laba Bersih"
                  value={formatMoney(netProfit, store?.currency)}
                  bold
                  negative={netProfit < 0}
                />
                <hr className="border-ink-100 dark:border-ink-800" />
                <Row
                  label="Diskon yang diberikan"
                  value={formatMoney(curStats.discount, store?.currency)}
                  hint
                />
                <Row
                  label="Pajak terkumpul"
                  value={formatMoney(curStats.tax, store?.currency)}
                  hint
                />
              </dl>
              {expenseTotal === 0 && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  Belum ada pengeluaran tercatat pada rentang ini, jadi Laba Bersih masih sama
                  dengan Laba Kotor. Catat biaya sewa, gaji, dan listrik di halaman Pengeluaran
                  supaya angkanya mencerminkan kondisi sebenarnya.
                </p>
              )}
              <p className="mt-3 text-xs text-ink-500">
                HPP dihitung dari <code>cost_price</code> tiap produk yang terjual. Pastikan modal
                produk terisi di halaman Products supaya laba akurat. Laba Bersih = Laba Kotor
                dikurangi pengeluaran operasional pada rentang yang sama.
              </p>
            </>
          )}
        </Card>
      )}

      {tab === 'best' && (
        <Card className="p-5">
          {bestSellers.length === 0 ? (
            <EmptyState
              title="Belum ada penjualan"
              description="Daftar produk terlaris akan muncul setelah ada transaksi."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2 w-10">#</th>
                  <th className="py-2">Produk</th>
                  <th className="py-2 w-32">Porsi</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Pendapatan</th>
                  <th className="py-2 text-right">Laba</th>
                </tr>
              </thead>
              <tbody>
                {bestSellers.map((b, idx) => (
                  <tr key={b.name + idx} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-2 text-ink-500 font-semibold">{idx + 1}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 overflow-hidden rounded-lg bg-ink-100 dark:bg-ink-800">
                          {b.image && (
                            <img
                              src={b.image}
                              alt={b.name}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <span className="font-medium">{b.name}</span>
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${topQty ? (b.qty / topQty) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-ink-500 tabular-nums">
                          {(b.share * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">{b.qty}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(b.revenue, store?.currency)}
                    </td>
                    <td
                      className={cn(
                        'py-2 text-right tabular-nums font-medium',
                        b.profit < 0 ? 'text-rose-600' : 'text-emerald-600',
                      )}
                    >
                      {formatMoney(b.profit, store?.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal
        open={detailRow !== null}
        onClose={() => setDetailCashier(null)}
        title={detailRow ? `Laporan Kasir · ${detailRow.name}` : 'Laporan Kasir'}
        size="lg"
      >
        {detailRow && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <Badge tone="brand">{detailRow.role ?? 'Akun tidak ditemukan'}</Badge>
              {detailRow.openShift && <Badge tone="success">Shift aktif</Badge>}
              {detailRow.canceled > 0 && (
                <Badge tone="danger">{formatNumber(detailRow.canceled)} order batal</Badge>
              )}
              <span>
                {formatDate(from)} → {formatDate(to)}
                {detailRow.lastOrder && ` · terakhir ${formatDateTime(detailRow.lastOrder)}`}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat label="Penjualan" value={formatMoney(detailRow.sales, store?.currency)} hint={`${formatNumber(detailRow.orders)} order`} />
              <MiniStat label="Rata-rata / Order" value={formatMoney(detailRow.aov, store?.currency)} hint={`${formatNumber(detailRow.qty)} item terjual`} />
              <MiniStat
                label="Laba Kotor"
                value={formatMoney(detailRow.gross, store?.currency)}
                hint={`Margin ${detailRow.margin.toFixed(1)}%`}
                tone={detailRow.gross < 0 ? 'danger' : 'default'}
              />
              <MiniStat
                label="Selisih Kas"
                value={detailRow.varianceCount ? formatMoney(detailRow.variance, store?.currency) : '—'}
                hint={`${formatNumber(detailRow.shifts)} shift · ${formatNumber(detailRow.varianceCount)} ditutup`}
                tone={detailRow.varianceCount && detailRow.variance !== 0 ? 'danger' : 'default'}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Wallet size={15} className="text-brand-600" /> Metode Pembayaran
              </div>
              {detailRow.sales === 0 ? (
                <p className="text-sm text-ink-500">Belum ada pembayaran pada rentang ini.</p>
              ) : (
                <>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                    {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((method) => (
                      <div
                        key={method}
                        style={{
                          width: `${(detailRow.byMethod[method] / detailRow.sales) * 100}%`,
                          background: PAYMENT_COLORS[method],
                        }}
                      />
                    ))}
                  </div>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(Object.keys(PAYMENT_LABELS) as PaymentMethod[])
                      .filter((method) => detailRow.byMethod[method] > 0)
                      .map((method) => (
                        <li key={method} className="flex items-center gap-2 text-sm">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: PAYMENT_COLORS[method] }}
                          />
                          <span className="flex-1">{PAYMENT_LABELS[method]}</span>
                          <span className="font-semibold tabular-nums">
                            {formatMoney(detailRow.byMethod[method], store?.currency)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-semibold">Produk Terlaris</div>
                {detailRow.topProducts.length === 0 ? (
                  <p className="text-sm text-ink-500">Belum ada item terjual.</p>
                ) : (
                  <ul className="space-y-2">
                    {detailRow.topProducts.map((p) => (
                      <li
                        key={p.name}
                        className="flex items-center gap-3 rounded-xl border border-ink-100 px-3 py-2 text-sm dark:border-ink-800"
                      >
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{formatNumber(p.qty)}x</span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-500">
                          {formatMoney(p.revenue, store?.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold">Shift</div>
                {detailShifts.length === 0 ? (
                  <p className="text-sm text-ink-500">Tidak ada shift pada rentang ini.</p>
                ) : (
                  <ul className="space-y-2">
                    {detailShifts.map((s) => {
                      const diff = (s.closing_cash ?? 0) - (s.expected_cash ?? 0);
                      return (
                        <li
                          key={s.id}
                          className="rounded-xl border border-ink-100 px-3 py-2 text-sm dark:border-ink-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{formatDateTime(s.opened_at)}</span>
                            <Badge tone={s.closed_at ? 'neutral' : 'success'}>
                              {s.closed_at ? 'Closed' : 'Active'}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-xs text-ink-500">
                            <span>
                              {formatNumber(s.total_orders)} order ·{' '}
                              {formatMoney(s.total_sales, store?.currency)}
                            </span>
                            {s.closing_cash != null && (
                              <span
                                className={cn(
                                  'font-semibold',
                                  diff === 0 ? '' : diff > 0 ? 'text-emerald-600' : 'text-rose-600',
                                )}
                              >
                                {formatMoney(diff, store?.currency)}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">Transaksi Terakhir</div>
              {detailOrders.length === 0 ? (
                <p className="text-sm text-ink-500">Belum ada transaksi.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-ink-500">
                      <tr>
                        <th className="py-2">Order</th>
                        <th className="py-2">Waktu</th>
                        <th className="py-2">Bayar</th>
                        <th className="py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailOrders.map((o) => (
                        <tr key={o.id} className="border-t border-ink-100 dark:border-ink-800">
                          <td className="py-2 font-semibold">{o.order_number}</td>
                          <td className="py-2 text-ink-500">{formatDateTime(o.created_at)}</td>
                          <td className="py-2">{PAYMENT_LABELS[o.payment_method]}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatMoney(o.total, store?.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3',
        tone === 'danger'
          ? 'border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10'
          : 'border-brand-100 bg-brand-50/60 dark:border-brand-500/20 dark:bg-brand-950/25',
      )}
    >
      <div
        className={cn(
          'text-[11px] font-semibold uppercase tracking-wide',
          tone === 'danger' ? 'text-rose-600 dark:text-rose-300' : 'text-brand-600 dark:text-brand-300',
        )}
      >
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{hint}</div>
    </div>
  );
}

function tabFromSearch(search: string): Tab {
  const value = new URLSearchParams(search).get('tab');
  return (TABS as readonly string[]).includes(value ?? '') ? (value as Tab) : 'daily';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

const UNASSIGNED = 'unassigned';

interface CashierRow {
  id: string;
  name: string;
  role: string | null;
  /** Kasir terdaftar tapi belum ada transaksi pada rentang ini. */
  registered: boolean;
  orders: number;
  canceled: number;
  sales: number;
  tax: number;
  discount: number;
  revenue: number;
  cogs: number;
  gross: number;
  margin: number;
  aov: number;
  qty: number;
  byMethod: Record<PaymentMethod, number>;
  shifts: number;
  openShift: boolean;
  variance: number;
  varianceCount: number;
  lastOrder: string | null;
  topProducts: { name: string; qty: number; revenue: number }[];
}

function buildCashierRows({
  orders,
  canceled,
  items,
  productById,
  shifts,
  users,
}: {
  orders: Order[];
  canceled: Order[];
  items: OrderItem[];
  productById: Map<string, Product>;
  shifts: Shift[];
  users: AdminUser[];
}): CashierRow[] {
  const userById = new Map(users.map((u) => [u.id, u]));
  const rows = new Map<string, CashierRow>();
  const tallies = new Map<string, Map<string, { name: string; qty: number; revenue: number }>>();

  const ensure = (id: string): CashierRow => {
    const found = rows.get(id);
    if (found) return found;
    const user = userById.get(id);
    const row: CashierRow = {
      id,
      name: user
        ? user.full_name || user.email
        : id === UNASSIGNED
          ? 'Tidak tercatat'
          : 'Kasir nonaktif',
      role: user ? roleLabel(user.role) : null,
      registered: Boolean(user),
      orders: 0,
      canceled: 0,
      sales: 0,
      tax: 0,
      discount: 0,
      revenue: 0,
      cogs: 0,
      gross: 0,
      margin: 0,
      aov: 0,
      qty: 0,
      byMethod: { cash: 0, card: 0, ewallet: 0, qris: 0, transfer: 0, other: 0 },
      shifts: 0,
      openShift: false,
      variance: 0,
      varianceCount: 0,
      lastOrder: null,
      topProducts: [],
    };
    rows.set(id, row);
    tallies.set(id, new Map());
    return row;
  };

  // Kasir terdaftar tetap muncul walau nol transaksi, supaya terlihat siapa yang idle.
  for (const user of users) {
    if (normalizeRole(user.role) === 'cashier') ensure(user.id);
  }

  const cashierByOrder = new Map<string, string>();
  for (const order of orders) {
    const id = order.cashier_id ?? UNASSIGNED;
    const row = ensure(id);
    row.orders += 1;
    row.sales += Number(order.total);
    row.tax += Number(order.tax);
    row.discount += Number(order.discount);
    row.revenue += Number(order.total) - Number(order.tax);
    row.byMethod[order.payment_method] += Number(order.total);
    if (!row.lastOrder || order.created_at > row.lastOrder) row.lastOrder = order.created_at;
    cashierByOrder.set(order.id, id);
  }

  for (const item of items) {
    const id = cashierByOrder.get(item.order_id);
    if (!id) continue;
    const row = rows.get(id);
    const tally = tallies.get(id);
    if (!row || !tally) continue;
    const product = item.product_id ? productById.get(item.product_id) : null;
    const cost = Number(item.cost_price ?? product?.cost_price ?? 0);
    row.qty += item.qty;
    row.cogs += cost * item.qty;
    const key = item.product_id ?? item.name;
    const entry = tally.get(key) ?? { name: item.name, qty: 0, revenue: 0 };
    entry.qty += item.qty;
    entry.revenue += item.price * item.qty;
    tally.set(key, entry);
  }

  for (const shift of shifts) {
    const row = ensure(shift.cashier_id ?? UNASSIGNED);
    row.shifts += 1;
    if (!shift.closed_at) row.openShift = true;
    if (shift.closing_cash != null) {
      row.variance += Number(shift.closing_cash) - Number(shift.expected_cash ?? 0);
      row.varianceCount += 1;
    }
  }

  for (const order of canceled) {
    ensure(order.cashier_id ?? UNASSIGNED).canceled += 1;
  }

  for (const row of rows.values()) {
    row.gross = row.revenue - row.cogs;
    row.margin = row.revenue ? (row.gross / row.revenue) * 100 : 0;
    row.aov = row.orders ? row.sales / row.orders : 0;
    row.topProducts = Array.from(tallies.get(row.id)?.values() ?? [])
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }

  return Array.from(rows.values()).sort(
    (a, b) => b.sales - a.sales || a.name.localeCompare(b.name),
  );
}

interface Stats {
  sales: number;
  tax: number;
  discount: number;
  count: number;
  aov: number;
  revenue: number;
  /**
   * Ongkir yang ditagihkan ke pembeli pada periode ini. TIDAK termasuk di
   * `revenue` karena uangnya diteruskan ke kurir dan tidak punya HPP.
   */
  shipping: number;
  /** Nilai retur pada periode ini. Sudah dipotong dari `revenue`. */
  refunds: number;
  cogs: number;
  gross: number;
  margin: number;
}

function computeStats(
  orderList: Order[],
  items: OrderItem[],
  productById: Map<string, Product>,
  refunds: number,
): Stats {
  let sales = 0,
    tax = 0,
    discount = 0,
    count = 0;
  for (const o of orderList) {
    sales += Number(o.total);
    tax += Number(o.tax);
    discount += Number(o.discount);
    count += 1;
  }
  const orderIds = new Set(orderList.map((o) => o.id));
  let revenue = 0;
  let cogs = 0;
  // Ongkir dikeluarkan dari pendapatan: uangnya diteruskan ke kurir dan
  // tidak punya HPP, jadi memasukkannya membuat margin terlihat lebih
  // besar dari kenyataan. Pajak juga bukan pendapatan toko.
  let shipping = 0;
  for (const o of orderList) {
    const ongkir = Number(o.shipping_cost ?? 0);
    shipping += ongkir;
    revenue += Number(o.total) - Number(o.tax) - ongkir;
  }
  for (const it of items) {
    if (!orderIds.has(it.order_id)) continue;
    const product = it.product_id ? productById.get(it.product_id) : null;
    const cost = Number(it.cost_price ?? product?.cost_price ?? 0);
    cogs += cost * it.qty;
  }
  // Retur memotong pendapatan: uang yang dikembalikan bukan lagi pendapatan.
  const netRevenue = revenue - refunds;
  const gross = netRevenue - cogs;
  return {
    sales,
    tax,
    discount,
    count,
    aov: count ? sales / count : 0,
    revenue: netRevenue,
    shipping,
    refunds,
    cogs,
    gross,
    margin: netRevenue ? (gross / netRevenue) * 100 : 0,
  };
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0 && cur === 0) return 0;
  if (prev === 0) return Infinity;
  return ((cur - prev) / prev) * 100;
}

function Row({
  label,
  value,
  bold,
  negative,
  hint,
}: {
  label: string;
  value: string;
  bold?: boolean;
  negative?: boolean;
  hint?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        bold && 'text-base font-bold',
        hint && 'text-ink-500 text-xs',
      )}
    >
      <span>{label}</span>
      <span className={negative ? 'text-rose-600' : ''}>{value}</span>
    </div>
  );
}

function isoDate(d: Date) {
  // Tanggal kalender LOKAL, bukan UTC. toISOString() di WIB (UTC+7) masih
  // menunjuk hari kemarin sampai pukul 07.00, sehingga rentang bawaan yang
  // berakhir "hari ini" ikut membuang transaksi yang dibuat dini hari —
  // pesanan website tengah malam sempat hilang dari antrian staf karenanya.
  const lokal = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return lokal.toISOString().slice(0, 10);
}

function presetRange(p: Preset): { from: string; to: string } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'today') return { from: isoDate(today), to: isoDate(today) };
  if (p === '7d')
    return {
      from: isoDate(new Date(today.getTime() - 6 * 86400000)),
      to: isoDate(today),
    };
  if (p === '30d')
    return {
      from: isoDate(new Date(today.getTime() - 29 * 86400000)),
      to: isoDate(today),
    };
  if (p === 'this-month')
    return {
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoDate(today),
    };
  if (p === 'last-month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: isoDate(s), to: isoDate(e) };
  }
  return null;
}

function compact(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + 'M';
  }
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}
