import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownUp,
  Download,
  Eye,
  Minus,
  Pencil,
  Plus,
  Power,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { exportCustomersCsv } from '@/lib/customerImport';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullLoyalty, pullRecentOrders, pullReference } from '@/lib/sync';
import { cn, formatDate, formatDateTime, formatMoney, uuid } from '@/lib/format';
import { hasCapability } from '@/lib/roles';
import type { Customer, LoyaltyTransaction } from '@/types';

type StatusFilter = 'all' | 'active' | 'inactive';
type SortBy = 'name' | 'newest' | 'spent-desc' | 'points-desc';

interface FormState {
  id?: string;
  name: string;
  phone: string;
  email: string;
  location: string;
  is_active: boolean;
}

const emptyForm: FormState = { name: '', phone: '', email: '', location: '', is_active: true };

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export function Customers() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [detail, setDetail] = useState<Customer | null>(null);
  const canDeleteCustomers = hasCapability(profile?.role, 'manageStoreSettings');

  useEffect(() => {
    if (!storeId) return;
    pullReference(storeId);
    pullRecentOrders(storeId, 500);
    pullLoyalty(storeId);
  }, [storeId]);

  const customers =
    useLiveQuery(() => db.customers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const orderCounts =
    useLiveQuery(async () => {
      const orders = await db.orders.where('store_id').equals(storeId).toArray();
      const map = new Map<string, { count: number; spent: number }>();
      for (const o of orders) {
        if (!o.customer_id) continue;
        const prev = map.get(o.customer_id) ?? { count: 0, spent: 0 };
        prev.count += 1;
        prev.spent += Number(o.total);
        map.set(o.customer_id, prev);
      }
      return map;
    }, [storeId]) ?? new Map<string, { count: number; spent: number }>();

  const filtered = useMemo(() => {
    const list = customers.filter((c) => {
      if (statusFilter === 'active' && !c.is_active) return false;
      if (statusFilter === 'inactive' && c.is_active) return false;
      if (q) {
        const t = q.toLowerCase();
        if (
          !c.name.toLowerCase().includes(t) &&
          !(c.phone ?? '').includes(q) &&
          !(c.email ?? '').toLowerCase().includes(t)
        ) {
          return false;
        }
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return (a.joined_date < b.joined_date ? 1 : -1);
        case 'spent-desc':
          return (orderCounts.get(b.id)?.spent ?? 0) - (orderCounts.get(a.id)?.spent ?? 0);
        case 'points-desc':
          return b.points - a.points;
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [customers, statusFilter, q, sortBy, orderCounts]);

  function startNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  function startEdit(c: Customer) {
    setForm({
      id: c.id,
      name: c.name,
      phone: c.phone ?? '',
      email: c.email ?? '',
      location: c.location ?? '',
      is_active: c.is_active,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Nama wajib diisi.');
      return;
    }
    if (!storeId) return;
    setBusy(true);
    try {
      const api = getBackendClient();
      const existing = form.id ? await db.customers.get(form.id) : null;
      const row: Customer = {
        id: form.id ?? uuid(),
        store_id: storeId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        location: form.location.trim() || null,
        joined_date: existing?.joined_date ?? new Date().toISOString().slice(0, 10),
        is_active: form.is_active,
        points: existing?.points ?? 0,
      };
      if (navigator.onLine) {
        const { error } = await api.from('customers').upsert(row);
        if (error) throw error;
      }
      await db.customers.put(row);
      toast.success(form.id ? 'Pelanggan diperbarui.' : 'Pelanggan ditambahkan.');
      setOpen(false);
      setForm(emptyForm);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: Customer) {
    const next = { ...c, is_active: !c.is_active };
    const api = getBackendClient();
    if (navigator.onLine) {
      const { error } = await api.from('customers').update({ is_active: next.is_active }).eq('id', c.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    await db.customers.put(next);
    toast.success(next.is_active ? 'Diaktifkan.' : 'Dinonaktifkan.');
  }

  async function remove(c: Customer) {
    const stats = orderCounts.get(c.id);
    const hasOrders = (stats?.count ?? 0) > 0;
    const msg = hasOrders
      ? `${c.name} punya ${stats!.count} transaksi. Hapus tetap akan menjaga riwayat order, tapi nama pelanggan jadi tidak terkait lagi. Lanjut?`
      : `Hapus pelanggan "${c.name}"?`;
    if (!confirm(msg)) return;
    const api = getBackendClient();
    if (navigator.onLine) {
      const { error } = await api.from('customers').delete().eq('id', c.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    await db.customers.delete(c.id);
    toast.success('Pelanggan dihapus.');
    if (detail?.id === c.id) setDetail(null);
  }

  const counters = useMemo(() => {
    const active = customers.filter((c) => c.is_active).length;
    return { total: customers.length, active, inactive: customers.length - active };
  }, [customers]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 text-white p-6 md:p-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="opacity-80 text-sm">
            {counters.total} terdaftar · {counters.active} active · {counters.inactive} inactive
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <Search size={14} />
            <input
              className="bg-transparent placeholder:text-white/70 focus:outline-none w-44"
              placeholder="Cari nama / HP / email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            onClick={() => {
              const n = exportCustomersCsv(filtered);
              toast.success(`${n} pelanggan diekspor.`);
            }}
            variant="onBrandSoft"
            disabled={filtered.length === 0}
          >
            <Download size={16} /> Export CSV
          </Button>
          <Button onClick={startNew} variant="onBrand">
            <Plus size={16} /> Add Customer
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            label="Status"
            options={STATUS_TABS}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
          <div className="ml-auto">
            <SortDropdown value={sortBy} onChange={setSortBy} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        {filtered.length === 0 ? (
          <EmptyState
            title={q || statusFilter !== 'all' ? 'Tidak ada pelanggan cocok' : 'Belum ada pelanggan'}
            description={q || statusFilter !== 'all' ? 'Coba ubah filter atau kata kunci.' : 'Tambahkan pelanggan dengan tombol di atas.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500 text-xs">
                <tr>
                  <th className="py-2">Nama</th>
                  <th className="py-2">Phone</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Joined</th>
                  <th className="py-2 text-right">Order</th>
                  <th className="py-2 text-right">Belanja</th>
                  <th className="py-2 text-right">Poin</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const stats = orderCounts.get(c.id) ?? { count: 0, spent: 0 };
                  return (
                    <tr key={c.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-3 font-semibold">{c.name}</td>
                      <td className="py-3">{c.phone ?? '—'}</td>
                      <td className="py-3">{c.email ?? '—'}</td>
                      <td className="py-3">{formatDate(c.joined_date)}</td>
                      <td className="py-3 text-right">{stats.count}</td>
                      <td className="py-3 text-right">{formatMoney(stats.spent, store?.currency)}</td>
                      <td className="py-3 text-right">
                        <span className="inline-flex items-center gap-1 font-semibold text-brand-600">
                          <Sparkles size={12} /> {c.points}
                        </span>
                      </td>
                      <td className="py-3">
                        <Badge tone={c.is_active ? 'success' : 'warning'}>
                          {c.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setDetail(c)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title="Detail"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => startEdit(c)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActive(c)}
                            className={cn(
                              'rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800',
                              !c.is_active && 'text-ink-400',
                            )}
                            title={c.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <Power size={14} />
                          </button>
                          {canDeleteCustomers && (
                            <button
                              onClick={() => remove(c)}
                              className="rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                              title="Hapus"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
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

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Pelanggan' : 'Tambah Pelanggan'}>
        <div className="space-y-3">
          <Input
            label="Nama"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="cth. Theresa Webb"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="08xx..."
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="email@..."
            />
          </div>
          <TextArea
            label="Lokasi"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Opsional"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Aktif (boleh transaksi & dapat poin)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={save} disabled={busy}>Simpan</Button>
          </div>
        </div>
      </Modal>

      <CustomerDetail
        customer={detail}
        onClose={() => setDetail(null)}
        storeId={storeId}
        currency={store?.currency}
        onEdit={(c) => {
          setDetail(null);
          startEdit(c);
        }}
        onDelete={remove}
        canDelete={canDeleteCustomers}
      />
    </div>
  );
}

function CustomerDetail({
  customer, onClose, storeId, currency, onEdit, onDelete, canDelete,
}: {
  customer: Customer | null;
  onClose: () => void;
  storeId: string;
  currency: string | undefined;
  onEdit: (c: Customer) => void;
  onDelete: (c: Customer) => void;
  canDelete: boolean;
}) {
  const orders = useLiveQuery(async () => {
    if (!customer) return [];
    const list = await db.orders.where('store_id').equals(storeId).filter((o) => o.customer_id === customer.id).toArray();
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return list;
  }, [customer?.id, storeId]) ?? [];

  const loyalty = useLiveQuery(async () => {
    if (!customer) return [];
    const list = await db.loyalty_transactions.where('customer_id').equals(customer.id).toArray();
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return list;
  }, [customer?.id]) ?? [];

  const [adjustOpen, setAdjustOpen] = useState(false);

  if (!customer) return null;

  return (
    <>
      <Modal open onClose={onClose} title={customer.name} size="lg">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-1 space-y-3">
            <Field label="Phone" value={customer.phone ?? '—'} />
            <Field label="Email" value={customer.email ?? '—'} />
            <Field label="Lokasi" value={customer.location ?? '—'} />
            <Field label="Joined" value={formatDate(customer.joined_date)} />
            <div className="rounded-xl bg-brand-50 dark:bg-brand-950/40 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-ink-500">Poin Loyalitas</div>
                  <div className="mt-1 inline-flex items-center gap-1 text-2xl font-bold text-brand-600">
                    <Sparkles size={18} /> {customer.points}
                  </div>
                </div>
                <button
                  onClick={() => setAdjustOpen(true)}
                  className="rounded-lg bg-white dark:bg-ink-900 px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-ink-50 dark:hover:bg-ink-800"
                  title="Tambah / kurangi poin manual"
                >
                  +/-
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 pt-2 border-t border-ink-100 dark:border-ink-800">
              <Button variant="secondary" size="sm" onClick={() => onEdit(customer)}>
                <Pencil size={12} /> Edit pelanggan
              </Button>
              {canDelete && (
                <button
                  onClick={() => onDelete(customer)}
                  className="text-xs text-rose-500 hover:text-rose-700 hover:underline self-start"
                >
                  <Trash2 size={11} className="inline mr-0.5" /> Hapus pelanggan
                </button>
              )}
            </div>
          </div>
          <div className="md:col-span-2 space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Riwayat Transaksi</h4>
              {orders.length === 0 ? (
                <p className="text-sm text-ink-500">Belum ada transaksi.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="text-left text-ink-500 text-xs sticky top-0 bg-white dark:bg-ink-900">
                      <tr><th className="py-1">Order</th><th className="py-1">Tanggal</th><th className="py-1 text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} className="border-t border-ink-100 dark:border-ink-800">
                          <td className="py-1.5 font-mono text-xs">{o.order_number}</td>
                          <td className="py-1.5">{formatDateTime(o.created_at)}</td>
                          <td className="py-1.5 text-right">{formatMoney(o.total, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2">Riwayat Poin</h4>
              {loyalty.length === 0 ? (
                <p className="text-sm text-ink-500">Belum ada aktivitas poin.</p>
              ) : (
                <ul className="space-y-1 text-sm max-h-40 overflow-y-auto scrollbar-thin">
                  {loyalty.map((l) => (
                    <li key={l.id} className="flex items-center justify-between border-b border-ink-100 dark:border-ink-800 py-1.5">
                      <span className="text-xs text-ink-500">{formatDateTime(l.created_at)} · {l.reason ?? '—'}</span>
                      <span className={`font-semibold ${l.points_delta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {l.points_delta > 0 ? '+' : ''}{l.points_delta}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <PointAdjustModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        customer={customer}
        storeId={storeId}
      />
    </>
  );
}

function PointAdjustModal({
  open, onClose, customer, storeId,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  storeId: string;
}) {
  const [mode, setMode] = useState<'add' | 'subtract'>('add');
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (amount <= 0) {
      toast.error('Jumlah poin harus lebih dari 0.');
      return;
    }
    const delta = mode === 'add' ? amount : -amount;
    if (mode === 'subtract' && customer.points + delta < 0) {
      toast.error(`Pelanggan hanya punya ${customer.points} poin.`);
      return;
    }
    setBusy(true);
    try {
      const api = getBackendClient();
      const txn: LoyaltyTransaction = {
        id: uuid(),
        store_id: storeId,
        customer_id: customer.id,
        points_delta: delta,
        reason: reason.trim() || (mode === 'add' ? 'Manual adjust (+)' : 'Manual adjust (-)'),
        ref_order_id: null,
        created_at: new Date().toISOString(),
      };
      const newPoints = customer.points + delta;
      if (navigator.onLine) {
        const { error: insErr } = await api.from('loyalty_transactions').insert(txn);
        if (insErr) throw insErr;
        const { error: updErr } = await api.from('customers').update({ points: newPoints }).eq('id', customer.id);
        if (updErr) throw updErr;
      }
      await db.loyalty_transactions.put(txn);
      await db.customers.put({ ...customer, points: newPoints });
      toast.success(`Poin diperbarui (${delta > 0 ? '+' : ''}${delta}).`);
      onClose();
      setAmount(0);
      setReason('');
      setMode('add');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyesuaikan poin.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Sesuaikan Poin — ${customer.name}`}>
      <div className="space-y-3">
        <div className="rounded-xl border border-ink-100 dark:border-ink-800 p-3 flex items-center gap-3">
          <Sparkles className="text-brand-600" size={20} />
          <div className="text-sm">
            Poin saat ini <span className="font-bold text-brand-600">{customer.points}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('add')}
            className={cn(
              'rounded-xl border px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1.5',
              mode === 'add'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'border-ink-200 dark:border-ink-700',
            )}
          >
            <Plus size={14} /> Tambah
          </button>
          <button
            onClick={() => setMode('subtract')}
            className={cn(
              'rounded-xl border px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1.5',
              mode === 'subtract'
                ? 'border-rose-600 bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                : 'border-ink-200 dark:border-ink-700',
            )}
          >
            <Minus size={14} /> Kurangi
          </button>
        </div>
        <Input
          label="Jumlah poin"
          type="number"
          min={1}
          value={amount || ''}
          onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
        />
        <Input
          label="Catatan (opsional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="cth. Birthday bonus, koreksi, redeem hadiah"
        />
        {amount > 0 && (
          <p className="text-xs text-ink-500">
            Setelah disimpan, saldo jadi{' '}
            <span className="font-semibold text-ink-700 dark:text-ink-200">
              {customer.points + (mode === 'add' ? amount : -amount)}
            </span>{' '}
            poin.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy}>Simpan</Button>
        </div>
      </div>
    </Modal>
  );
}

function FilterChips<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-ink-500">{label}:</span>
      <div className="flex gap-1 rounded-full bg-ink-100 dark:bg-ink-800 p-1 text-xs font-semibold">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full px-2.5 py-1',
              value === o.value ? 'bg-white shadow-card dark:bg-ink-700' : 'text-ink-600 dark:text-ink-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortDropdown({ value, onChange }: { value: SortBy; onChange: (v: SortBy) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortBy)}
        className="appearance-none rounded-full border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 pl-7 pr-7 py-1.5 text-xs font-semibold focus:outline-none focus:border-brand-500"
        title="Urutkan"
      >
        <option value="name">Nama A→Z</option>
        <option value="newest">Terbaru bergabung</option>
        <option value="spent-desc">Belanja tertinggi</option>
        <option value="points-desc">Poin terbanyak</option>
      </select>
      <ArrowDownUp size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
