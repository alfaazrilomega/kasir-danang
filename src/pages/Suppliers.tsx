// Halaman Supplier: data pemasok, termin, DP default, dan sisa utang.
//
// Perlakuan mata uang mengikuti praktik akuntansi valas yang lazim:
//
//  1. Nota dicatat memakai kurs pada saat transaksi, dan kurs itu DIKUNCI di
//     notanya. Mengubah kurs supplier tidak pernah menggeser nilai nota lama.
//  2. Utang dalam mata uang asing tetap merupakan kewajiban dalam mata uang itu.
//     Jadi sisa utang supplier USD ditampilkan dalam dolar, dihitung per nota
//     memakai kurs notanya sendiri.
//  3. Nilai rupiahnya disajikan dua angka: nilai buku (sesuai kurs nota) dan
//     nilai setara pada kurs hari ini. Selisih keduanya adalah selisih kurs —
//     naik saat rupiah melemah, turun saat menguat.
//
// Nota rupiah milik supplier USD tetap diperlakukan sebagai utang rupiah: tidak
// ada kewajiban dolar di sana, jadi tidak ditampilkan angka dolarnya.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from '@/lib/router';
import {
  Boxes,
  Building2,
  Download,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SupplierCatalogModal } from '@/components/suppliers/SupplierCatalogModal';
import { db } from '@/lib/db';
import { getBackendClient } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { pullPurchases, pullSupplierCatalog, pullSuppliers } from '@/lib/sync';
import { hasCapability } from '@/lib/roles';
import { cn, errorMessage, formatMoney, formatNumber, uuid } from '@/lib/format';
import type { Supplier } from '@/types';

type StatusFilter = 'all' | 'active' | 'inactive';

interface FormState {
  id: string | null;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  exchange_rate: string;
  default_dp_percent: string;
  default_term_days: string;
  notes: string;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  currency: 'IDR',
  exchange_rate: '16000',
  default_dp_percent: '0',
  default_term_days: '0',
  notes: '',
};

interface SupplierStats {
  count: number;
  total: number;
  /** Sisa utang dalam rupiah, sesuai nilai yang tercatat di nota. */
  outstanding: number;
  /** Sisa utang dalam dolar, hanya dari nota yang memang bermata uang USD. */
  outstandingUsd: number;
}

