import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from '@/lib/router';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CircleDollarSign,
  Eye,
  PackageCheck,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/dashboard/StatCard';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullInventoryReference, pullPurchases, pullSuppliers, receivePurchase } from '@/lib/sync';
import { cn, formatDate, formatDateTime, formatMoney, formatNumber, uuid } from '@/lib/format';
import { hasCapability } from '@/lib/roles';
import type {
  Purchase,
  PurchaseItem,
  PurchasePayment,
  PurchasePaymentMethod,
  PurchasePaymentType,
  PurchaseStatus,
} from '@/types';

type StatusFilter = 'all' | PurchaseStatus | 'outstanding';

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: 'Draft',
  ordered: 'Dipesan',
  partial: 'Sebagian',
  received: 'Diterima',
  canceled: 'Batal',
};

const STATUS_TONES: Record<PurchaseStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  ordered: 'info',
  partial: 'warning',
  received: 'success',
  canceled: 'danger',
};

const PAYMENT_TYPE_LABELS: Record<PurchasePaymentType, string> = {
  dp: 'DP / Uang Muka',
  settlement: 'Pelunasan',
  other: 'Pembayaran Lain',
};

const PAYMENT_METHOD_LABELS: Record<PurchasePaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-wallet',
  other: 'Lainnya',
};

interface ItemDraft {
  key: string;
  product_id: string;
  name: string;
  sku: string;
  qty: string;
  cost_price: string;
  note: string;
}

interface FormState {
  id?: string;
  supplier_id: string;
  invoice_number: string;
  status: PurchaseStatus;
  order_date: string;
  expected_date: string;
  due_date: string;
  discount: string;
  tax: string;
  other_cost: string;
  dp_percent: string;
  notes: string;
  items: ItemDraft[];
}

function blankItem(): ItemDraft {
  return { key: uuid(), product_id: '', name: '', sku: '', qty: '1', cost_price: '0', note: '' };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    supplier_id: '',
    invoice_number: '',
    status: 'draft',
    order_date: todayIso(),
    expected_date: '',
    due_date: '',
    discount: '0',
    tax: '0',
    other_cost: '0',
    dp_percent: '0',
    notes: '',
    items: [blankItem()],
  };
}

