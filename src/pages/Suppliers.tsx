import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from '@/lib/router';
import {
  Building2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  Search,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullPurchases, pullSuppliers } from '@/lib/sync';
import { cn, formatMoney, formatNumber, uuid } from '@/lib/format';
import { hasCapability } from '@/lib/roles';
import type { Supplier } from '@/types';

type StatusFilter = 'all' | 'active' | 'inactive';

interface FormState {
  id?: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  default_term_days: string;
  default_dp_percent: string;
  notes: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  default_term_days: '30',
  default_dp_percent: '20',
  notes: '',
  is_active: true,
};

export function Suppliers() {
  const navigate = useNavigate();
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const currency = store?.currency;
  const canDelete = hasCapability(profile?.role, 'manageUsers');

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (!storeId) return;
    pullSuppliers(storeId);
    pullPurchases(storeId);
  }, [storeId]);

  const suppliers =
    useLiveQuery(() => db.suppliers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const purchases =
    useLiveQuery(() => db.purchases.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  // Rekap nota & sisa utang per supplier — inti dari halaman ini.
  const statsBySupplier = useMemo(() => {
    const map = new Map<string, { count: number; total: number; outstanding: number }>();
    for (const purchase of purchases) {
      if (!purchase.supplier_id || purchase.status === 'canceled') continue;
      const row = map.get(purchase.supplier_id) ?? { count: 0, total: 0, outstanding: 0 };
      row.count += 1;
      row.total += Number(purchase.total);
      row.outstanding += Math.max(0, Number(purchase.total) - Number(purchase.paid_amount));
      map.set(purchase.supplier_id, row);
    }
    return map;
  }, [purchases]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (statusFilter === 'active' && !s.is_active) return false;
        if (statusFilter === 'inactive' && s.is_active) return false;
        if (!needle) return true;
        return [s.name, s.contact_name ?? '', s.phone ?? '', s.email ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, statusFilter, q]);

  const totals = useMemo(() => {
    let outstanding = 0;
    for (const row of statsBySupplier.values()) outstanding += row.outstanding;
    return {
      total: suppliers.length,
      active: suppliers.filter((s) => s.is_active).length,
      outstanding,
    };
  }, [suppliers, statsBySupplier]);

  function startNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  function startEdit(supplier: Supplier) {
    setForm({
      id: supplier.id,
      name: supplier.name,
      contact_name: supplier.contact_name ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      default_term_days: String(supplier.default_term_days ?? 0),
      default_dp_percent: String(supplier.default_dp_percent ?? 0),
      notes: supplier.notes ?? '',
      is_active: supplier.is_active,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Nama supplier wajib diisi.');
      return;
    }
    if (!storeId) return;
    const dp = Number(form.default_dp_percent || 0);
    if (dp < 0 || dp > 100) {
      toast.error('DP default harus antara 0 sampai 100 persen.');
      return;
    }
    setBusy(true);
    try {
      const api = getBackendClient();
      const existing = form.id ? await db.suppliers.get(form.id) : null;
      const row: Supplier = {
        id: form.id ?? uuid(),
        store_id: storeId,
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        default_term_days: Math.max(0, Number(form.default_term_days || 0)),
        default_dp_percent: dp,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      const { error } = await api.from('suppliers').upsert(row);
      if (error) throw error;
      await db.suppliers.put(row);
      toast.success(form.id ? 'Supplier diperbarui.' : 'Supplier ditambahkan.');
      setOpen(false);
      setForm(emptyForm);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan supplier.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(supplier: Supplier) {
    const next = { ...supplier, is_active: !supplier.is_active };
    const { error } = await getBackendClient()
      .from('suppliers')
      .update({ is_active: next.is_active })
      .eq('id', supplier.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.suppliers.put(next);
    toast.success(next.is_active ? 'Supplier diaktifkan.' : 'Supplier dinonaktifkan.');
  }

  async function remove(supplier: Supplier) {
    const stats = statsBySupplier.get(supplier.id);
    if (stats?.count) {
      toast.error(
        `${supplier.name} punya ${stats.count} nota pembelian. Nonaktifkan saja agar riwayat tetap utuh.`,
      );
      return;
    }
    if (!confirm(`Hapus supplier "${supplier.name}"?`)) return;
    const { error } = await getBackendClient().from('suppliers').delete().eq('id', supplier.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await db.suppliers.delete(supplier.id);
    toast.success('Supplier dihapus.');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div>
          <h1 className="text-2xl font-bold">Supplier</h1>
          <p className="text-sm opacity-80">
            {formatNumber(totals.total)} supplier · {formatNumber(totals.active)} aktif · sisa utang{' '}
            {formatMoney(totals.outstanding, currency)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => navigate('/purchases')}
            className="bg-white/10 text-white hover:bg-white/20"
          >
            <ShoppingBag size={16} /> Nota Pembelian
          </Button>
          <Button onClick={startNew} className="bg-white !text-ink-900 hover:bg-white/90">
            <Plus size={16} /> Supplier Baru
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900">
            <Search size={14} className="text-brand-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-w-0 flex-1 bg-transparent focus:outline-none"
              placeholder="Cari nama, kontak, telepon, atau email..."
            />
          </label>
          <div className="flex gap-1 rounded-full bg-ink-100 p-1 text-sm font-semibold dark:bg-ink-800">
            {(['all', 'active', 'inactive'] as StatusFilter[]).map((value) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'rounded-full px-3.5 py-1.5 transition',
                  statusFilter === value
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-600 hover:text-brand-700 dark:text-ink-300',
                )}
              >
                {value === 'all' ? 'Semua' : value === 'active' ? 'Aktif' : 'Nonaktif'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            title="Belum ada supplier"
            description="Tambahkan supplier untuk mulai mencatat pembelian dan termin pembayaran DP."
            action={
              <Button onClick={startNew}>
                <Plus size={16} /> Supplier Baru
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((supplier) => {
            const stats = statsBySupplier.get(supplier.id);
            return (
              <Card key={supplier.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
                    <Building2 size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">{supplier.name}</h3>
                      {!supplier.is_active && <Badge tone="neutral">Nonaktif</Badge>}
                    </div>
                    {supplier.contact_name && (
                      <p className="truncate text-xs text-ink-500">{supplier.contact_name}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-ink-500">
                  {supplier.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={12} /> {supplier.phone}
                    </div>
                  )}
                  {supplier.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={12} /> <span className="truncate">{supplier.email}</span>
                    </div>
                  )}
                  {supplier.address && (
                    <div className="flex items-start gap-2">
                      <MapPin size={12} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{supplier.address}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="brand">DP {formatNumber(supplier.default_dp_percent)}%</Badge>
                  <Badge tone="neutral">
                    {supplier.default_term_days > 0
                      ? `Termin ${formatNumber(supplier.default_term_days)} hari`
                      : 'Tunai'}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-ink-50 p-3 text-xs dark:bg-ink-800/50">
                  <div>
                    <div className="text-ink-500">Nota</div>
                    <div className="mt-0.5 text-sm font-bold">{formatNumber(stats?.count ?? 0)}</div>
                  </div>
                  <div>
                    <div className="text-ink-500">Sisa utang</div>
                    <div
                      className={cn(
                        'mt-0.5 text-sm font-bold',
                        (stats?.outstanding ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600',
                      )}
                    >
                      {formatMoney(stats?.outstanding ?? 0, currency)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3 dark:border-ink-800">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(supplier)}>
                    <Pencil size={12} /> Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => toggleActive(supplier)}>
                    <Power size={12} /> {supplier.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" onClick={() => remove(supplier)}>
                      <Trash2 size={12} className="text-rose-500" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? 'Edit Supplier' : 'Supplier Baru'}
        size="md"
      >
        <div className="space-y-3">
          <Input
            label="Nama supplier"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="PT Sumber Kain"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nama kontak"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              placeholder="Pak Budi"
            />
            <Input
              label="Telepon"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="08xx"
            />
          </div>
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <TextArea
            label="Alamat"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="DP default (%)"
              type="number"
              min={0}
              max={100}
              value={form.default_dp_percent}
              onChange={(e) => setForm({ ...form, default_dp_percent: e.target.value })}
              hint="Dipakai untuk mengisi nota baru otomatis."
            />
            <Input
              label="Termin (hari)"
              type="number"
              min={0}
              value={form.default_term_days}
              onChange={(e) => setForm({ ...form, default_term_days: e.target.value })}
              hint="0 = tunai. Menentukan saran jatuh tempo."
            />
          </div>
          <TextArea
            label="Catatan"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Kesepakatan harga, jadwal produksi, dll."
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            Supplier aktif
          </label>

          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