export function Suppliers() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const store = useLiveQuery(() => db.stores.get(storeId), [storeId]);
  const currency = store?.currency;
  const canDelete = hasCapability(profile?.role, 'manageStoreSettings');

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [catalogFor, setCatalogFor] = useState<Supplier | null>(null);

  useEffect(() => {
    if (!storeId) return;
    pullSuppliers(storeId);
    pullPurchases(storeId);
    pullSupplierCatalog(storeId);
  }, [storeId]);

  const suppliers =
    useLiveQuery(() => db.suppliers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const purchases =
    useLiveQuery(() => db.purchases.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  // Rekap nota & sisa utang per supplier — inti dari halaman ini.
  const statsBySupplier = useMemo(() => {
    const map = new Map<string, SupplierStats>();
    for (const purchase of purchases) {
      if (!purchase.supplier_id || purchase.status === 'canceled') continue;
      const row =
        map.get(purchase.supplier_id) ?? { count: 0, total: 0, outstanding: 0, outstandingUsd: 0 };
      const sisa = Math.max(0, Number(purchase.total) - Number(purchase.paid_amount));
      row.count += 1;
      row.total += Number(purchase.total);
      row.outstanding += sisa;

      // Kewajiban dolar hanya lahir dari nota yang memang bermata uang USD, dan
      // besarnya ditentukan kurs nota itu — bukan kurs supplier hari ini.
      const kursNota = Number(purchase.exchange_rate || 0);
      if (purchase.currency === 'USD' && kursNota > 0) row.outstandingUsd += sisa / kursNota;

      map.set(purchase.supplier_id, row);
    }
    return map;
  }, [purchases]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (status === 'active' && !s.is_active) return false;
        if (status === 'inactive' && s.is_active) return false;
        if (!needle) return true;
        return [s.name, s.contact_name, s.phone, s.email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, query, status]);

  /**
   * Sisa utang dalam rupiah yang ditampilkan: berapa yang harus disiapkan
   * KALAU dibayar hari ini.
   *
   * Untuk nota rupiah, itu sama dengan nilai notanya. Untuk nota dolar, yang
   * tersisa adalah kewajiban dolar, jadi dinilai pada kurs supplier saat ini —
   * bukan kurs saat nota dibuat. Nota yang sudah lunas tidak ikut, karena
   * sisanya nol.
   */
  function sisaRupiah(supplier: Supplier, stats: SupplierStats | undefined): number {
    if (!stats) return 0;
    const kurs = Number(supplier.exchange_rate || 0);
    if (supplier.currency === 'USD' && stats.outstandingUsd > 0 && kurs > 0) {
      return stats.outstandingUsd * kurs;
    }
    return stats.outstanding;
  }

  const totals = useMemo(() => {
    let outstanding = 0;
    for (const supplier of suppliers) {
      outstanding += sisaRupiah(supplier, statsBySupplier.get(supplier.id));
    }
    return {
      suppliers: suppliers.length,
      active: suppliers.filter((s) => s.is_active).length,
      outstanding,
    };
  }, [suppliers, statsBySupplier]);

  function startCreate() {
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
      currency: supplier.currency || 'IDR',
      exchange_rate: String(supplier.exchange_rate || 16000),
      default_dp_percent: String(supplier.default_dp_percent ?? 0),
      default_term_days: String(supplier.default_term_days ?? 0),
      notes: supplier.notes ?? '',
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Nama supplier wajib diisi.');
      return;
    }
    const rate = Number(form.exchange_rate || 1);
    if (form.currency === 'USD' && rate <= 0) {
      toast.error('Kurs USD harus lebih dari 0.');
      return;
    }

    setBusy(true);
    try {
      const api = getBackendClient();
      const existing = form.id ? suppliers.find((s) => s.id === form.id) : null;
      const row: Supplier = {
        id: form.id ?? uuid(),
        store_id: storeId,
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        currency: form.currency || 'IDR',
        // Kurs hanya bermakna untuk supplier USD; supplier rupiah selalu 1.
        exchange_rate: form.currency === 'USD' ? rate : 1,
        default_dp_percent: Number(form.default_dp_percent || 0),
        default_term_days: Number(form.default_term_days || 0),
        notes: form.notes.trim() || null,
        is_active: existing?.is_active ?? true,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };

      if (navigator.onLine) {
        const { error } = await api.from('suppliers').upsert(row);
        if (error) throw error;
      }
      await db.suppliers.put(row);
      toast.success(form.id ? 'Supplier diperbarui.' : 'Supplier ditambahkan.');
      setOpen(false);
      setForm(emptyForm);
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyimpan supplier.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(supplier: Supplier) {
    const next = { ...supplier, is_active: !supplier.is_active };
    try {
      if (navigator.onLine) {
        const { error } = await getBackendClient()
          .from('suppliers')
          .update({ is_active: next.is_active })
          .eq('id', supplier.id);
        if (error) throw error;
      }
      await db.suppliers.put(next);
      toast.success(next.is_active ? 'Supplier diaktifkan.' : 'Supplier dinonaktifkan.');
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal mengubah status supplier.'));
    }
  }

  async function remove(supplier: Supplier) {
    const stats = statsBySupplier.get(supplier.id);
    if (stats && stats.count > 0) {
      toast.error(
        `${supplier.name} masih punya ${formatNumber(stats.count)} nota. Nonaktifkan saja supaya riwayatnya utuh.`,
      );
      return;
    }
    if (!window.confirm(`Hapus supplier ${supplier.name}?`)) return;
    try {
      if (navigator.onLine) {
        const { error } = await getBackendClient().from('suppliers').delete().eq('id', supplier.id);
        if (error) throw error;
      }
      await db.suppliers.delete(supplier.id);
      toast.success('Supplier dihapus.');
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menghapus supplier.'));
    }
  }

  async function exportCatalog() {
    const { exportSupplierCatalog } = await import('@/lib/exportUtils');
    const rows = await exportSupplierCatalog();
    if (!rows) toast.error('Belum ada katalog SKU supplier untuk diekspor.');
    else toast.success(`${formatNumber(rows)} baris katalog supplier diekspor.`);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-brand-600 p-6 text-white md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Supplier</h1>
            <p className="text-sm opacity-80">
              {formatNumber(totals.suppliers)} supplier · {formatNumber(totals.active)} aktif · sisa
              utang {formatMoney(totals.outstanding, currency)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="onBrandSoft" onClick={() => navigate('/purchases')}>
              <ShoppingCart size={16} /> Nota Pembelian
            </Button>
            <Button variant="onBrandSoft" onClick={() => void exportCatalog()}>
              <Download size={16} /> Export Katalog
            </Button>
            <Button variant="onBrand" onClick={startCreate}>
              <Plus size={16} /> Supplier Baru
            </Button>
          </div>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[16rem] flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama, kontak, telepon, atau email..."
            />
          </div>
          <div className="flex gap-1.5">
            {(
              [
                ['all', 'Semua'],
                ['active', 'Aktif'],
                ['inactive', 'Nonaktif'],
              ] as [StatusFilter, string][]
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? 'primary' : 'secondary'}
                onClick={() => setStatus(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={<Building2 size={24} />}
            title="Belum ada supplier"
            description="Tambahkan supplier untuk mulai mencatat pembelian dan termin pembayaran DP."
            action={
              <Button onClick={startCreate}>
                <Plus size={16} /> Supplier Baru
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((supplier) => {
            const stats = statsBySupplier.get(supplier.id);
            const sisaUsd = stats?.outstandingUsd ?? 0;
            const kursKini = Number(supplier.exchange_rate || 0);
            // Satu angka rupiah saja: yang harus disiapkan kalau dibayar hari ini.
            const sisa = sisaRupiah(supplier, stats);

            return (
              <Card key={supplier.id} className={cn('p-4', !supplier.is_active && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/40">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{supplier.name}</div>
                    {supplier.contact_name && (
                      <div className="truncate text-xs text-brand-600 dark:text-brand-300">
                        {supplier.contact_name}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs text-ink-500 dark:text-ink-400">
                  {supplier.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone size={12} /> {supplier.phone}
                    </div>
                  )}
                  {supplier.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail size={12} /> <span className="truncate">{supplier.email}</span>
                    </div>
                  )}
                  {supplier.address && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} /> <span className="truncate">{supplier.address}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="brand">DP {formatNumber(supplier.default_dp_percent ?? 0)}%</Badge>
                  <Badge tone="neutral">
                    Termin {formatNumber(supplier.default_term_days ?? 0)} hari
                  </Badge>
                  {supplier.currency === 'USD' ? (
                    <Badge tone="warning">USD · Kurs Rp {formatNumber(kursKini)}</Badge>
                  ) : (
                    <Badge tone="neutral">IDR</Badge>
                  )}
                  {!supplier.is_active && <Badge tone="danger">Nonaktif</Badge>}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-3 text-xs dark:bg-ink-800/50">
                  <div>
                    <div className="text-ink-500">Nota</div>
                    <div className="mt-0.5 text-sm font-bold">{formatNumber(stats?.count ?? 0)}</div>
                    {/* Supplier USD menampilkan dolar di kolom kanan, jadi total
                        rupiahnya ditaruh di sini supaya tetap kelihatan. */}
                    {supplier.currency === 'USD' && (
                      <div
                        className="mt-2 text-[11px] text-ink-500 dark:text-ink-400"
                        title="Yang harus disiapkan kalau utang ini dibayar hari ini. Nota yang sudah lunas tidak dihitung."
                      >
                        IDR = {formatMoney(sisa, currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-ink-500">Sisa utang</div>
                    {sisaUsd > 0 ? (
                      <>
                        {/* Utang valas disajikan dalam mata uang kewajibannya. */}
                        {/* Kewajibannya memang dalam dolar; nilai rupiahnya
                            tampil sekali saja sebagai "IDR =" di kolom kiri. */}
                        <div className="mt-0.5 text-sm font-bold text-amber-600">
                          {formatMoney(sisaUsd, 'USD')}
                        </div>
                        {kursKini > 0 && (
                          <div className="text-[11px] text-ink-500 dark:text-ink-400">
                            pada kurs {formatNumber(kursKini)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        className={cn(
                          'mt-0.5 text-sm font-bold',
                          sisa > 0 ? 'text-amber-600' : 'text-emerald-600',
                        )}
                      >
                        {formatMoney(sisa, currency)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3 dark:border-ink-800">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(supplier)}>
                    <Pencil size={12} /> Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setCatalogFor(supplier)}>
                    <Boxes size={12} /> Katalog
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void toggleActive(supplier)}>
                    <Power size={12} /> {supplier.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" onClick={() => void remove(supplier)}>
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
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Nama supplier"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="PT Sumber Kain"
          />
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
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Input
              label="Alamat"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
              Mata uang transaksi
            </label>
            <select
              className="input"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="IDR">Rupiah (IDR)</option>
              <option value="USD">Dolar AS (USD)</option>
            </select>
          </div>
          {form.currency === 'USD' ? (
            <Input
              label="Kurs Default (1 USD = Rp)"
              type="number"
              min={1}
              value={form.exchange_rate}
              onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
              hint="Dipakai untuk nota BARU. Nota lama tetap memakai kurs saat dibuat."
            />
          ) : (
            <div className="hidden sm:block" />
          )}

          <Input
            label="DP default (%)"
            type="number"
            min={0}
            max={100}
            value={form.default_dp_percent}
            onChange={(e) => setForm({ ...form, default_dp_percent: e.target.value })}
          />
          <Input
            label="Termin (hari)"
            type="number"
            min={0}
            value={form.default_term_days}
            onChange={(e) => setForm({ ...form, default_term_days: e.target.value })}
            hint="Termin & DP default supplier otomatis terisi saat dipilih."
          />
          <div className="sm:col-span-2">
            <Input
              label="Catatan"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Kesepakatan harga, jadwal produksi, dll."
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </Modal>

      <SupplierCatalogModal
        supplier={catalogFor}
        storeId={storeId}
        onClose={() => setCatalogFor(null)}
      />
    </div>
  );
}
