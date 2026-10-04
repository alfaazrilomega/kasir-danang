// Halaman Pengeluaran operasional (opex).
//
// Sebelumnya pengeluaran hanya bisa dicatat sebagai cash_movements 'out' dan
// WAJIB ada shift kasir terbuka, sehingga biaya di luar jam kasir (sewa, gaji,
// listrik) tidak bisa masuk sama sekali. Halaman ini melepas ketergantungan itu
// dan menambahkan kategori, supaya Laporan Laba Rugi punya angka untuk dipotong.
//
// Kalau dibayar tunai dan ada shift terbuka, satu baris cash_movements 'out'
// ikut ditulis agar rekonsiliasi laci tetap akurat. Laporan laba rugi hanya
// membaca tabel expenses, jadi tidak ada dobel hitung.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CalendarDays,
  Database,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { db } from '@/lib/db';
import { useAuth } from '@/stores/auth';
import { getBackendClient } from '@/lib/api';
import { pullExpenses, pullPurchases, pullShifts, pullSuppliers, writeThrough } from '@/lib/sync';
import { cn, formatDate, formatMoney, isUuid, uuid, errorMessage } from '@/lib/format';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  expenseCategoryLabel,
  expenseMethodLabel,
} from '@/lib/expenseCategories';
import { hasCapability } from '@/lib/roles';
import { ImportExportModal } from '@/components/data/ImportExportModal';
import type { CashMovement, Expense, ExpenseCategory, ExpensePaymentMethod } from '@/types';

interface FormState {
  id?: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  // Nota pembelian tempat biaya ini menempel. Biaya susulan (ongkir kontainer,
  // gudang ke toko, kemasan) dipilih di sini supaya masuk HPP barang nota itu.
  purchaseId?: string | null;
  // 'other'/'extra' = baris otomatis dari form nota. Dibawa apa adanya saat
  // disimpan; kalau hilang, simpan ulang nota membuat baris kembar.
  purchaseSlot?: string | null;
}