export function Purchases() {
  const navigate = useNavigate();
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const currency = store?.currency;
  const canPay = hasCapability(profile?.role, 'manageUsers');

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Purchase | null>(null);

  useEffect(() => {
    if (!storeId) return;
    pullSuppliers(storeId);
    pullPurchases(storeId);
    pullInventoryReference(storeId);
  }, [storeId]);

  const suppliers =
    useLiveQuery(() => db.suppliers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const purchases =
    useLiveQuery(() => db.purchases.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const items = useLiveQuery(() => db.purchase_items.toArray(), []) ?? [];
  const payments =
    useLiveQuery(() => db.purchase_payments.where('store_id').equals(storeId).toArray(), [storeId]) ??
    [];
  const products =
    useLiveQuery(() => db.products.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const itemsByPurchase = useMemo(() => {
    const map = new Map<string, PurchaseItem[]>();
    for (const item of items) {
      const list = map.get(item.purchase_id) ?? [];
      list.push(item);
      map.set(item.purchase_id, list);
    }
    return map;
  }, [items]);
  const paymentsByPurchase = useMemo(() => {
    const map = new Map<string, PurchasePayment[]>();
    for (const payment of payments) {
      const list = map.get(payment.purchase_id) ?? [];
      list.push(payment);
      map.set(payment.purchase_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1));
    return map;
  }, [payments]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return purchases
      .filter((p) => {
        if (statusFilter === 'outstanding') {
          if (p.status === 'canceled' || outstandingOf(p) <= 0) return false;
        } else if (statusFilter !== 'all' && p.status !== statusFilter) {
          return false;
        }
        if (supplierFilter !== 'all' && p.supplier_id !== supplierFilter) return false;
        if (!needle) return true;
        const supplierName = p.supplier_id ? supplierById.get(p.supplier_id)?.name ?? '' : '';
        return [p.invoice_number, supplierName, p.notes ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (a.order_date < b.order_date ? 1 : a.order_date > b.order_date ? -1 : 0));
  }, [purchases, statusFilter, supplierFilter, q, supplierById]);

  const summary = useMemo(() => {
    const live = purchases.filter((p) => p.status !== 'canceled');
    const total = live.reduce((sum, p) => sum + Number(p.total), 0);
    const paid = live.reduce((sum, p) => sum + Number(p.paid_amount), 0);
    const soon = live.filter((p) => {
      const days = daysUntilDue(p);
      return outstandingOf(p) > 0 && days !== null && days <= 7;
    });
    const overdue = live.filter((p) => {
      const days = daysUntilDue(p);
      return outstandingOf(p) > 0 && days !== null && days < 0;
    });
    return { total, paid, outstanding: total - paid, soon: soon.length, overdue: overdue.length };
  }, [purchases]);

  const detail = detailId ? purchases.find((p) => p.id === detailId) ?? null : null;

  function startNew() {
    setForm(emptyForm());
    setFormOpen(true);
  }

  function startEdit(purchase: Purchase) {
    const rows = itemsByPurchase.get(purchase.id) ?? [];
    setForm({
      id: purchase.id,
      supplier_id: purchase.supplier_id ?? '',
      invoice_number: purchase.invoice_number,
      status: purchase.status,
      order_date: purchase.order_date,
      expected_date: purchase.expected_date ?? '',
      due_date: purchase.due_date ?? '',
      discount: String(purchase.discount ?? 0),
      tax: String(purchase.tax ?? 0),
      other_cost: String(purchase.other_cost ?? 0),
      dp_percent: String(purchase.dp_percent ?? 0),
      notes: purchase.notes ?? '',
      items: rows.length
        ? rows.map((row) => ({
            key: row.id,
            product_id: row.product_id ?? '',
            name: row.name,
            sku: row.sku ?? '',
            qty: String(row.qty),
            cost_price: String(row.cost_price),
            note: row.note ?? '',
          }))
        : [blankItem()],
    });
    setFormOpen(true);
  }

  /** Pilih supplier -> pakai termin & DP default supplier itu. */
  function pickSupplier(supplierId: string) {
    const supplier = supplierById.get(supplierId);
    if (!supplier) {
      setForm((prev) => ({ ...prev, supplier_id: supplierId }));
      return;
    }
    const due = supplier.default_term_days
      ? new Date(new Date(form.order_date || todayIso()).getTime() + supplier.default_term_days * 86400000)
          .toISOString()
          .slice(0, 10)
      : '';
    setForm((prev) => ({
      ...prev,
      supplier_id: supplierId,
      due_date: prev.due_date || due,
      dp_percent: Number(prev.dp_percent) > 0 ? prev.dp_percent : String(supplier.default_dp_percent),
    }));
  }

  function pickProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.key !== key
          ? item
          : {
              ...item,
              product_id: productId,
              name: product?.name ?? item.name,
              sku: product?.sku ?? item.sku,
              cost_price: product ? String(product.cost_price ?? 0) : item.cost_price,
            },
      ),
    }));
  }

  const formTotals = useMemo(() => {
    const subtotal = form.items.reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.cost_price || 0),
      0,
    );
    const total =
      subtotal - Number(form.discount || 0) + Number(form.tax || 0) + Number(form.other_cost || 0);
    const dpAmount = (total * Number(form.dp_percent || 0)) / 100;
    return { subtotal, total, dpAmount, rest: total - dpAmount };
  }, [form]);

  async function save() {
    if (!storeId) return;
    if (!form.invoice_number.trim()) {
      toast.error('Nomor nota wajib diisi.');
      return;
    }
    const validItems = form.items.filter((item) => item.name.trim() && Number(item.qty || 0) > 0);
    if (validItems.length === 0) {
      toast.error('Minimal satu item dengan nama dan qty lebih dari nol.');
      return;
    }
    if (form.due_date && form.due_date < form.order_date) {
      toast.error('Jatuh tempo tidak boleh sebelum tanggal nota.');
      return;
    }

    setBusy(true);
    try {
      const api = getBackendClient();
      const id = form.id ?? uuid();
      const existing = form.id ? purchases.find((p) => p.id === form.id) : null;
      const subtotal = validItems.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.cost_price || 0),
        0,
      );
      const total =
        subtotal - Number(form.discount || 0) + Number(form.tax || 0) + Number(form.other_cost || 0);

      const row: Purchase = {
        id,
        store_id: storeId,
        supplier_id: form.supplier_id || null,
        invoice_number: form.invoice_number.trim(),
        status: form.status,
        order_date: form.order_date,
        expected_date: form.expected_date || null,
        due_date: form.due_date || null,
        subtotal,
        discount: Number(form.discount || 0),
        tax: Number(form.tax || 0),
        other_cost: Number(form.other_cost || 0),
        total,
        // paid_amount dijaga trigger di database; kirim nilai lama supaya tidak mundur.
        paid_amount: existing?.paid_amount ?? 0,
        dp_percent: Number(form.dp_percent || 0),
        received_at: existing?.received_at ?? null,
        notes: form.notes.trim() || null,
        created_by: existing?.created_by ?? profile?.id ?? null,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };

      const { error } = await api.from('purchases').upsert(row);
      if (error) throw error;

      // Ganti seluruh baris item: paling sederhana dan konsisten dengan editor.
      const previous = itemsByPurchase.get(id) ?? [];
      if (previous.length) {
        const { error: delError } = await api
          .from('purchase_items')
          .delete()
          .in('id', previous.map((item) => item.id));
        if (delError) throw delError;
      }
      const itemRows: PurchaseItem[] = validItems.map((item) => ({
        id: uuid(),
        purchase_id: id,
        product_id: item.product_id || null,
        name: item.name.trim(),
        sku: item.sku.trim() || null,
        qty: Number(item.qty || 0),
        received_qty: existing?.received_at ? Number(item.qty || 0) : 0,
        cost_price: Number(item.cost_price || 0),
        subtotal: Number(item.qty || 0) * Number(item.cost_price || 0),
        note: item.note.trim() || null,
      }));
      const { error: itemError } = await api.from('purchase_items').insert(itemRows);
      if (itemError) throw itemError;

      await pullPurchases(storeId);
      toast.success(form.id ? 'Nota pembelian diperbarui.' : 'Nota pembelian dibuat.');
      setFormOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan nota.');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(purchase: Purchase, status: PurchaseStatus) {
    const { error } = await getBackendClient()
      .from('purchases')
      .update({ status })
      .eq('id', purchase.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.purchases.put({ ...purchase, status });
    toast.success(`Status nota jadi "${STATUS_LABELS[status]}".`);
  }

  async function receive(purchase: Purchase) {
    if (purchase.received_at) {
      toast.error('Barang nota ini sudah pernah diterima.');
      return;
    }
    const rows = itemsByPurchase.get(purchase.id) ?? [];
    const tracked = rows.filter((item) => item.product_id);
    if (!confirm(
      `Terima barang nota ${purchase.invoice_number}? Stok ${tracked.length} produk akan bertambah dan mutasi stok tercatat.`,
    )) {
      return;
    }
    setBusy(true);
    const { error } = await receivePurchase(purchase.id, storeId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Barang diterima, stok sudah diperbarui.');
  }

  async function removePurchase(purchase: Purchase) {
    if (Number(purchase.paid_amount) > 0) {
      toast.error('Nota sudah ada pembayaran. Batalkan statusnya saja agar riwayat kas tetap utuh.');
      return;
    }
    if (!confirm(`Hapus nota ${purchase.invoice_number}?`)) return;
    const { error } = await getBackendClient().from('purchases').delete().eq('id', purchase.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.purchases.delete(purchase.id);
    await db.purchase_items.where('purchase_id').equals(purchase.id).delete();
    if (detailId === purchase.id) setDetailId(null);
    toast.success('Nota dihapus.');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div>
          <h1 className="text-2xl font-bold">Pembelian Supplier</h1>
          <p className="text-sm opacity-80">
            Nota pembelian, DP, pelunasan, dan penerimaan barang.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => navigate('/suppliers')}
            className="bg-white/10 text-white hover:bg-white/20"
          >
            <Truck size={16} /> Supplier
          </Button>
          <Button onClick={startNew} className="bg-white !text-ink-900 hover:bg-white/90">
            <Plus size={16} /> Nota Baru
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={CircleDollarSign}
          label="Total Pembelian"
          value={formatMoney(summary.total, currency)}
          hint={`${formatNumber(purchases.length)} nota`}
        />
        <StatCard
          icon={Check}
          label="Sudah Dibayar"
          value={formatMoney(summary.paid, currency)}
          hint={summary.total ? `${((summary.paid / summary.total) * 100).toFixed(0)}% dari total` : '—'}
        />
        <StatCard
          icon={AlertTriangle}
          label="Sisa Utang"
          value={formatMoney(summary.outstanding, currency)}
          hint={summary.overdue ? `${formatNumber(summary.overdue)} nota lewat jatuh tempo` : 'Tidak ada tunggakan lewat tempo'}
        />
        <StatCard
          icon={CalendarClock}
          label="Jatuh Tempo ≤ 7 Hari"
          value={formatNumber(summary.soon)}
          hint="Nota yang perlu segera dilunasi"
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900">
            <Search size={14} className="text-brand-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-w-0 flex-1 bg-transparent focus:outline-none"
              placeholder="Cari nomor nota, supplier, atau catatan..."
            />
          </label>
          <select
            className="input w-auto"
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="all">Semua Supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="input w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">Semua Status</option>
            <option value="outstanding">Masih ada sisa utang</option>
            {(Object.keys(STATUS_LABELS) as PurchaseStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="p-5">
        {filtered.length === 0 ? (
          <EmptyState
            title="Belum ada nota pembelian"
            description="Buat nota saat memesan barang ke supplier, lalu catat DP dan pelunasannya di sini."
            action={
              <Button onClick={startNew}>
                <Plus size={16} /> Nota Baru
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                <tr>
                  <th className="rounded-l-lg px-3 py-2.5">Nota</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Tanggal</th>
                  <th className="px-3 py-2.5">Jatuh Tempo</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5">Progres Bayar</th>
                  <th className="px-3 py-2.5 text-right">Sisa</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="rounded-r-lg px-3 py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((purchase) => {
                  const rest = outstandingOf(purchase);
                  const days = daysUntilDue(purchase);
                  const paidPct = purchase.total
                    ? Math.min(100, (Number(purchase.paid_amount) / Number(purchase.total)) * 100)
                    : 0;
                  return (
                    <tr
                      key={purchase.id}
                      className="border-t border-ink-100 transition-colors hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                    >
                      <td className="px-3 py-3">
                        <div className="font-semibold">{purchase.invoice_number}</div>
                        {purchase.received_at && (
                          <div className="text-xs text-emerald-600">Barang diterima</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {purchase.supplier_id
                          ? supplierById.get(purchase.supplier_id)?.name ?? 'Supplier dihapus'
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-ink-500">{formatDate(purchase.order_date)}</td>
                      <td className="px-3 py-3">
                        {purchase.due_date ? (
                          <div>
                            <div>{formatDate(purchase.due_date)}</div>
                            {rest > 0 && days !== null && (
                              <div
                                className={cn(
                                  'text-xs font-semibold',
                                  days < 0
                                    ? 'text-rose-600'
                                    : days <= 7
                                      ? 'text-amber-600'
                                      : 'text-ink-500',
                                )}
                              >
                                {days < 0
                                  ? `Lewat ${formatNumber(Math.abs(days))} hari`
                                  : days === 0
                                    ? 'Jatuh tempo hari ini'
                                    : `${formatNumber(days)} hari lagi`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(purchase.total, currency)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                paidPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500',
                              )}
                              style={{ width: `${paidPct}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-ink-500">
                            {paidPct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-semibold tabular-nums',
                          rest > 0 ? 'text-amber-600' : 'text-emerald-600',
                        )}
                      >
                        {formatMoney(rest, currency)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_TONES[purchase.status]}>
                          {STATUS_LABELS[purchase.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1.5">
                          {canPay && rest > 0 && purchase.status !== 'canceled' && (
                            <Button size="sm" onClick={() => setPayFor(purchase)}>
                              Bayar
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDetailId(purchase.id)}
                          >
                            <Eye size={12} /> Detail
                          </Button>
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

      {/* ---------- Form nota ---------- */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? 'Edit Nota Pembelian' : 'Nota Pembelian Baru'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                Supplier
              </label>
              <select
                className="input"
                value={form.supplier_id}
                onChange={(e) => pickSupplier(e.target.value)}
              >
                <option value="">— Pilih supplier —</option>
                {suppliers
                  .filter((s) => s.is_active || s.id === form.supplier_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-ink-500">
                Termin & DP default supplier otomatis terisi saat dipilih.
              </p>
            </div>
            <Input
              label="Nomor nota"
              value={form.invoice_number}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              placeholder="PO-2026-001"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Tanggal nota"
              type="date"
              value={form.order_date}
              onChange={(e) => setForm({ ...form, order_date: e.target.value })}
            />
            <Input
              label="Perkiraan barang jadi"
              type="date"
              value={form.expected_date}
              onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
            />
            <Input
              label="Jatuh tempo pelunasan"
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Item pembelian</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setForm({ ...form, items: [...form.items, blankItem()] })}
              >
                <Plus size={12} /> Tambah item
              </Button>
            </div>
            <div className="space-y-2">
              {form.items.map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-ink-100 p-3 dark:border-ink-800"
                >
                  <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_0.7fr_1fr_auto]">
                    <select
                      className="input"
                      value={item.product_id}
                      onChange={(e) => pickProduct(item.key, e.target.value)}
                    >
                      <option value="">— Item manual —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      placeholder="Nama item"
                      value={item.name}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          items: form.items.map((row) =>
                            row.key === item.key ? { ...row, name: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <input
                      className="input"
                      type="number"
                      min={0}
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          items: form.items.map((row) =>
                            row.key === item.key ? { ...row, qty: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <input
                      className="input"
                      type="number"
                      min={0}
                      placeholder="Harga beli"
                      value={item.cost_price}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          items: form.items.map((row) =>
                            row.key === item.key ? { ...row, cost_price: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          items:
                            form.items.length > 1
                              ? form.items.filter((row) => row.key !== item.key)
                              : [blankItem()],
                        })
                      }
                      className="grid h-10 w-10 place-items-center rounded-xl text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      title="Hapus item"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-1.5 text-right text-xs text-ink-500">
                    Subtotal:{' '}
                    <span className="font-semibold text-ink-700 dark:text-ink-200">
                      {formatMoney(Number(item.qty || 0) * Number(item.cost_price || 0), currency)}
                    </span>
                    {!item.product_id && (
                      <span className="ml-2 text-amber-600">
                        Item manual tidak menambah stok saat barang diterima.
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Input
              label="Diskon"
              type="number"
              min={0}
              value={form.discount}
              onChange={(e) => setForm({ ...form, discount: e.target.value })}
            />
            <Input
              label="Pajak"
              type="number"
              min={0}
              value={form.tax}
              onChange={(e) => setForm({ ...form, tax: e.target.value })}
            />
            <Input
              label="Biaya lain"
              type="number"
              min={0}
              value={form.other_cost}
              onChange={(e) => setForm({ ...form, other_cost: e.target.value })}
              hint="Ongkir, packing, dll."
            />
            <Input
              label="DP (%)"
              type="number"
              min={0}
              max={100}
              value={form.dp_percent}
              onChange={(e) => setForm({ ...form, dp_percent: e.target.value })}
            />
          </div>

          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-500/20 dark:bg-brand-950/25">
            <div className="grid gap-2 sm:grid-cols-2">
              <SummaryLine label="Subtotal item" value={formatMoney(formTotals.subtotal, currency)} />
              <SummaryLine
                label="Total nota"
                value={formatMoney(formTotals.total, currency)}
                strong
              />
              <SummaryLine
                label={`DP ${formatNumber(Number(form.dp_percent || 0))}%`}
                value={formatMoney(formTotals.dpAmount, currency)}
              />
              <SummaryLine
                label="Sisa pelunasan"
                value={formatMoney(formTotals.rest, currency)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                Status
              </label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as PurchaseStatus })}
              >
                {(Object.keys(STATUS_LABELS) as PurchaseStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <TextArea
              label="Catatan"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Batal
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan nota'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------- Detail nota ---------- */}
      <Modal
        open={detail !== null}
        onClose={() => setDetailId(null)}
        title={detail ? `Nota ${detail.invoice_number}` : 'Detail Nota'}
        size="lg"
      >
        {detail && (
          <PurchaseDetail
            purchase={detail}
            supplierName={
              detail.supplier_id ? supplierById.get(detail.supplier_id)?.name ?? null : null
            }
            items={itemsByPurchase.get(detail.id) ?? []}
            payments={paymentsByPurchase.get(detail.id) ?? []}
            currency={currency}
            canPay={canPay}
            busy={busy}
            onPay={() => setPayFor(detail)}
            onEdit={() => {
              setDetailId(null);
              startEdit(detail);
            }}
            onReceive={() => receive(detail)}
            onStatus={(status) => changeStatus(detail, status)}
            onDelete={() => removePurchase(detail)}
          />
        )}
      </Modal>

      {/* ---------- Form pembayaran ---------- */}
      <PaymentModal
        purchase={payFor}
        storeId={storeId}
        profileId={profile?.id ?? null}
        currency={currency}
        existing={payFor ? paymentsByPurchase.get(payFor.id) ?? [] : []}
        onClose={() => setPayFor(null)}
      />
    </div>
  );
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-500">{label}</span>
      <span className={cn('tabular-nums', strong ? 'text-base font-bold' : 'font-semibold')}>
        {value}
      </span>
    </div>
  );
}

function PurchaseDetail({
  purchase,
  supplierName,
  items,
  payments,
  currency,
  canPay,
  busy,
  onPay,
  onEdit,
  onReceive,
  onStatus,
  onDelete,
}: {
  purchase: Purchase;
  supplierName: string | null;
  items: PurchaseItem[];
  payments: PurchasePayment[];
  currency?: string;
  canPay: boolean;
  busy: boolean;
  onPay: () => void;
  onEdit: () => void;
  onReceive: () => void;
  onStatus: (status: PurchaseStatus) => void;
  onDelete: () => void;
}) {
  const rest = outstandingOf(purchase);
  const days = daysUntilDue(purchase);
  const dpTarget = (Number(purchase.total) * Number(purchase.dp_percent)) / 100;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONES[purchase.status]}>{STATUS_LABELS[purchase.status]}</Badge>
        {purchase.received_at && <Badge tone="success">Barang diterima</Badge>}
        {rest > 0 && days !== null && days < 0 && (
          <Badge tone="danger">Lewat tempo {formatNumber(Math.abs(days))} hari</Badge>
        )}
        {rest <= 0 && <Badge tone="success">Lunas</Badge>}
        <span className="text-xs text-ink-500">
          {supplierName ?? 'Tanpa supplier'} · {formatDate(purchase.order_date)}
          {purchase.due_date && ` · jatuh tempo ${formatDate(purchase.due_date)}`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailStat label="Total Nota" value={formatMoney(purchase.total, currency)} />
        <DetailStat
          label={`Target DP ${formatNumber(purchase.dp_percent)}%`}
          value={formatMoney(dpTarget, currency)}
        />
        <DetailStat label="Sudah Dibayar" value={formatMoney(purchase.paid_amount, currency)} />
        <DetailStat
          label="Sisa Utang"
          value={formatMoney(rest, currency)}
          tone={rest > 0 ? 'warning' : 'default'}
        />
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Item ({formatNumber(items.length)})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr>
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Diterima</th>
                <th className="py-2 text-right">Harga Beli</th>
                <th className="py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-ink-100 dark:border-ink-800">
                  <td className="py-2">
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-ink-500">
                      {item.sku || '—'}
                      {!item.product_id && ' · item manual'}
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(item.qty)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(item.received_qty)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(item.cost_price, currency)}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatMoney(item.subtotal, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-200 text-sm dark:border-ink-700">
                <td className="py-2 text-ink-500" colSpan={4}>
                  Subtotal
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatMoney(purchase.subtotal, currency)}
                </td>
              </tr>
              {Number(purchase.discount) > 0 && (
                <tr>
                  <td className="py-1 text-ink-500" colSpan={4}>
                    Diskon
                  </td>
                  <td className="py-1 text-right tabular-nums text-rose-600">
                    -{formatMoney(purchase.discount, currency)}
                  </td>
                </tr>
              )}
              {Number(purchase.tax) > 0 && (
                <tr>
                  <td className="py-1 text-ink-500" colSpan={4}>
                    Pajak
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatMoney(purchase.tax, currency)}
                  </td>
                </tr>
              )}
              {Number(purchase.other_cost) > 0 && (
                <tr>
                  <td className="py-1 text-ink-500" colSpan={4}>
                    Biaya lain
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatMoney(purchase.other_cost, currency)}
                  </td>
                </tr>
              )}
              <tr className="border-t border-ink-200 font-bold dark:border-ink-700">
                <td className="py-2" colSpan={4}>
                  Total
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatMoney(purchase.total, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">
          Riwayat Pembayaran ({formatNumber(payments.length)})
        </div>
        {payments.length === 0 ? (
          <p className="text-sm text-ink-500">Belum ada pembayaran untuk nota ini.</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 px-3 py-2 text-sm dark:border-ink-800"
              >
                <Badge tone={payment.type === 'dp' ? 'brand' : 'success'}>
                  {PAYMENT_TYPE_LABELS[payment.type]}
                </Badge>
                <span className="text-xs text-ink-500">
                  {formatDateTime(payment.paid_at)} · {PAYMENT_METHOD_LABELS[payment.method]}
                  {payment.reference && ` · ${payment.reference}`}
                </span>
                <span className="ml-auto font-semibold tabular-nums">
                  {formatMoney(payment.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {purchase.notes && (
        <div className="rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-800/50">
          <div className="text-xs font-semibold text-ink-500">Catatan</div>
          <p className="mt-1">{purchase.notes}</p>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
        <Button variant="ghost" onClick={onDelete}>
          <Trash2 size={14} className="text-rose-500" /> Hapus
        </Button>
        {purchase.status !== 'canceled' && (
          <Button variant="secondary" onClick={() => onStatus('canceled')}>
            Batalkan nota
          </Button>
        )}
        {purchase.status === 'draft' && (
          <Button variant="secondary" onClick={() => onStatus('ordered')}>
            Tandai dipesan
          </Button>
        )}
        <Button variant="secondary" onClick={onEdit}>
          Edit nota
        </Button>
        {!purchase.received_at && purchase.status !== 'canceled' && (
          <Button variant="secondary" onClick={onReceive} disabled={busy}>
            <PackageCheck size={14} /> Terima barang
          </Button>
        )}
        {canPay && rest > 0 && purchase.status !== 'canceled' && (
          <Button onClick={onPay}>
            <CircleDollarSign size={14} /> Catat pembayaran
          </Button>
        )}
      </div>
    </div>
  );
}

function DetailStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3',
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
          : 'border-brand-100 bg-brand-50/60 dark:border-brand-500/20 dark:bg-brand-950/25',
      )}
    >
      <div
        className={cn(
          'text-[11px] font-semibold uppercase tracking-wide',
          tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-brand-600 dark:text-brand-300',
        )}
      >
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function PaymentModal({
  purchase,
  storeId,
  profileId,
  currency,
  existing,
  onClose,
}: {
  purchase: Purchase | null;
  storeId: string;
  profileId: string | null;
  currency?: string;
  existing: PurchasePayment[];
  onClose: () => void;
}) {
  const [type, setType] = useState<PurchasePaymentType>('dp');
  const [method, setMethod] = useState<PurchasePaymentMethod>('transfer');
  const [amount, setAmount] = useState('0');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const rest = purchase ? outstandingOf(purchase) : 0;
  const dpTarget = purchase ? (Number(purchase.total) * Number(purchase.dp_percent)) / 100 : 0;
  const hasDp = existing.some((p) => p.type === 'dp');

  // Saran nominal: DP dulu kalau belum ada, sisanya pelunasan.
  useEffect(() => {
    if (!purchase) return;
    const suggestDp = !hasDp && dpTarget > 0;
    setType(suggestDp ? 'dp' : 'settlement');
    setAmount(String(Math.round(suggestDp ? Math.min(dpTarget, rest) : rest)));
    setPaidAt(todayIso());
    setReference('');
    setNote('');
  }, [purchase, hasDp, dpTarget, rest]);

  async function submit() {
    if (!purchase) return;
    const value = Number(amount || 0);
    if (value <= 0) {
      toast.error('Nominal pembayaran harus lebih dari nol.');
      return;
    }
    if (value > rest + 0.5) {
      toast.error(`Nominal melebihi sisa utang (${formatMoney(rest, currency)}).`);
      return;
    }
    setBusy(true);
    try {
      const row: PurchasePayment = {
        id: uuid(),
        store_id: storeId,
        purchase_id: purchase.id,
        type,
        amount: value,
        method,
        paid_at: new Date(`${paidAt}T12:00:00`).toISOString(),
        reference: reference.trim() || null,
        note: note.trim() || null,
        created_by: profileId,
        created_at: new Date().toISOString(),
      };
      const { error } = await getBackendClient().from('purchase_payments').insert(row);
      if (error) throw error;
      // paid_amount dihitung trigger di server, jadi tarik ulang supaya angka layar akurat.
      await pullPurchases(storeId);
      toast.success(
        value >= rest ? 'Pembayaran dicatat. Nota ini lunas.' : 'Pembayaran dicatat.',
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mencatat pembayaran.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={purchase !== null}
      onClose={onClose}
      title={purchase ? `Bayar Nota ${purchase.invoice_number}` : 'Pembayaran'}
      size="md"
    >
      {purchase && (
        <div className="space-y-3">
          <div className="grid gap-2 rounded-2xl border border-brand-100 bg-brand-50/60 p-3 text-sm dark:border-brand-500/20 dark:bg-brand-950/25 sm:grid-cols-3">
            <SummaryLine label="Total nota" value={formatMoney(purchase.total, currency)} />
            <SummaryLine label="Sudah dibayar" value={formatMoney(purchase.paid_amount, currency)} />
            <SummaryLine label="Sisa" value={formatMoney(rest, currency)} strong />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                Jenis pembayaran
              </label>
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value as PurchasePaymentType)}
              >
                {(Object.keys(PAYMENT_TYPE_LABELS) as PurchasePaymentType[]).map((t) => (
                  <option key={t} value={t}>
                    {PAYMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                Metode
              </label>
              <select
                className="input"
                value={method}
                onChange={(e) => setMethod(e.target.value as PurchasePaymentMethod)}
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PurchasePaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="Nominal"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={
              dpTarget > 0
                ? `Target DP ${formatNumber(purchase.dp_percent)}% = ${formatMoney(dpTarget, currency)}`
                : undefined
            }
          />
          <div className="flex flex-wrap gap-1.5">
            {dpTarget > 0 && !hasDp && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAmount(String(Math.round(Math.min(dpTarget, rest))))}
              >
                DP {formatNumber(purchase.dp_percent)}%
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setAmount(String(Math.round(rest)))}>
              Lunasi sisa
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Tanggal bayar"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
            <Input
              label="Referensi"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="No. transfer / bukti"
            />
          </div>
          <TextArea label="Catatan" value={note} onChange={(e) => setNote(e.target.value)} />

          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Menyimpan...' : 'Catat pembayaran'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function outstandingOf(purchase: Purchase): number {
  return Math.max(0, Number(purchase.total) - Number(purchase.paid_amount));
}

function daysUntilDue(purchase: Purchase): number | null {
  if (!purchase.due_date) return null;
  const due = new Date(`${purchase.due_date}T23:59:59`).getTime();
  const now = Date.now();
  return Math.ceil((due - now) / 86400000);
}
