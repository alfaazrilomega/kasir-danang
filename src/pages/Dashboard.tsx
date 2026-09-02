import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from '@/lib/router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Boxes,
  ClipboardList,
  ClipboardCheck,
  CreditCard,
  Database,
  DollarSign,
  Eye,
  History,
  PackageOpen,
  Percent,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Target,
  UserCog,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/dashboard/StatCard';
import { SalesChart } from '@/components/dashboard/SalesChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { ImportExportModal } from '@/components/data/ImportExportModal';
import { cn, formatMoney, formatNumber, formatDateTime } from '@/lib/format';
import { pullReference, pullRecentOrders, pullInventoryReference } from '@/lib/sync';
import { getBackendClient, type AdminUser } from '@/lib/api';
import { ROLE_LABELS, roleLabel } from '@/lib/roles';
import { AdminHeaderActions } from '@/components/layout/AdminLayout';
import {
  findModule,
  resolveActiveModule,
  sectionTitleFor,
  type AdminModuleItem,
  type AdminModuleKey,
} from '@/lib/adminModules';
import type { Category, Order, Product, StockMovement, UserRole } from '@/types';

type Period = 'today' | 'this-week' | 'this-month' | 'last-30' | 'last-month';
type StockStatusFilter = 'all' | 'safe' | 'low' | 'empty' | 'untracked';

interface Range {
  curStart: Date;
  curEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
}

function rangeFor(period: Period): Range {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return {
      curStart: start,
      curEnd: end,
      prevStart: subDays(start, 1),
      prevEnd: subDays(end, 1),
      label: 'vs kemarin',
    };
  }
  if (period === 'this-week') {
    const s = startOfWeek(now, { weekStartsOn: 1 });
    const e = endOfWeek(now, { weekStartsOn: 1 });
    return { curStart: s, curEnd: e, prevStart: subWeeks(s, 1), prevEnd: subWeeks(e, 1), label: 'vs minggu lalu' };
  }
  if (period === 'last-30') {
    const e = now;
    const s = subDays(e, 29);
    return { curStart: s, curEnd: e, prevStart: subDays(s, 30), prevEnd: subDays(e, 30), label: 'vs 30 hari sebelumnya' };
  }
  if (period === 'last-month') {
    const lm = subMonths(now, 1);
    const s = startOfMonth(lm);
    const e = endOfMonth(lm);
    return { curStart: s, curEnd: e, prevStart: subMonths(s, 1), prevEnd: subMonths(e, 1), label: 'vs bulan sebelumnya' };
  }
  // this-month
  const s = startOfMonth(now);
  const e = endOfMonth(now);
  return { curStart: s, curEnd: e, prevStart: subMonths(s, 1), prevEnd: subMonths(e, 1), label: 'vs bulan lalu' };
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0 && cur === 0) return 0;
  if (prev === 0) return Infinity;
  return ((cur - prev) / prev) * 100;
}