// Tanggal lokal, bukan UTC: toISOString() di WIB mundur tujuh jam, sehingga
// tengah malam tanggal 1 terbaca sebagai hari terakhir bulan sebelumnya dan
// rentang "bulan ini" dimulai sehari terlalu awal.
function isoLokal(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function todayIso() {
  return isoLokal(new Date());
}

function monthStartIso() {
  const d = new Date();
  return isoLokal(new Date(d.getFullYear(), d.getMonth(), 1));
}

const emptyForm: FormState = {
  category: 'lainnya',
  description: '',
  amount: 0,
  expense_date: todayIso(),
  payment_method: 'cash',
  purchaseId: null,
  purchaseSlot: null,
};

export function Expenses() {
  const { profile, store } = useAuth();
  const storeId = profile?.store_id ?? '';
  const currency = store?.currency ?? 'IDR';
  const canManage = hasCapability(profile?.role, 'manageExpenses');

  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIso);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [open, setOpen] = useState(false);
  const [imporOpen, setImporOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    pullExpenses(storeId);
    pullShifts(storeId);
    // Daftar nota untuk pilihan "Untuk nota PO". Hanya admin yang boleh
    // membaca nota pembelian sekaligus mencatat pengeluaran.
    if (canManage) {
      pullPurchases(storeId);
      pullSuppliers(storeId);
    }
  }, [storeId, canManage]);

  const expenses =
    useLiveQuery(() => db.expenses.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const shifts =
    useLiveQuery(() => db.shifts.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const purchases =
    useLiveQuery(() => db.purchases.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];
  const suppliers =
    useLiveQuery(() => db.suppliers.where('store_id').equals(storeId).toArray(), [storeId]) ?? [];

  const notaById = useMemo(() => new Map(purchases.map((p) => [p.id, p])), [purchases]);
  // Nota terbaru di atas; nota batal tidak ditawarkan kecuali sedang dipakai baris ini.
  const pilihanNota = useMemo(() => {
    const namaSupplier = new Map(suppliers.map((s) => [s.id, s.name]));
    return purchases
      .filter((p) => p.status !== 'canceled' || p.id === form.purchaseId)
      .sort((a, b) => b.order_date.localeCompare(a.order_date))
      .map((p) => ({
        id: p.id,
        // Nomor dan tanggal dulu: di HP label tertutup terpotong sekitar 280px,
        // dan nama pemasok yang paling aman untuk hilang.
        label: [p.invoice_number, formatDate(p.order_date), p.supplier_id ? namaSupplier.get(p.supplier_id) : null]
          .filter(Boolean)
          .join(' · '),
      }));
  }, [purchases, suppliers, form.purchaseId]);
  const notaTerpilih = form.purchaseId ? notaById.get(form.purchaseId) ?? null : null;

  const activeShift = useMemo(() => shifts.find((s) => !s.closed_at) ?? null, [shifts]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return expenses
      .filter((e) => e.expense_date >= from && e.expense_date <= to)
      .filter((e) => (categoryFilter === 'all' ? true : e.category === categoryFilter))
      .filter((e) =>
        !term
          ? true
          : (e.description ?? '').toLowerCase().includes(term) ||
            expenseCategoryLabel(e.category).toLowerCase().includes(term),
      )
      .sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  }, [expenses, from, to, categoryFilter, q]);

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [filtered],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function startNew() {
    setForm({ ...emptyForm, expense_date: todayIso() });
    setOpen(true);
  }

  function startEdit(e: Expense) {
    setForm({
      id: e.id,
      category: e.category,
      description: e.description ?? '',
      amount: Number(e.amount),
      expense_date: e.expense_date,
      payment_method: e.payment_method,
      purchaseId: e.purchase_id ?? null,
      purchaseSlot: e.purchase_cost_slot ?? null,
    });
    setOpen(true);
  }

  async function save() {
    const amount = Number(form.amount);
    if (!storeId) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Nominal pengeluaran harus lebih dari 0.');
      return;
    }
    if (!form.expense_date) {
      toast.error('Tanggal wajib diisi.');
      return;
    }

    setBusy(true);
    try {
      const api = getBackendClient();
      const existing = form.id ? await db.expenses.get(form.id) : null;
      // Tunai dari laci hanya berlaku untuk entri baru saat ada shift terbuka.
      // Shift hasil seed/offline punya id buatan (cth. 'shift-030') yang tidak
      // ada di Postgres; menautkannya membuat baris gagal tersimpan diam-diam,
      // jadi tautan hanya dipakai kalau id-nya UUID sungguhan.
      const candidateShift =
        form.payment_method === 'cash' && activeShift ? activeShift.id : null;
      const linkedShiftId = existing
        ? existing.shift_id
        : isUuid(candidateShift)
          ? candidateShift
          : null;

      const row: Expense = {
        id: form.id ?? uuid(),
        store_id: storeId,
        category: form.category,
        description: form.description.trim() || null,
        amount,
        expense_date: form.expense_date,
        payment_method: form.payment_method,
        shift_id: linkedShiftId,
        created_by: isUuid(profile?.id) ? profile!.id : null,
        created_at: existing?.created_at ?? new Date().toISOString(),
        // Selalu dikirim, termasuk null: baris tanpa kolom ini tersimpan di
        // perangkat tanpa tautan nota, dan lencananya hilang sampai ditarik ulang.
        purchase_id: form.purchaseId || null,
        purchase_cost_slot: form.purchaseId ? form.purchaseSlot ?? null : null,
      };

      const { queued } = await writeThrough('expenses', 'upsert', row);
      await db.expenses.put(row);

      // Cerminkan ke laci kasir supaya rekonsiliasi shift tetap benar.
      // Hanya untuk entri BARU: mengubah entri lama tidak boleh menulis
      // mutasi kas kedua kali.
      // Mutasi kas tetap dicatat memakai shift aktif apa adanya (termasuk shift
      // lokal), karena rekonsiliasi laci berjalan di sisi klien.
      const drawerShiftId = existing ? null : candidateShift;
      if (!existing && drawerShiftId) {
        const movement: CashMovement = {
          id: uuid(),
          store_id: storeId,
          shift_id: drawerShiftId,
          type: 'out',
          amount,
          note: `Pengeluaran: ${expenseCategoryLabel(form.category)}${
            form.description.trim() ? ` — ${form.description.trim()}` : ''
          }`,
          created_at: new Date().toISOString(),
        };
        if (navigator.onLine && isUuid(drawerShiftId)) {
          const { error } = await api.from('cash_movements').insert(movement);
          if (error) throw error;
        }
        await db.cash_movements.put(movement);
      }

      toast.success(
        queued
          ? 'Pengeluaran disimpan lokal. Akan dikirim saat online.'
          : form.id
            ? 'Pengeluaran diperbarui.'
            : 'Pengeluaran dicatat.',
      );
      setOpen(false);
      setForm(emptyForm);
    } catch (e) {
      toast.error(errorMessage(e, 'Gagal menyimpan pengeluaran.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: Expense) {
    // Baris otomatis dari form nota dibuat ulang tiap nota disimpan, jadi hapus
    // di sini bersifat sementara — perlu diberitahukan supaya tidak dikira
    // permanen. Biaya susulan yang ditempel manual terhapus permanen.
    const confirmMessage = e.purchase_cost_slot
      ? `Hapus pengeluaran ${formatMoney(Number(e.amount), currency)}? Angka ini berasal dari nota pembelian dan akan muncul lagi kalau notanya disimpan ulang.`
      : e.purchase_id
        ? `Hapus pengeluaran ${formatMoney(Number(e.amount), currency)}? Biaya ini juga keluar dari HPP barang di nota ${notaById.get(e.purchase_id)?.invoice_number ?? 'pembelian'}.`
        : `Hapus pengeluaran ${formatMoney(Number(e.amount), currency)}?`;
    if (!confirm(confirmMessage)) return;
    try {
      const api = getBackendClient();
      if (navigator.onLine) {
        const { error } = await api.from('expenses').delete().eq('id', e.id);
        if (error) throw error;
      }
      await db.expenses.delete(e.id);
      toast.success('Pengeluaran dihapus.');
    } catch (err) {
      toast.error(errorMessage(err, 'Gagal menghapus.'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-3xl bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-4 text-white">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <Wallet size={22} /> Pengeluaran
          </div>
          <p className="mt-0.5 text-sm text-white/80">
            Biaya operasional toko. Dipotong dari laba kotor di Laporan Laba Rugi.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setImporOpen(true)} variant="onBrandSoft">
              <Database size={16} /> Impor / Ekspor
            </Button>
            <Button onClick={startNew} variant="onBrand">
              <Plus size={16} /> Catat Pengeluaran
            </Button>
          </div>
        )}
      </div>

      <ImportExportModal
        open={imporOpen}
        hanya="pengeluaran"
        storeId={storeId}
        onClose={() => setImporOpen(false)}
        onImported={() => {
          if (storeId) void pullExpenses(storeId);
        }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Total Pengeluaran</div>
          <div className="mt-1 text-2xl font-bold text-rose-600">
            {formatMoney(total, currency)}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">{filtered.length} transaksi</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Kategori Terbesar</div>
          <div className="mt-1 text-lg font-semibold">
            {byCategory.length ? expenseCategoryLabel(byCategory[0][0]) : '—'}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            {byCategory.length ? formatMoney(byCategory[0][1], currency) : 'Belum ada data'}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Shift Aktif</div>
          <div className="mt-1 text-lg font-semibold">
            {activeShift ? 'Terbuka' : 'Tidak ada'}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            {activeShift
              ? 'Pengeluaran tunai otomatis mengurangi laci.'
              : 'Pengeluaran tunai tidak dicatat ke laci.'}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 px-2 py-1.5 dark:border-ink-700">
            <Search size={15} className="text-ink-400" />
            <input
              className="w-48 bg-transparent text-sm focus:outline-none"
              placeholder="Cari keterangan / kategori"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-xl border border-ink-200 bg-white px-2 text-sm dark:border-ink-700 dark:bg-ink-900"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | ExpenseCategory)}
          >
            <option value="all">Semua kategori</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-2 py-1 dark:border-ink-700">
            <CalendarDays size={15} className="text-ink-400" />
            <input
              type="date"
              className="bg-transparent text-sm focus:outline-none"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-ink-400">—</span>
            <input
              type="date"
              className="bg-transparent text-sm focus:outline-none"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {byCategory.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {byCategory.map(([cat, amount]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs dark:bg-ink-800"
              >
                <span className="font-medium">{expenseCategoryLabel(cat)}</span>
                <span className="text-ink-500">{formatMoney(amount, currency)}</span>
              </span>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt size={24} />}
            title="Belum ada pengeluaran"
            description="Catat biaya sewa, gaji, listrik, dan lainnya agar laporan laba rugi akurat."
          />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="pb-2">Tanggal</th>
                  <th className="hidden pb-2 sm:table-cell">Kategori</th>
                  <th className="pb-2">Keterangan</th>
                  <th className="hidden pb-2 lg:table-cell">Metode</th>
                  <th className="pb-2 text-right">Nominal</th>
                  {canManage && <th className="pb-2" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-3 lg:whitespace-nowrap">{e.expense_date}</td>
                    <td className="hidden py-3 sm:table-cell">
                      <Badge>{expenseCategoryLabel(e.category)}</Badge>
                    </td>
                    <td className="py-3 text-ink-600 dark:text-ink-300">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* anywhere: keterangan tanpa spasi (nomor resi, nama gabung)
                            dulu melebarkan tabel 777px di wadah 335px. */}
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {e.description || <span className="text-ink-400">—</span>}
                        </span>
                        {e.purchase_id && e.purchase_cost_slot && (
                          // Penanda supaya biaya dari nota tidak dicatat manual lagi.
                          <Badge tone="info" className="shrink-0">
                            dari nota PO
                          </Badge>
                        )}
                        {e.purchase_id && !e.purchase_cost_slot && (
                          // Biaya susulan: masuk HPP barang di nota ini.
                          <Badge tone="brand" className="min-w-0 [overflow-wrap:anywhere]">
                            nota {notaById.get(e.purchase_id)?.invoice_number ?? 'PO'}
                          </Badge>
                        )}
                      </div>
                      {/* Enam kolom ini 419px di wadah 335px pada layar HP, jadi
                          nominal dan tombolnya terpotong. Kategori dan Metode
                          disembunyikan, isinya ikut di sini. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500 sm:hidden">
                        <Badge>{expenseCategoryLabel(e.category)}</Badge>
                        <span>{expenseMethodLabel(e.payment_method)}</span>
                        {e.shift_id && <span>· dari laci</span>}
                      </div>
                    </td>
                    <td className="hidden py-3 text-xs lg:table-cell">
                      {expenseMethodLabel(e.payment_method)}
                      {e.shift_id && <span className="text-ink-400"> · dari laci</span>}
                    </td>
                    <td className={cn('py-3 text-right font-semibold text-rose-600')}>
                      {formatMoney(Number(e.amount), currency)}
                    </td>
                    {canManage && (
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => startEdit(e)}
                            className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => remove(e)}
                            className="rounded-full p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                            title="Hapus"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-200 dark:border-ink-700">
                  {/* colSpan tetap tidak ikut menyusut saat kolom
                      disembunyikan di layar HP, jadi barisnya melebar 25px
                      melewati wadah. Strukturnya disamakan dengan baris isi. */}
                  <td className="py-3 text-sm font-semibold">Total</td>
                  <td className="hidden py-3 sm:table-cell" />
                  <td className="py-3" />
                  <td className="hidden py-3 lg:table-cell" />
                  <td className="py-3 text-right text-base font-bold text-rose-600">
                    {formatMoney(total, currency)}
                  </td>
                  {canManage && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? 'Edit Pengeluaran' : 'Catat Pengeluaran'}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Kategori</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as ExpenseCategory })
                }
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Tanggal"
              type="date"
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
            />
            <Input
              label={`Nominal (${currency})`}
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium">Metode Bayar</label>
              <select
                className="input"
                value={form.payment_method}
                onChange={(e) =>
                  setForm({ ...form, payment_method: e.target.value as ExpensePaymentMethod })
                }
              >
                {EXPENSE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Input
            label="Keterangan"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="cth. Sewa ruko bulan Agustus"
          />

          {canManage && (
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="pengeluaran-nota">
                Untuk nota PO
              </label>
              {/* Baris otomatis dari form nota dikunci ke notanya: memindahkannya
                  ke nota lain membuat simpan ulang nota asal mencatat biaya kembar. */}
              <select
                id="pengeluaran-nota"
                className="input disabled:cursor-not-allowed disabled:opacity-60"
                value={form.purchaseId ?? ''}
                disabled={!!form.purchaseSlot}
                onChange={(e) => setForm({ ...form, purchaseId: e.target.value || null })}
              >
                <option value="">Bukan biaya nota PO</option>
                {pilihanNota.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              {form.purchaseSlot && (
                <p className="mt-1 text-xs text-ink-500">Terkunci ke nota asalnya karena dibuat dari form nota.</p>
              )}
            </div>
          )}

          {form.purchaseId && !form.purchaseSlot && (
            <p className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100">
              Biaya ini ditempel ke nota {notaTerpilih?.invoice_number ?? 'pembelian'} dan masuk HPP
              barangnya, dibagi sesuai nilai tiap barang. Sisa pelunasan ke supplier tidak berubah.
            </p>
          )}

          {form.id && form.purchaseSlot && (
            // Baris ini akan ditulis ulang oleh nota pembelian, jadi edit di sini
            // hanya sementara sampai notanya disimpan lagi. Field tetap bisa diubah.
            <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
              Pengeluaran ini berasal dari nota pembelian. Perubahan di sini akan tertimpa
              kalau notanya disimpan ulang.
            </p>
          )}

          {!form.id && form.payment_method === 'cash' && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              {activeShift
                ? 'Dibayar tunai saat shift terbuka — laci kasir ikut berkurang otomatis.'
                : 'Tidak ada shift terbuka, jadi pengeluaran ini tidak mengurangi laci kasir. Tetap dihitung di laba rugi.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