function inRange(o: Order, start: Date, end: Date): boolean {
  const t = new Date(o.created_at).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('today');
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);

  async function handleSeed1000() {
    if (!confirm('Hasilkan 1.000+ data demo acak dan terkoneksi (Produk, Transaksi, PO, Shift, Customer)? Data lokal akan diperbarui.')) {
      return;
    }
    setSeeding(true);
    try {
      const { generate1000Data } = await import('@/lib/seed1000');
      const res = await generate1000Data(storeId || 'store-default-001');
      toast.success(`Berhasil membuat ${res.totalRecords} data acak terkoneksi!`);
      if (storeId) {
        pullRecentOrders(storeId, 500);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghasilkan data demo.');
    } finally {
      setSeeding(false);
    }
  }
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [stockQuery, setStockQuery] = useState('');
  const [stockCategory, setStockCategory] = useState('all');
  const [stockStatus, setStockStatus] = useState<StockStatusFilter>('all');
  const [stockLimit, setStockLimit] = useState(10);

  // The rail lives in AdminLayout now; `?module=` picks which panel this page shows.
  const adminModule: AdminModuleKey =
    resolveActiveModule(location.pathname, location.search, null) ?? 'overview';

  useEffect(() => {
    if (!storeId) return;
    setRefreshing(true);
    Promise.all([pullReference(storeId), pullRecentOrders(storeId, 200)]).finally(() =>
      setRefreshing(false),
    );
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    setLoadingUsers(true);
    getBackendClient().admin.listUsers().then(({ data, error }) => {
      setLoadingUsers(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setAdminUsers(data ?? []);
    });
  }, [storeId]);

  const orders = useLiveQuery(
    async () => {
      const list = await db.orders.where('store_id').equals(storeId).toArray();
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return list;
    },
    [storeId],
  );
  const items = useLiveQuery(() => db.order_items.toArray(), []);
  const products = useLiveQuery(
    () => db.products.where('store_id').equals(storeId).toArray(),
    [storeId],
  );
  const categories =
    useLiveQuery(() => db.categories.where('store_id').equals(storeId).sortBy('sort_order'), [storeId]) ?? [];
  const stockMovements =
    useLiveQuery(async () => {
      if (!storeId) return [];
      const list = await db.stock_movements.where('store_id').equals(storeId).toArray();
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return list;
    }, [storeId]) ?? [];
  const customers = useLiveQuery(
    () => db.customers.where('store_id').equals(storeId).count(),
    [storeId],
  );
  const pendingOrders = useLiveQuery(() => db.pending.count(), []) ?? 0;

  const range = useMemo(() => rangeFor(period), [period]);
  const currentOrders = useMemo(
    () =>
      (orders ?? []).filter(
        (o) => o.order_status !== 'canceled' && inRange(o, range.curStart, range.curEnd),
      ),
    [orders, range],
  );
  const previousOrders = useMemo(
    () =>
      (orders ?? []).filter(
        (o) => o.order_status !== 'canceled' && inRange(o, range.prevStart, range.prevEnd),
      ),
    [orders, range],
  );

  const chartData = useMemo(() => {
    const months: { key: string; month: string; sales: number; orders: number; customers: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = subMonths(startOfMonth(new Date()), i);
      months.push({ key: format(d, 'yyyy-MM'), month: format(d, 'MMM'), sales: 0, orders: 0, customers: 0 });
    }
    const seen = new Set<string>();
    for (const o of orders ?? []) {
      if (o.order_status === 'canceled') continue;
      const k = format(parseISO(o.created_at), 'yyyy-MM');
      const m = months.find((x) => x.key === k);
      if (!m) continue;
      m.sales += o.total;
      m.orders += 1;
      if (o.customer_id && !seen.has(o.customer_id + k)) {
        seen.add(o.customer_id + k);
        m.customers += 1;
      }
    }
    return months;
  }, [orders]);

  // Period-aware metrics + trends.
  const metrics = useMemo(() => {
    const curSales = currentOrders.reduce((s, o) => s + o.total, 0);
    const prevSales = previousOrders.reduce((s, o) => s + o.total, 0);
    const curCount = currentOrders.length;
    const prevCount = previousOrders.length;

    const uniqueCustomers = (rows: Order[]) => new Set(rows.map((o) => o.customer_id).filter(Boolean)).size;
    const curCust = uniqueCustomers(currentOrders);
    const prevCust = uniqueCustomers(previousOrders);

    return {
      sales: { value: curSales, trend: pctChange(curSales, prevSales) },
      orders: { value: curCount, trend: pctChange(curCount, prevCount) },
      customers: { value: curCust, trend: pctChange(curCust, prevCust) },
    };
  }, [currentOrders, previousOrders]);

  const totals = useMemo(() => ({
    products: products?.length ?? 0,
    activeProducts: products?.filter((p) => p.is_active).length ?? 0,
    totalCustomers: customers ?? 0,
  }), [products, customers]);

  const lowStock = useMemo(
    () =>
      (products ?? []).filter(
        (p) => p.track_stock && Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0),
      ),
    [products],
  );

  const roleCounts = useMemo(() => {
    const counts = new Map<UserRole, number>();
    for (const role of ['admin', 'warehouse', 'cashier', 'customer'] as UserRole[]) {
      counts.set(role, 0);
    }
    for (const user of adminUsers) {
      const role = user.role === 'manager' ? 'admin' : user.role;
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    return counts;
  }, [adminUsers]);

  const productById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const lastMovementByProduct = useMemo(() => {
    const out = new Map<string, StockMovement>();
    for (const movement of stockMovements) {
      if (movement.product_id && !out.has(movement.product_id)) {
        out.set(movement.product_id, movement);
      }
    }
    return out;
  }, [stockMovements]);

  const stockRows = useMemo(() => {
    const needle = stockQuery.trim().toLowerCase();
    return (products ?? [])
      .filter((product) => {
        if (stockCategory !== 'all' && product.category_id !== stockCategory) return false;
        const status = productStockStatus(product);
        if (stockStatus !== 'all' && status !== stockStatus) return false;
        if (!needle) return true;
        const category = product.category_id ? categoryById.get(product.category_id)?.name ?? '' : '';
        return [product.name, product.sku ?? '', product.barcode ?? '', category]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        const priority = (product: Product) => {
          const status = productStockStatus(product);
          if (status === 'empty') return 0;
          if (status === 'low') return 1;
          if (status === 'safe') return 2;
          return 3;
        };
        return priority(a) - priority(b) || a.name.localeCompare(b.name);
      })
      .slice(0, stockLimit);
  }, [categoryById, products, stockCategory, stockLimit, stockQuery, stockStatus]);

  const stockSummary = useMemo(() => {
    const rows = products ?? [];
    const totalUnits = rows.reduce((sum, product) => sum + Number(product.stock_qty ?? 0), 0);
    const capitalValue = rows.reduce(
      (sum, product) => sum + Number(product.cost_price ?? 0) * Number(product.stock_qty ?? 0),
      0,
    );
    const salesValue = rows.reduce(
      (sum, product) => sum + Number(product.base_price ?? 0) * Number(product.stock_qty ?? 0),
      0,
    );
    return {
      totalProducts: rows.length,
      activeProducts: rows.filter((product) => product.is_active).length,
      totalUnits,
      capitalValue,
      salesValue,
      lowCount: rows.filter((product) => productStockStatus(product) === 'low').length,
      emptyCount: rows.filter((product) => productStockStatus(product) === 'empty').length,
    };
  }, [products]);

  const finance = useMemo(() => {
    const orderIds = new Set(currentOrders.map((order) => order.id));
    let lineRevenue = 0;
    let cogs = 0;
    for (const item of items ?? []) {
      if (!orderIds.has(item.order_id)) continue;
      const product = item.product_id ? productById.get(item.product_id) : null;
      const cost = Number(item.cost_price ?? product?.cost_price ?? 0);
      lineRevenue += Number(item.price) * Number(item.qty);
      cogs += cost * Number(item.qty);
    }
    return {
      lineRevenue,
      cogs,
      grossProfit: lineRevenue - cogs,
      grossMargin: lineRevenue > 0 ? ((lineRevenue - cogs) / lineRevenue) * 100 : 0,
      aov: metrics.orders.value > 0 ? metrics.sales.value / metrics.orders.value : 0,
    };
  }, [currentOrders, items, metrics.orders.value, metrics.sales.value, productById]);

  const criticalStock = useMemo(
    () =>
      [...lowStock]
        .sort(
          (a, b) =>
            Number(a.stock_qty ?? 0) - Number(a.min_stock ?? 0) -
            (Number(b.stock_qty ?? 0) - Number(b.min_stock ?? 0)),
        )
        .slice(0, 6),
    [lowStock],
  );

  const cashierPerformance = useMemo(() => {
    const rows = new Map<
      string,
      { id: string; name: string; orders: number; sales: number; lastOrder: string | null }
    >();
    for (const user of adminUsers) {
      if (user.role !== 'cashier') continue;
      rows.set(user.id, {
        id: user.id,
        name: user.full_name || user.email,
        orders: 0,
        sales: 0,
        lastOrder: null,
      });
    }
    for (const order of currentOrders) {
      const id = order.cashier_id ?? 'unknown';
      const row = rows.get(id) ?? {
        id,
        name: id === 'unknown' ? 'Tidak tercatat' : adminUsers.find((u) => u.id === id)?.full_name ?? 'Kasir lama',
        orders: 0,
        sales: 0,
        lastOrder: null,
      };
      row.orders += 1;
      row.sales += Number(order.total);
      if (!row.lastOrder || order.created_at > row.lastOrder) row.lastOrder = order.created_at;
      rows.set(id, row);
    }
    return [...rows.values()].sort((a, b) => b.sales - a.sales).slice(0, 6);
  }, [adminUsers, currentOrders]);

  const healthItems = useMemo(() => {
    return [
      {
        label: 'Admin utama',
        ok: (roleCounts.get('admin') ?? 0) > 0,
        detail: 'Minimal satu admin aktif',
        action: '/users',
      },
      {
        label: 'Tim kasir',
        ok: (roleCounts.get('cashier') ?? 0) > 0,
        detail: 'Kasir untuk input order',
        action: '/users',
      },
      {
        label: 'Admin gudang',
        ok: (roleCounts.get('warehouse') ?? 0) > 0,
        detail: 'Gudang untuk stok',
        action: '/users',
      },
      {
        label: 'Produk aktif',
        ok: totals.activeProducts > 0,
        detail: `${formatNumber(totals.activeProducts)} produk tampil di POS`,
        action: '/products',
      },
      {
        label: 'Pending sync',
        ok: pendingOrders === 0,
        detail: pendingOrders ? `${formatNumber(pendingOrders)} order menunggu sync` : 'Semua order tersinkron',
        action: '/settings',
      },
      {
        label: 'Stok aman',
        ok: lowStock.length === 0,
        detail: lowStock.length ? `${formatNumber(lowStock.length)} produk di bawah minimum` : 'Tidak ada stok kritis',
        action: '/products',
      },
    ];
  }, [lowStock.length, pendingOrders, roleCounts, totals.activeProducts]);
  const healthScore = Math.round(
    (healthItems.filter((item) => item.ok).length / Math.max(1, healthItems.length)) * 100,
  );

  const bestSellers = useMemo(() => {
    const inWindow = new Set(currentOrders.map((o) => o.id));
    const tally = new Map<string, { name: string; qty: number; image: string | null; price: number }>();
    for (const it of items ?? []) {
      if (!inWindow.has(it.order_id)) continue;
      const prev = tally.get(it.product_id ?? it.name) ?? {
        name: it.name,
        qty: 0,
        image: null,
        price: it.price,
      };
      prev.qty += it.qty;
      tally.set(it.product_id ?? it.name, prev);
    }
    for (const p of products ?? []) {
      const v = tally.get(p.id);
      if (v) v.image = p.image_url;
    }
    return Array.from(tally.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [items, products, currentOrders]);

  const latest = (orders ?? []).slice(0, 8);

  const activeItem = useMemo(() => {
    const found = findModule(adminModule);
    return found
      ? { ...found, section: sectionTitleFor(adminModule) }
      : { ...(findModule('overview') as AdminModuleItem), section: sectionTitleFor('overview') };
  }, [adminModule]);

  const historyProduct = (products ?? []).find((product) => product.id === historyProductId) ?? null;
  const historyRows = historyProduct
    ? stockMovements.filter((movement) => movement.product_id === historyProduct.id).slice(0, 20)
    : [];

  const modulePanel =
    adminModule === 'stock-report' ? (
      <StockReportPanel
        categories={categories}
        rows={stockRows}
        summary={stockSummary}
        query={stockQuery}
        onQueryChange={setStockQuery}
        category={stockCategory}
        onCategoryChange={setStockCategory}
        status={stockStatus}
        onStatusChange={setStockStatus}
        limit={stockLimit}
        onLimitChange={setStockLimit}
        categoryById={categoryById}
        lastMovementByProduct={lastMovementByProduct}
        currency={store?.currency ?? 'IDR'}
        onHistory={setHistoryProductId}
        onNavigate={navigate}
      />
    ) : adminModule === 'stock-mutation' ? (
      <StockMutationPanel
        movements={stockMovements}
        products={products ?? []}
        currency={store?.currency ?? 'IDR'}
        onNavigate={navigate}
      />
    ) : adminModule === 'stock-opname' ? (
      <StockOpnamePanel
        products={products ?? []}
        categoryById={categoryById}
        onNavigate={navigate}
      />
    ) : (
      <AdminModuleLanding
        module={activeItem}
        products={products ?? []}
        categories={categories}
        stockMovements={stockMovements}
        onNavigate={navigate}
      />
    );

  return (
    <>
      <AdminHeaderActions>
        {refreshing && (
          <span className="hidden items-center gap-1.5 text-xs text-ink-500 md:inline-flex">
            <RefreshCcw size={12} className="animate-spin" /> Sinkron...
          </span>
        )}
        {adminModule === 'overview' && (
          <select
            className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            aria-label="Periode laporan"
          >
            <option value="today">Hari ini</option>
            <option value="this-week">Minggu ini</option>
            <option value="this-month">Bulan ini</option>
            <option value="last-month">Bulan lalu</option>
            <option value="last-30">30 hari terakhir</option>
          </select>
        )}
        <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
          <Database size={14} />
          <span className="hidden sm:inline">Impor / Ekspor Data</span>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/users')}>
          <UserCog size={14} />
          <span className="hidden sm:inline">Kelola User</span>
        </Button>
        <Button size="sm" onClick={() => navigate('/products')}>
          <Boxes size={14} />
          <span className="hidden sm:inline">Gudang</span>
        </Button>
      </AdminHeaderActions>

      <ImportExportModal
        open={transferOpen}
        storeId={storeId}
        onClose={() => setTransferOpen(false)}
        onImported={() => {
          // Data berubah total; tarik ulang supaya angka di layar ikut benar.
          if (storeId) void pullInventoryReference(storeId);
        }}
      />

      <div className="space-y-5">
          {adminModule === 'overview' ? (
            <>
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-5 text-white md:p-6">
                <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10" />
                <div className="relative flex flex-wrap items-end justify-between gap-5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                      {store?.name ?? 'Aplikasi Kasir'} · {roleLabel(profile?.role)}
                    </div>
                    <h2 className="mt-1.5 text-2xl font-bold md:text-3xl">
                      Halo, {profile?.full_name ?? 'Admin'}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-white/75">
                      Kontrol bisnis, user, kasir, gudang, stok, dan performa penjualan dari satu tempat.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <BannerStat label="Business health" value={`${healthScore}%`} />
                    <BannerStat label="Stok menipis" value={formatNumber(lowStock.length)} />
                    <BannerStat label="Pending sync" value={formatNumber(pendingOrders)} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={DollarSign}
                  label="Penjualan"
                  value={formatMoney(metrics.sales.value, store?.currency)}
                  trend={metrics.sales.trend}
                  hint={range.label}
                />
                <StatCard
                  icon={ShoppingBag}
                  label="Total Order"
                  value={formatNumber(metrics.orders.value)}
                  trend={metrics.orders.trend}
                  hint={range.label}
                />
                <StatCard
                  icon={Users}
                  label="User Aktif"
                  value={loadingUsers ? '...' : formatNumber(adminUsers.length)}
                  hint={`${formatNumber(roleCounts.get('cashier') ?? 0)} kasir · ${formatNumber(roleCounts.get('warehouse') ?? 0)} gudang`}
                />
                <StatCard
                  icon={PackageOpen}
                  label="Stok Menipis"
                  value={formatNumber(lowStock.length)}
                  hint={`${formatNumber(totals.products)} produk · ${formatNumber(totals.totalCustomers)} pelanggan`}
                  progress={totals.products ? lowStock.length / totals.products : 0}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.15fr_1.85fr]">
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Business Health</h3>
                      <p className="mt-0.5 text-xs text-ink-500">Checklist kesiapan operasional toko.</p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-brand-600">{healthScore}%</div>
                      <Badge tone={healthScore >= 85 ? 'success' : healthScore >= 60 ? 'warning' : 'danger'}>
                        {healthScore >= 85 ? 'Sehat' : healthScore >= 60 ? 'Perlu cek' : 'Kritis'}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                    <div className="h-full bg-brand-500" style={{ width: `${healthScore}%` }} />
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {healthItems.map((item) => (
                      <button
                        key={item.label}
                        onClick={() => navigate(item.action)}
                        className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-ink-800 dark:hover:bg-brand-950/30"
                      >
                        <span
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                            item.ok
                              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15'
                              : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15',
                          )}
                        >
                          {item.ok ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{item.label}</span>
                          <span className="block truncate text-xs text-ink-500">{item.detail}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>

                <div className="grid gap-4 md:grid-cols-3">
                  <AdminKpi
                    icon={Target}
                    label="AOV"
                    value={formatMoney(finance.aov, store?.currency)}
                    hint="Rata-rata nilai order"
                  />
                  <AdminKpi
                    icon={Activity}
                    label="Laba Kotor"
                    value={formatMoney(finance.grossProfit, store?.currency)}
                    hint={`${finance.grossMargin.toFixed(1)}% margin item`}
                    tone={finance.grossProfit < 0 ? 'danger' : 'default'}
                  />
                  <AdminKpi
                    icon={WifiOff}
                    label="Pending Sync"
                    value={formatNumber(pendingOrders)}
                    hint={pendingOrders ? 'Perlu online/sync' : 'Tidak ada antrian'}
                    tone={pendingOrders > 0 ? 'warning' : 'default'}
                  />

                  <Card className="p-5 md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">Performa Kasir</h3>
                      <div className="flex items-center gap-2">
                        <Badge tone="neutral">{range.label.replace('vs ', '')}</Badge>
                        <button
                          onClick={() => navigate('/reports?tab=cashier')}
                          className="text-xs font-semibold text-brand-600 hover:underline"
                        >
                          Laporan lengkap
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      {cashierPerformance.length === 0 ? (
                        <EmptyState
                          title="Belum ada kasir"
                          description="Tambahkan kasir dari menu Users untuk mulai memantau performa."
                          action={<Button onClick={() => navigate('/users')}><Plus size={14} /> Tambah kasir</Button>}
                        />
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs text-ink-500">
                            <tr>
                              <th className="py-2">Kasir</th>
                              <th className="py-2">Order</th>
                              <th className="py-2">Penjualan</th>
                              <th className="py-2">Terakhir</th>
                              <th className="py-2 text-right">Detail</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cashierPerformance.map((row) => (
                              <tr
                                key={row.id}
                                onClick={() => navigate('/reports?tab=cashier')}
                                className="cursor-pointer border-t border-ink-100 transition-colors hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                              >
                                <td className="py-3 font-semibold">{row.name}</td>
                                <td className="py-3">{formatNumber(row.orders)}</td>
                                <td className="py-3">{formatMoney(row.sales, store?.currency)}</td>
                                <td className="py-3 text-ink-500">
                                  {row.lastOrder ? formatDateTime(row.lastOrder) : 'Belum ada'}
                                </td>
                                <td className="py-3 text-right">
                                  <span className="text-xs font-semibold text-brand-600">Lihat</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Stok Kritis</h3>
                      <Badge tone={criticalStock.length > 0 ? 'warning' : 'success'}>
                        {criticalStock.length || 'Aman'}
                      </Badge>
                    </div>
                    <div className="mt-4 space-y-3">
                      {criticalStock.length === 0 ? (
                        <p className="text-sm text-ink-500">Semua stok di atas batas minimum.</p>
                      ) : (
                        criticalStock.map((product) => {
                          const qty = Number(product.stock_qty ?? 0);
                          const min = Number(product.min_stock ?? 0);
                          return (
                            <button
                              key={product.id}
                              onClick={() => navigate('/products')}
                              className="w-full rounded-xl border border-ink-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-ink-800 dark:hover:bg-brand-950/30"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-semibold">{product.name}</span>
                                <span className="text-sm font-bold text-amber-600">{formatNumber(qty)}</span>
                              </div>
                              <div className="mt-1 text-xs text-ink-500">Minimum {formatNumber(min)}</div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </Card>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <AdminShortcut
                  icon={UserCog}
                  title="Users"
                  value={`${formatNumber(adminUsers.length)} akun`}
                  detail="Tambah admin gudang, kasir, dan pembeli"
                  onClick={() => navigate('/users')}
                />
                <AdminShortcut
                  icon={Boxes}
                  title="Gudang"
                  value={`${formatNumber(totals.products)} produk`}
                  detail={`${formatNumber(lowStock.length)} stok perlu dicek`}
                  tone={lowStock.length > 0 ? 'warning' : 'default'}
                  onClick={() => navigate('/products')}
                />
                <AdminShortcut
                  icon={Percent}
                  title="Promos"
                  value="Voucher"
                  detail="Atur diskon dan campaign"
                  onClick={() => navigate('/promos')}
                />
                <AdminShortcut
                  icon={SettingsIcon}
                  title="Settings"
                  value="Toko"
                  detail="Profil, struk, fitur POS, koneksi"
                  onClick={() => navigate('/settings')}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Role User</h3>
                    <Badge tone="info">{loadingUsers ? 'Sync...' : `${adminUsers.length} akun`}</Badge>
                  </div>
                  <div className="mt-4 space-y-3">
                    {(['admin', 'warehouse', 'cashier', 'customer'] as UserRole[]).map((role) => {
                      const count = roleCounts.get(role) ?? 0;
                      const max = Math.max(1, adminUsers.length);
                      return (
                        <button
                          key={role}
                          onClick={() => navigate('/users')}
                          className="w-full rounded-xl border border-ink-100 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50 dark:border-ink-800 dark:hover:bg-brand-950/30"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">{ROLE_LABELS[role]}</div>
                              <div className="text-xs text-ink-500">{roleAdminHint(role)}</div>
                            </div>
                            <div className="text-xl font-bold text-brand-600">{count}</div>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                            <div className="h-full bg-brand-500" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>

                <Card className="p-5 lg:col-span-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Kontrol Operasional</h3>
                    <Badge tone={lowStock.length > 0 ? 'warning' : 'success'}>
                      {lowStock.length > 0 ? 'Perlu cek' : 'Stok aman'}
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <AdminControl
                      icon={ShieldCheck}
                      title="Akses tim"
                      description="Pastikan setiap user memakai role yang tepat."
                      action="Kelola"
                      onClick={() => navigate('/users')}
                    />
                    <AdminControl
                      icon={ClipboardList}
                      title="Monitoring order"
                      description="Pantau transaksi terbaru, status bayar, dan struk."
                      action="Buka order"
                      onClick={() => navigate('/orders')}
                    />
                    <AdminControl
                      icon={AlertTriangle}
                      title="Stok menipis"
                      description={
                        lowStock.length
                          ? `${lowStock.slice(0, 3).map((p) => p.name).join(', ')}${lowStock.length > 3 ? ` +${lowStock.length - 3}` : ''}`
                          : 'Tidak ada produk di bawah minimum.'
                      }
                      action="Cek gudang"
                      onClick={() => navigate('/products')}
                    />
                    <AdminControl
                      icon={CreditCard}
                      title="Laporan"
                      description="Lihat penjualan, laba kotor, shift, dan best seller."
                      action="Buka laporan"
                      onClick={() => navigate('/reports')}
                    />
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Orders &amp; Sales Overview</h3>
                    <span className="text-xs text-ink-500">12 bulan terakhir</span>
                  </div>
                  <SalesChart data={chartData} />
                </Card>

                <Card className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Best Seller</h3>
                    <span className="text-xs text-ink-500">{range.label.replace('vs ', '')}</span>
                  </div>
                  {bestSellers.length === 0 ? (
                    <EmptyState title="Belum ada data" description="Best seller akan muncul setelah ada transaksi." />
                  ) : (
                    <ul className="space-y-3">
                      {bestSellers.map((b) => (
                        <li key={b.name} className="flex items-center gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-xl bg-ink-100 dark:bg-ink-800">
                            {b.image && <img src={b.image} alt={b.name} className="h-full w-full object-cover" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-sm font-semibold">{b.name}</div>
                            <div className="text-xs text-brand-600">{formatMoney(b.price, store?.currency)}</div>
                          </div>
                          <div className="text-sm font-semibold">{b.qty}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Latest Orders</h3>
                  <button onClick={() => navigate('/orders')} className="text-xs text-brand-600 hover:underline">See All</button>
                </div>
                {latest.length === 0 ? (
                  <EmptyState
                    title="Belum ada order"
                    description={refreshing ? 'Menyinkronkan dari Postgres...' : 'Buat order pertama Anda dari halaman Menu.'}
                    action={<Button onClick={() => navigate('/menu')}><Plus size={16} /> Buat order</Button>}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-ink-500 text-xs">
                        <tr>
                          <th className="py-2">Order ID</th>
                          <th className="py-2">Date</th>
                          <th className="py-2">Amount</th>
                          <th className="py-2">Payment</th>
                          <th className="py-2">Status</th>
                          <th className="py-2">Order Status</th>
                          <th className="py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latest.map((o) => (
                          <tr key={o.id} className="border-t border-ink-100 dark:border-ink-800">
                            <td className="py-3 font-semibold">{o.order_number}</td>
                            <td className="py-3">{formatDateTime(o.created_at)}</td>
                            <td className="py-3">{formatMoney(o.total, store?.currency)}</td>
                            <td className="py-3 capitalize">{o.payment_method}</td>
                            <td className="py-3">
                              <Badge tone={o.payment_status === 'paid' ? 'success' : 'danger'}>
                                {o.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                              </Badge>
                            </td>
                            <td className="py-3 capitalize">{o.order_status}</td>
                            <td className="py-3 text-right">
                              <button
                                onClick={() => navigate('/orders')}
                                className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                              >
                                <Eye size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : (
            <Card className="p-4 md:p-5">{modulePanel}</Card>
          )}
      </div>

      <Modal
        open={historyProduct !== null}
        onClose={() => setHistoryProductId(null)}
        title={historyProduct ? `Riwayat Stok - ${historyProduct.name}` : 'Riwayat Stok'}
        size="lg"
      >
        {historyRows.length === 0 ? (
          <EmptyState
            title="Belum ada mutasi"
            description="Riwayat akan muncul setelah stok disesuaikan atau ada penjualan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-500">
                <tr>
                  <th className="py-2">Tanggal</th>
                  <th className="py-2">Tipe</th>
                  <th className="py-2">Qty</th>
                  <th className="py-2">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((movement) => (
                  <tr key={movement.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-3">{formatDateTime(movement.created_at)}</td>
                    <td className="py-3">{movementLabel(movement.type)}</td>
                    <td className={cn('py-3 font-semibold', movement.qty_delta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                      {movement.qty_delta > 0 ? '+' : ''}{formatNumber(movement.qty_delta)}
                    </td>
                    <td className="py-3 text-ink-500">{movement.reason ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}


function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-white/60">{label}</div>
      <div className="mt-0.5 text-lg font-bold leading-none">{value}</div>
    </div>
  );
}

function StockReportPanel({
  categories,
  rows,
  summary,
  query,
  onQueryChange,
  category,
  onCategoryChange,
  status,
  onStatusChange,
  limit,
  onLimitChange,
  categoryById,
  lastMovementByProduct,
  currency,
  onHistory,
  onNavigate,
}: {
  categories: Category[];
  rows: Product[];
  summary: {
    totalProducts: number;
    activeProducts: number;
    totalUnits: number;
    capitalValue: number;
    salesValue: number;
    lowCount: number;
    emptyCount: number;
  };
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  status: StockStatusFilter;
  onStatusChange: (value: StockStatusFilter) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  categoryById: Map<string, Category>;
  lastMovementByProduct: Map<string, StockMovement>;
  currency: string;
  onHistory: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-4 dark:border-ink-800">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
            <Database size={19} />
          </span>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-600">Laporan Inventory</div>
            <h2 className="mt-0.5 text-xl font-bold leading-tight">Laporan Stok</h2>
            <p className="mt-1 text-sm text-ink-500">Nilai modal, status stok, dan pergerakan terakhir.</p>
          </div>
        </div>
        <Button onClick={() => onNavigate('/products')}>
          <SlidersHorizontal size={14} /> Sesuaikan stok
        </Button>
      </div>

      <div className="grid gap-2 lg:grid-cols-[1fr_180px_160px_110px_auto]">
        <label className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900">
          <Search size={14} className="text-brand-500" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent focus:outline-none"
            placeholder="Cari produk, barcode, atau kategori..."
          />
        </label>
        <select className="input" value={category} onChange={(event) => onCategoryChange(event.target.value)}>
          <option value="all">Semua Kategori</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <select
          className="input"
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StockStatusFilter)}
        >
          <option value="all">Semua Status</option>
          <option value="safe">Aman</option>
          <option value="low">Menipis</option>
          <option value="empty">Habis</option>
          <option value="untracked">Tidak dilacak</option>
        </select>
        <select className="input" value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={() => {
            onQueryChange('');
            onCategoryChange('all');
            onStatusChange('all');
            onLimitChange(10);
          }}
        >
          Reset
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StockSummaryCard label="Total Produk" value={formatNumber(summary.totalProducts)} hint={`Aktif: ${formatNumber(summary.activeProducts)}`} />
        <StockSummaryCard label="Total Unit Stok" value={formatNumber(summary.totalUnits)} hint={`Habis: ${formatNumber(summary.emptyCount)}`} />
        <StockSummaryCard label="Nilai Modal" value={formatMoney(summary.capitalValue, currency)} hint={`Nilai jual: ${formatMoney(summary.salesValue, currency)}`} />
        <StockSummaryCard label="Produk Menipis" value={formatNumber(summary.lowCount)} hint="Produk di bawah minimum" tone={summary.lowCount > 0 ? 'warning' : 'default'} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
            <tr>
              <th className="px-3 py-3">No.</th>
              <th className="px-3 py-3">Produk</th>
              <th className="px-3 py-3">Kategori</th>
              <th className="px-3 py-3">Stok</th>
              <th className="px-3 py-3">Harga Beli</th>
              <th className="px-3 py-3">Harga Jual</th>
              <th className="px-3 py-3">Nilai Modal</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Pergerakan Terakhir</th>
              <th className="px-3 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-ink-500">
                  Tidak ada produk sesuai filter.
                </td>
              </tr>
            ) : (
              rows.map((product, index) => {
                const movement = lastMovementByProduct.get(product.id);
                const qty = Number(product.stock_qty ?? 0);
                const cost = Number(product.cost_price ?? 0);
                const statusValue = productStockStatus(product);
                return (
                  <tr
                    key={product.id}
                    className="border-t border-ink-100 transition-colors hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                  >
                    <td className="px-3 py-3 font-semibold">{index + 1}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-brand-600">{product.name}</div>
                      <div className="text-xs font-mono text-ink-500">{product.barcode || product.sku || '-'}</div>
                    </td>
                    <td className="px-3 py-3">{product.category_id ? categoryById.get(product.category_id)?.name ?? '-' : '-'}</td>
                    <td className="px-3 py-3 font-semibold">{product.track_stock ? `${formatNumber(qty)} unit` : '-'}</td>
                    <td className="px-3 py-3">{formatMoney(cost, currency)}</td>
                    <td className="px-3 py-3">{formatMoney(Number(product.base_price ?? 0), currency)}</td>
                    <td className="px-3 py-3 font-semibold text-amber-700 dark:text-amber-300">{formatMoney(cost * qty, currency)}</td>
                    <td className="px-3 py-3"><Badge tone={stockStatusTone(statusValue)}>{stockStatusLabel(statusValue)}</Badge></td>
                    <td className="px-3 py-3">
                      {movement ? (
                        <>
                          <div className="font-semibold">{movementLabel(movement.type)}</div>
                          <div className="text-xs text-ink-500">{formatDateTime(movement.created_at)}</div>
                          <div className="text-xs text-ink-400">{movement.reason ?? '-'}</div>
                        </>
                      ) : (
                        <span className="text-ink-400">Belum ada</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => onHistory(product.id)}>
                          <History size={12} /> Riwayat
                        </Button>
                        <Button size="sm" onClick={() => onNavigate('/products')}>
                          Sesuaikan
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockMutationPanel({
  movements,
  products,
  currency,
  onNavigate,
}: {
  movements: StockMovement[];
  products: Product[];
  currency: string;
  onNavigate: (path: string) => void;
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return (
    <div className="space-y-4">
      <ModuleHeader icon={RotateCcw} title="Mutasi Stok" description="Riwayat stok masuk, keluar, retur, dan penyesuaian." action="Buka Gudang" onAction={() => onNavigate('/products')} />
      <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
            <tr>
              <th className="px-3 py-3">Tanggal</th>
              <th className="px-3 py-3">Produk</th>
              <th className="px-3 py-3">Tipe</th>
              <th className="px-3 py-3">Qty</th>
              <th className="px-3 py-3">Estimasi Nilai</th>
              <th className="px-3 py-3">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {movements.slice(0, 20).map((movement) => {
              const product = movement.product_id ? productById.get(movement.product_id) : null;
              return (
                <tr
                  key={movement.id}
                  className="border-t border-ink-100 transition-colors hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                >
                  <td className="px-3 py-3">{formatDateTime(movement.created_at)}</td>
                  <td className="px-3 py-3 font-semibold">{product?.name ?? '-'}</td>
                  <td className="px-3 py-3">{movementLabel(movement.type)}</td>
                  <td className={cn('px-3 py-3 font-semibold', movement.qty_delta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {movement.qty_delta > 0 ? '+' : ''}{formatNumber(movement.qty_delta)}
                  </td>
                  <td className="px-3 py-3">{formatMoney(Math.abs(movement.qty_delta) * Number(product?.cost_price ?? 0), currency)}</td>
                  <td className="px-3 py-3 text-ink-500">{movement.reason ?? '-'}</td>
                </tr>
              );
            })}
            {movements.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-ink-500">Belum ada mutasi stok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockOpnamePanel({
  products,
  categoryById,
  onNavigate,
}: {
  products: Product[];
  categoryById: Map<string, Category>;
  onNavigate: (path: string) => void;
}) {
  const candidates = [...products]
    .filter((product) => product.track_stock)
    .sort((a, b) => Number(a.stock_qty ?? 0) - Number(b.stock_qty ?? 0))
    .slice(0, 10);
  return (
    <div className="space-y-4">
      <ModuleHeader icon={ClipboardCheck} title="Stock Opname" description="Prioritaskan produk yang perlu dicek fisik." action="Mulai dari Gudang" onAction={() => onNavigate('/products')} />
      <div className="grid gap-3 md:grid-cols-3">
        <StockSummaryCard label="Item dilacak" value={formatNumber(products.filter((product) => product.track_stock).length)} hint="Produk dengan stok aktif" />
        <StockSummaryCard label="Tidak dilacak" value={formatNumber(products.filter((product) => !product.track_stock).length)} hint="Layanan / produk non-stok" />
        <StockSummaryCard label="Perlu cek" value={formatNumber(candidates.length)} hint="Prioritas opname" tone={candidates.length ? 'warning' : 'default'} />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {candidates.map((product) => (
          <button
            key={product.id}
            onClick={() => onNavigate('/products')}
            className="rounded-xl border border-ink-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-ink-800 dark:hover:bg-brand-950/30"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{product.name}</div>
                <div className="text-xs text-ink-500">{product.category_id ? categoryById.get(product.category_id)?.name ?? '-' : '-'}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{formatNumber(Number(product.stock_qty ?? 0))}</div>
                <div className="text-xs text-ink-500">min {formatNumber(Number(product.min_stock ?? 0))}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminModuleLanding({
  module,
  products,
  categories,
  stockMovements,
  onNavigate,
}: {
  module: AdminModuleItem;
  products: Product[];
  categories: Category[];
  stockMovements: StockMovement[];
  onNavigate: (path: string) => void;
}) {
  const Icon = module.icon;
  const ready = module.status !== 'planned';
  return (
    <div className="space-y-4">
      <ModuleHeader
        icon={Icon}
        title={module.label}
        description={module.description}
        action={module.route ? 'Buka halaman' : 'Belum aktif'}
        onAction={module.route ? () => onNavigate(module.route!) : undefined}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <StockSummaryCard label="Produk" value={formatNumber(products.length)} hint="Master produk" />
        <StockSummaryCard label="Kategori" value={formatNumber(categories.length)} hint="Kelompok produk" />
        <StockSummaryCard label="Mutasi" value={formatNumber(stockMovements.length)} hint="Riwayat stok lokal" />
      </div>
      <div className={cn(
        'rounded-xl border p-4',
        ready
          ? 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-950/30 dark:text-brand-100'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
      )}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/70 text-brand-600 dark:bg-ink-950/40">
            <Icon size={18} />
          </span>
          <div>
            <div className="font-semibold">{ready ? 'Modul tersambung' : 'Modul siap diaktifkan'}</div>
            <p className="mt-1 text-sm opacity-80">
              {ready
                ? 'Menu ini diarahkan ke halaman operasional yang sudah ada di aplikasi.'
                : 'Untuk modul ini, database supplier/pengeluaran detail perlu ditambahkan pada migration berikutnya.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleHeader({
  icon: Icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4 dark:border-ink-800">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
          <Icon size={19} />
        </span>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-brand-600">Admin Module</div>
          <h2 className="mt-0.5 text-xl font-bold leading-tight">{title}</h2>
          <p className="mt-1 text-sm text-ink-500">{description}</p>
        </div>
      </div>
      {action && (
        <Button onClick={onAction} disabled={!onAction} variant={onAction ? 'primary' : 'ghost'}>
          {action}
        </Button>
      )}
    </div>
  );
}

function StockSummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-4',
      tone === 'warning'
        ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
        : 'border-brand-100 bg-brand-50/60 dark:border-brand-500/20 dark:bg-brand-950/25',
    )}>
      <div className={cn(
        'text-xs font-semibold uppercase tracking-wide',
        tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-brand-600 dark:text-brand-300',
      )}>
        {label}
      </div>
      <div className={cn(
        'mt-1 text-2xl font-bold tracking-tight',
        tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-ink-900 dark:text-white',
      )}>
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-500">{hint}</div>
    </div>
  );
}

function AdminShortcut({
  icon: Icon,
  title,
  value,
  detail,
  tone = 'default',
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  detail: string;
  tone?: 'default' | 'warning';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-xl"
    >
      <div
        className={[
          'grid h-10 w-10 place-items-center rounded-xl',
          tone === 'warning'
            ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15'
            : 'bg-brand-50 text-brand-600 dark:bg-brand-950/40',
        ].join(' ')}
      >
        <Icon size={18} />
      </div>
      <div className="mt-3 text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-ink-500">{detail}</div>
    </button>
  );
}

function AdminKpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <span
          className={cn(
            'grid h-8 w-8 place-items-center rounded-lg',
            tone === 'warning' &&
              'bg-amber-50 text-amber-600 dark:bg-amber-500/15',
            tone === 'danger' &&
              'bg-rose-50 text-rose-600 dark:bg-rose-500/15',
            tone === 'default' &&
              'bg-brand-50 text-brand-600 dark:bg-brand-950/40',
          )}
        >
          <Icon size={15} />
        </span>
        {label}
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-ink-500">{hint}</div>
    </Card>
  );
}

function AdminControl({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-200">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-ink-500">{description}</div>
          <button onClick={onClick} className="mt-2 text-xs font-semibold text-brand-600 hover:underline">
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

function roleAdminHint(role: UserRole): string {
  if (role === 'admin' || role === 'manager') return 'Kontrol penuh';
  if (role === 'warehouse') return 'Produk, kategori, stok';
  if (role === 'cashier') return 'Order, pelanggan, shift';
  return 'Katalog pembeli';
}

function productStockStatus(product: Product): Exclude<StockStatusFilter, 'all'> {
  if (!product.track_stock) return 'untracked';
  const qty = Number(product.stock_qty ?? 0);
  if (qty <= 0) return 'empty';
  if (qty <= Number(product.min_stock ?? 0)) return 'low';
  return 'safe';
}

function stockStatusLabel(status: Exclude<StockStatusFilter, 'all'>): string {
  if (status === 'safe') return 'Aman';
  if (status === 'low') return 'Menipis';
  if (status === 'empty') return 'Habis';
  return 'Tidak dilacak';
}

function stockStatusTone(status: Exclude<StockStatusFilter, 'all'>): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'safe') return 'success';
  if (status === 'low') return 'warning';
  if (status === 'empty') return 'danger';
  return 'neutral';
}

function movementLabel(type: StockMovement['type']): string {
  if (type === 'sale') return 'Penjualan / Keluar';
  if (type === 'restock') return 'Pembelian / Masuk';
  if (type === 'adjust') return 'Manual / Penyesuaian';
  return 'Retur / Masuk';
}
