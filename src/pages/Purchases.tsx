import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from '@/lib/router';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CircleDollarSign,
  Copy,
  Download,
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
import {
  pullInventoryReference,
  pullPurchases,
  pullSuppliers,
  receivePurchaseActual,
} from '@/lib/sync';
import { ProductPicker } from '@/components/data/ProductPicker';
import { cn, formatDate, formatDateTime, formatMoney, formatNumber, uuid, isUuid } from '@/lib/format';
import { hasCapability } from '@/lib/roles';
import type {
  Expense,
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
  barcode: string;
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
  currency: string;
  exchange_rate: string;
  discount: string;
  tax: string;
  other_cost: string;
  other_cost_label: string;
  extra_cost: string;
  extra_cost_label: string;
  dp_percent: string;
  notes: string;
  items: ItemDraft[];
}

function blankItem(): ItemDraft {
  return {
    key: uuid(),
    product_id: '',
    name: '',
    sku: '',
    barcode: '',
    qty: '1',
    cost_price: '0',
    note: '',
  };
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
    currency: 'IDR',
    exchange_rate: '16000',
    discount: '0',
    tax: '0',
    other_cost: '0',
    other_cost_label: '',
    extra_cost: '0',
    extra_cost_label: '',
    dp_percent: '0',
    notes: '',
    items: [blankItem()],
  };
}

/** Kunci draft nota yang belum disimpan, dipisah per toko. */
const kunciDraft = (storeId: string) => `kasir:draft-nota:${storeId}`;

/** Formulir dianggap berisi kalau sudah ada yang benar-benar diketik. */
function adaIsi(f: FormState): boolean {
  if (f.invoice_number.trim() || f.supplier_id || f.notes.trim()) return true;
  return f.items.some((i) => i.name.trim() || i.product_id || Number(i.cost_price || 0) > 0);
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
  /**
   * Nota yang sedang diketik tapi belum disimpan.
   *
   * Sebelumnya isi formulir hilang begitu pengguna berpindah menu — dan nota
   * pembelian itu panjang, berisi banyak baris barang. Kehilangan semuanya
   * hanya karena salah klik membuat orang enggan memakai halaman ini.
   */
  const [draftTersimpan, setDraftTersimpan] = useState<FormState | null>(null);

  function buangDraft() {
    try {
      localStorage.removeItem(kunciDraft(storeId));
    } catch {
      // Penyimpanan browser bisa ditolak; draft memang bukan sumber kebenaran.
    }
    setDraftTersimpan(null);
  }
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

  // Kurs supplier saat ini, untuk menilai sisa utang nota dolar.
  const kursSupplier = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of suppliers) map.set(s.id, Number(s.exchange_rate || 0));
    return map;
  }, [suppliers]);
  const sisaHariIni = (p: Purchase) =>
    outstandingTodayOf(p, kursSupplier.get(p.supplier_id ?? '') ?? 0);

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
    // Sisa utang memakai nilai hari ini, sama dasarnya dengan halaman Supplier.
    const outstanding = live.reduce((sum, p) => sum + sisaHariIni(p), 0);
    return { total, paid, outstanding, soon: soon.length, overdue: overdue.length };
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
      currency: purchase.currency || 'IDR',
      exchange_rate: String(purchase.exchange_rate || 16000),
      discount: String(purchase.discount ?? 0),
      tax: String(purchase.tax ?? 0),
      other_cost: String(purchase.other_cost ?? 0),
      other_cost_label: purchase.other_cost_label ?? '',
      extra_cost: String(purchase.extra_cost ?? 0),
      extra_cost_label: purchase.extra_cost_label ?? '',
      dp_percent: String(purchase.dp_percent ?? 0),
      notes: purchase.notes ?? '',
      items: rows.length
        ? rows.map((row) => ({
            key: row.id,
            product_id: row.product_id ?? '',
            name: row.name,
            sku: row.sku ?? '',
            barcode: row.barcode ?? '',
            qty: String(row.qty),
            cost_price: String(
              purchase.currency === 'USD'
                ? row.original_cost_price || (Number(purchase.exchange_rate) > 0 ? row.cost_price / Number(purchase.exchange_rate) : row.cost_price)
                : row.cost_price,
            ),
            note: row.note ?? '',
          }))
        : [blankItem()],
    });
    setFormOpen(true);
  }

  /**
   * Nomor nota salinan yang belum terpakai: PO-2026-001 -> PO-2026-001-2, -3.
   *
   * Akhiran angka pada nomor asalnya sengaja TIDAK dipotong. Nomor nota memang
   * lazim berakhir angka (PO-2026-001), dan memotongnya membuat salinan
   * PO-2026-001 bernomor "PO-2026-2" — nomor milik pesanan yang sama sekali
   * lain.
   */
  function nomorSalinan(asal: string): string {
    const terpakai = new Set(purchases.map((p) => p.invoice_number));
    for (let i = 2; i < 100; i++) {
      const calon = `${asal}-${i}`;
      if (!terpakai.has(calon)) return calon;
    }
    return `${asal}-${Date.now().toString().slice(-4)}`;
  }

  /**
   * Salin nota jadi nota BARU.
   *
   * Client memesan barang yang sama berulang kali ke supplier yang sama, dan
   * mengetik ulang seluruh isinya tiap kali hanya menambah peluang salah ketik.
   *
   * Yang ikut disalin cuma isi pesanannya. Riwayatnya tidak: nomor nota baru,
   * status kembali draft, tanggal hari ini, dan pembayaran maupun penerimaan
   * barang jelas tidak ikut. Kursnya memakai kurs supplier hari ini karena ini
   * pemesanan baru, bukan pengulangan pesanan lama.
   */
  function startDuplicate(purchase: Purchase) {
    const rows = itemsByPurchase.get(purchase.id) ?? [];
    const supplier = suppliers.find((s) => s.id === purchase.supplier_id);
    const kurs = Number(supplier?.exchange_rate || purchase.exchange_rate || 16000);
    const hariIni = new Date().toISOString().slice(0, 10);

    setForm({
      ...emptyForm(),
      supplier_id: purchase.supplier_id ?? '',
      invoice_number: nomorSalinan(purchase.invoice_number),
      status: 'draft',
      order_date: hariIni,
      currency: purchase.currency || 'IDR',
      exchange_rate: String(kurs),
      discount: String(purchase.discount ?? 0),
      tax: String(purchase.tax ?? 0),
      other_cost: String(purchase.other_cost ?? 0),
      other_cost_label: purchase.other_cost_label ?? '',
      extra_cost: String(purchase.extra_cost ?? 0),
      extra_cost_label: purchase.extra_cost_label ?? '',
      dp_percent: String(purchase.dp_percent ?? 0),
      notes: purchase.notes ?? '',
      items: rows.length
        ? rows.map((row, i) => ({
            key: `salin-${i}-${uuid()}`,
            product_id: row.product_id ?? '',
            name: row.name,
            sku: row.sku ?? '',
            barcode: row.barcode ?? '',
            qty: String(row.qty),
            cost_price: String(
              purchase.currency === 'USD'
                ? row.original_cost_price ||
                  (Number(purchase.exchange_rate) > 0
                    ? row.cost_price / Number(purchase.exchange_rate)
                    : row.cost_price)
                : row.cost_price,
            ),
            note: row.note ?? '',
          }))
        : [blankItem()],
    });
    setDetailId(null);
    setFormOpen(true);
    toast.info('Nota disalin. Periksa tanggal, harga, dan kursnya sebelum disimpan.');
  }

  /** Pilih supplier -> pakai termin, DP default, currency, dan kurs supplier itu. */
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
    setForm((prev) => {
      // Kurs supplier hanya diambil untuk nota BARU. Pada nota yang sudah ada,
      // memilih ulang supplier yang sama pernah menarik kurs hari ini dan
      // menimpa kurs historis notanya — nota $100 yang dibukukan Rp 1.600.000
      // berubah jadi Rp 1.800.000 hanya karena kursnya bergerak.
      const notaBaru = !prev.id;
      return {
        ...prev,
        supplier_id: supplierId,
        due_date: prev.due_date || due,
        dp_percent:
          Number(prev.dp_percent) > 0 ? prev.dp_percent : String(supplier.default_dp_percent),
        currency: notaBaru ? supplier.currency || prev.currency || 'IDR' : prev.currency,
        exchange_rate: notaBaru
          ? String(supplier.exchange_rate || prev.exchange_rate || 16000)
          : prev.exchange_rate,
      };
    });
  }

  function pickProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    setForm((prev) => {
      const isUsd = prev.currency === 'USD';
      const rate = Number(prev.exchange_rate || 16000);
      const price = product
        ? isUsd && rate > 0
          ? (product.cost_price / rate).toFixed(2)
          : String(product.cost_price ?? 0)
        : '0';

      return {
        ...prev,
        items: prev.items.map((item) =>
          item.key !== key
            ? item
            : {
                ...item,
                product_id: productId,
                name: product?.name ?? item.name,
                sku: product?.sku ?? item.sku,
                barcode: product?.barcode ?? item.barcode,
                cost_price: price,
              },
        ),
      };
    });
  }

  function matchProductByCode(key: string, code: string, field: 'sku' | 'barcode') {
    const trimmed = code.trim().toLowerCase();
    const found = products.find(
      (p) =>
        (field === 'barcode' && p.barcode?.toLowerCase() === trimmed) ||
        (field === 'sku' && p.sku?.toLowerCase() === trimmed),
    );

    setForm((prev) => {
      const isUsd = prev.currency === 'USD';
      const rate = Number(prev.exchange_rate || 16000);

      return {
        ...prev,
        items: prev.items.map((item) => {
          if (item.key !== key) return item;
          if (found) {
            const price = isUsd && rate > 0 ? (found.cost_price / rate).toFixed(2) : String(found.cost_price);
            return {
              ...item,
              [field]: code,
              product_id: found.id,
              name: found.name,
              sku: found.sku ?? item.sku,
              barcode: found.barcode ?? item.barcode,
              cost_price: price,
            };
          }
          return { ...item, [field]: code };
        }),
      };
    });
  }

  // Nota yang barangnya sudah diterima atau sudah dibayar nilainya sudah
  // terjadi. Kurs dan mata uangnya dikunci di layar, dan ditolak juga oleh
  // database (migrasi 018) supaya tidak bisa ditembus lewat jalur lain.
  const notaBerjalan = form.id ? purchases.find((p) => p.id === form.id) : null;
  const kursTerkunci = Boolean(
    notaBerjalan && (notaBerjalan.received_at || Number(notaBerjalan.paid_amount ?? 0) > 0),
  );

  // Baca draft yang tertinggal saat halaman dibuka.
  useEffect(() => {
    if (!storeId) return;
    try {
      const isi = localStorage.getItem(kunciDraft(storeId));
      if (!isi) return;
      const tersimpan = JSON.parse(isi) as FormState;
      if (adaIsi(tersimpan)) setDraftTersimpan(tersimpan);
    } catch {
      // Draft rusak atau penyimpanan tidak bisa dibaca: abaikan saja.
    }
  }, [storeId]);

  // Simpan terus selama nota BARU sedang diketik. Nota yang sudah ada tidak
  // ikut disimpan: isinya sudah aman di database, dan menyimpan salinannya
  // hanya berisiko menimpa balik dengan versi lama.
  // Status simpan draft terakhir, supaya pengguna tahu isian panjangnya aman.
  const [draftStatus, setDraftStatus] = useState<{ at: Date; ok: boolean } | null>(null);
  // Nota yang sedang diterima; jumlah aktual per baris diisi di dialog.
  const [receiveFor, setReceiveFor] = useState<Purchase | null>(null);
  useEffect(() => {
    if (!storeId || !formOpen || form.id) return;
    if (!adaIsi(form)) {
      setDraftStatus(null);
      return;
    }
    try {
      localStorage.setItem(kunciDraft(storeId), JSON.stringify(form));
      setDraftStatus({ at: new Date(), ok: true });
    } catch {
      // Kuota penuh atau mode privat: draft tidak tersimpan. Pengguna diberi
      // tahu supaya tidak mengandalkannya.
      setDraftStatus({ at: new Date(), ok: false });
    }
  }, [form, formOpen, storeId]);

  // Jumlah barang di nota, dalam pcs. Dipisah dari nilai rupiah supaya
  // pengecekan jumlah pesanan tidak perlu menghitung dari tiap baris.
  const totalQty = useMemo(
    () => form.items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    [form.items],
  );

  const formTotals = useMemo(() => {
    const isUsd = form.currency === 'USD';
    const rate = Number(form.exchange_rate || 16000);

    const subtotal = form.items.reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.cost_price || 0),
      0,
    );
    const total =
      subtotal -
      Number(form.discount || 0) +
      Number(form.tax || 0) +
      Number(form.other_cost || 0) +
      Number(form.extra_cost || 0);
    // DP dihitung dari nilai barang (subtotal), bukan dari total nota — client
    // memesan "100jt dp 20%" maksudnya 20jt dari nilai barangnya, pajak dan
    // biaya lain baru masuk hitungan di sisa pelunasan.
    const dpAmount = (subtotal * Number(form.dp_percent || 0)) / 100;

    const rest = total - dpAmount;
    const keIdr = (n: number) => (isUsd ? n * rate : n);

    return {
      subtotal,
      total,
      dpAmount,
      rest,
      isUsd,
      totalIdr: keIdr(total),
      subtotalIdr: keIdr(subtotal),
      dpAmountIdr: keIdr(dpAmount),
      restIdr: keIdr(rest),
    };
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

    const isUsd = form.currency === 'USD';
    const rate = Number(form.exchange_rate || 16000);
    if (isUsd && rate <= 0) {
      toast.error('Kurs USD harus lebih dari 0.');
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
        subtotal -
        Number(form.discount || 0) +
        Number(form.tax || 0) +
        Number(form.other_cost || 0) +
        Number(form.extra_cost || 0);

      // Angka total dalam IDR untuk pembukuan
      const totalInIdr = isUsd ? total * rate : total;
      const subtotalInIdr = isUsd ? subtotal * rate : subtotal;
      const discountInIdr = isUsd ? Number(form.discount || 0) * rate : Number(form.discount || 0);
      const taxInIdr = isUsd ? Number(form.tax || 0) * rate : Number(form.tax || 0);
      const otherCostInIdr = isUsd ? Number(form.other_cost || 0) * rate : Number(form.other_cost || 0);
      const extraCostInIdr = isUsd ? Number(form.extra_cost || 0) * rate : Number(form.extra_cost || 0);

      const row: Purchase = {
        id,
        store_id: storeId,
        supplier_id: form.supplier_id || null,
        invoice_number: form.invoice_number.trim(),
        status: form.status,
        order_date: form.order_date,
        expected_date: form.expected_date || null,
        due_date: form.due_date || null,
        subtotal: subtotalInIdr,
        discount: discountInIdr,
        tax: taxInIdr,
        other_cost: otherCostInIdr,
        other_cost_label: form.other_cost_label.trim() || null,
        extra_cost: extraCostInIdr,
        extra_cost_label: form.extra_cost_label.trim() || null,
        total: totalInIdr,
        currency: form.currency || 'IDR',
        exchange_rate: isUsd ? rate : 1,
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
      const itemRows: PurchaseItem[] = validItems.map((item) => {
        const itemPrice = Number(item.cost_price || 0);
        const itemPriceIdr = isUsd ? itemPrice * rate : itemPrice;

        return {
          id: uuid(),
          purchase_id: id,
          product_id: item.product_id || null,
          name: item.name.trim(),
          sku: item.sku.trim() || null,
          barcode: item.barcode.trim() || null,
          qty: Number(item.qty || 0),
          received_qty: existing?.received_at ? Number(item.qty || 0) : 0,
          cost_price: itemPriceIdr,
          original_cost_price: itemPrice,
          currency: form.currency || 'IDR',
          subtotal: Number(item.qty || 0) * itemPriceIdr,
          note: item.note.trim() || null,
        };
      });
      const { error: itemError } = await api.from('purchase_items').insert(itemRows);
      if (itemError) throw itemError;

      await pullPurchases(storeId);
      toast.success(form.id ? 'Nota pembelian diperbarui.' : 'Nota pembelian dibuat.');
      buangDraft();
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

  function receive(purchase: Purchase) {
    if (purchase.received_at) {
      toast.error('Barang nota ini sudah pernah diterima.');
      return;
    }
    setDetailId(null);
    setReceiveFor(purchase);
  }

  async function confirmReceive(purchase: Purchase, actual: { id: string; qty: number }[]) {
    const rows = itemsByPurchase.get(purchase.id) ?? [];
    const beda = actual.some((a) => {
      const row = rows.find((r) => r.id === a.id);
      return !!row && Number(row.qty) !== a.qty;
    });
    setBusy(true);
    const { error } = await receivePurchaseActual(purchase.id, storeId, actual);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReceiveFor(null);
    toast.success(
      beda
        ? 'Barang diterima dengan jumlah aktual. Nilai nota dan sisa pelunasan sudah disesuaikan.'
        : 'Barang diterima, stok sudah diperbarui.',
    );
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
            variant="onBrandSoft"
          >
            <Truck size={16} /> Supplier
          </Button>
          <Button
            onClick={async () => {
              const { exportPurchasesBySKU } = await import('@/lib/exportUtils');
              const n = await exportPurchasesBySKU();
              toast.success(`${n} baris data PO diekspor berdasarkan SKU.`);
            }}
            variant="onBrandSoft"
          >
            <Download size={16} /> Export CSV
          </Button>
          <Button onClick={startNew} variant="onBrand">
            <Plus size={16} /> Nota Baru
          </Button>
        </div>
      </div>

      {/* Draft yang tertinggal ditawarkan, bukan dibuka paksa: pengguna yang
          menentukan apakah masih dibutuhkan. */}
      {draftTersimpan && !formOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="text-sm text-amber-900 dark:text-amber-100">
            <div className="font-semibold">Ada nota yang belum sempat disimpan</div>
            <div className="text-xs">
              {draftTersimpan.invoice_number.trim() || '(nomor nota belum diisi)'} ·{' '}
              {draftTersimpan.items.filter((i) => i.name.trim() || i.product_id).length} baris barang
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                buangDraft();
                toast.info('Draft nota dibuang.');
              }}
            >
              Buang
            </Button>
            <Button
              onClick={() => {
                setForm(draftTersimpan);
                setFormOpen(true);
              }}
            >
              Lanjutkan
            </Button>
          </div>
        </div>
      )}

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
                  const restUsd = outstandingUsdOf(purchase);
                  const restToday = sisaHariIni(purchase);
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
                        {restUsd > 0 ? (
                          <>
                            <div>{formatMoney(restUsd, 'USD')}</div>
                            <div className="text-[11px] font-normal text-ink-500 dark:text-ink-400">
                              {formatMoney(restToday, currency)}
                            </div>
                          </>
                        ) : (
                          formatMoney(rest, currency)
                        )}
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
        size="xl"
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                Mata Uang Transaksi
              </label>
              <select
                className="input"
                value={form.currency}
                disabled={kursTerkunci}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="IDR">Rupiah (IDR)</option>
                <option value="USD">Dolar AS (USD)</option>
              </select>
            </div>
            {form.currency === 'USD' ? (
              <Input
                label="Kurs Transaksi (1 USD = Rp)"
                type="number"
                min={1}
                value={form.exchange_rate}
                disabled={kursTerkunci}
                onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })}
                hint={
                  kursTerkunci
                    ? 'Terkunci: barang sudah diterima atau sudah ada pembayaran, jadi nilai notanya sudah terjadi.'
                    : 'Dikonversi otomatis ke HPP stok rupiah.'
                }
              />
            ) : (
              <div className="hidden sm:block" />
            )}
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
              <div>
                <span className="text-sm font-semibold">Item pembelian</span>
                <span className="ml-2 text-xs text-ink-500">
                  (Ketik SKU atau scan Barcode untuk deteksi produk otomatis)
                </span>
              </div>
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
                  {/* Baris 1: produk selebar penuh supaya nama & SKU terbaca utuh
                      (client: "nama produk tayang tidak ke-skip"). Baris 2: rinciannya. */}
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1fr)_auto]">
                    <ProductPicker
                      className="sm:col-span-5"
                      products={products}
                      value={item.product_id}
                      onChange={(id) => pickProduct(item.key, id)}
                      excludeIds={form.items
                        .filter((row) => row.key !== item.key && row.product_id)
                        .map((row) => row.product_id)}
                      emptyLabel="— Item manual (tanpa produk) —"
                    />
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
                      placeholder="SKU"
                      value={item.sku}
                      onChange={(e) => matchProductByCode(item.key, e.target.value, 'sku')}
                    />
                    <input
                      className="input"
                      placeholder="Barcode"
                      value={item.barcode}
                      onChange={(e) => matchProductByCode(item.key, e.target.value, 'barcode')}
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
                      step="0.01"
                      placeholder={`Harga (${form.currency})`}
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
                      className="grid h-10 w-10 place-items-center rounded-xl text-ink-400 hover:bg-rose-50 hover:text-rose-600 sm:col-start-6 sm:row-start-1 dark:hover:bg-rose-500/10"
                      title="Hapus item"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
                    <div>
                      {form.currency === 'USD' && (
                        <span className="font-semibold text-brand-600 dark:text-brand-400">
                          HPP Stok: Rp{' '}
                          {formatNumber(
                            Math.round(Number(item.cost_price || 0) * Number(form.exchange_rate || 16000)),
                          )}
                          /item
                        </span>
                      )}
                      {!item.product_id && (
                        <span className="ml-2 text-amber-600">
                          Item manual tidak menambah stok saat barang diterima.
                        </span>
                      )}
                    </div>
                    <div>
                      Subtotal:{' '}
                      <span className="font-semibold text-ink-700 dark:text-ink-200">
                        {form.currency === 'USD'
                          ? `$${(Number(item.qty || 0) * Number(item.cost_price || 0)).toFixed(2)} (Rp ${formatNumber(
                              Math.round(
                                Number(item.qty || 0) *
                                  Number(item.cost_price || 0) *
                                  Number(form.exchange_rate || 16000),
                              ),
                            )})`
                          : formatMoney(
                              Number(item.qty || 0) * Number(item.cost_price || 0),
                              currency,
                            )}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
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
              label="DP (%)"
              type="number"
              min={0}
              max={100}
              value={form.dp_percent}
              onChange={(e) => setForm({ ...form, dp_percent: e.target.value })}
            />
          </div>

          {/* Dua baris biaya tambahan terpisah, masing-masing bisa diberi nama
              sendiri (mis. "Ongkir" dan "Bea masuk") — client minta pemisahan
              ini supaya nota tidak menumpuk semua biaya jadi satu angka buta. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Biaya lain"
              type="number"
              min={0}
              value={form.other_cost}
              onChange={(e) => setForm({ ...form, other_cost: e.target.value })}
              hint="Ongkir, packing, dll."
            />
            <Input
              label="Nama biaya lain"
              value={form.other_cost_label}
              onChange={(e) => setForm({ ...form, other_cost_label: e.target.value })}
              placeholder="Ongkir"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Biaya tambahan"
              type="number"
              min={0}
              value={form.extra_cost}
              onChange={(e) => setForm({ ...form, extra_cost: e.target.value })}
              hint="Bea masuk, asuransi, dll."
            />
            <Input
              label="Nama biaya tambahan"
              value={form.extra_cost_label}
              onChange={(e) => setForm({ ...form, extra_cost_label: e.target.value })}
              placeholder="Bea masuk"
            />
          </div>

          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-500/20 dark:bg-brand-950/25">
            {/* Nota dalam USD selalu ditampilkan berikut nilai rupiahnya. Yang
                dibayar supplier memang dolar, tapi yang masuk pembukuan rupiah
                — menyembunyikan salah satunya memaksa orang menghitung sendiri
                di kepala tiap kali membuka nota. */}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="border-b border-brand-100 pb-2 dark:border-brand-500/20 sm:col-span-2">
                <SummaryLine label="Total qty" value={`${formatNumber(totalQty)} pcs`} />
              </div>
              {/* Baris utama memakai mata uang NOTA (form.currency), bukan mata
                  uang toko — nota USD ditulis dalam dolar, baris kedua di
                  bawahnya baru padanan rupiahnya. */}
              <SummaryLine
                label="Subtotal harga"
                value={formatMoney(formTotals.subtotal, form.currency)}
                secondary={
                  formTotals.isUsd ? formatMoney(formTotals.subtotalIdr, 'IDR') : undefined
                }
              />
              <SummaryLine
                label="Total nota"
                value={formatMoney(formTotals.total, form.currency)}
                secondary={formTotals.isUsd ? formatMoney(formTotals.totalIdr, 'IDR') : undefined}
                strong
              />
              <SummaryLine
                label={`DP ${formatNumber(Number(form.dp_percent || 0))}% dari nilai barang`}
                value={formatMoney(formTotals.dpAmount, form.currency)}
                secondary={
                  formTotals.isUsd ? formatMoney(formTotals.dpAmountIdr, 'IDR') : undefined
                }
              />
              <SummaryLine
                label="Sisa pelunasan"
                value={formatMoney(formTotals.rest, form.currency)}
                secondary={formTotals.isUsd ? formatMoney(formTotals.restIdr, 'IDR') : undefined}
              />
            </div>
            {formTotals.isUsd && (
              <p className="mt-2 text-[11px] text-ink-500 dark:text-ink-400">
                Nilai rupiah dihitung pada kurs nota ini,{' '}
                {formatMoney(Number(form.exchange_rate || 0), 'IDR')} per USD.
              </p>
            )}
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
            {!form.id && draftStatus && (
              <span
                className={`mr-auto self-center text-xs ${draftStatus.ok ? 'text-ink-500' : 'text-rose-600'}`}
              >
                {draftStatus.ok
                  ? `Draft tersimpan otomatis · ${draftStatus.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'Draft gagal tersimpan di perangkat ini. Simpan nota sebelum menutup.'}
              </span>
            )}
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Batal
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan nota'}
            </Button>
          </div>
        </div>
      </Modal>

      <ReceiveDialog
        purchase={receiveFor}
        items={receiveFor ? itemsByPurchase.get(receiveFor.id) ?? [] : []}
        busy={busy}
        onClose={() => setReceiveFor(null)}
        onConfirm={(actual) => {
          if (receiveFor) void confirmReceive(receiveFor, actual);
        }}
      />

      {/* ---------- Detail nota ---------- */}
      <Modal
        open={detail !== null}
        onClose={() => setDetailId(null)}
        title={detail ? `Nota ${detail.invoice_number}` : 'Detail Nota'}
        size="xl"
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
            onDuplicate={() => startDuplicate(detail)}
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

function SummaryLine({
  label,
  value,
  secondary,
  strong,
}: {
  label: string;
  value: string;
  /** Nilai yang sama dalam rupiah, untuk nota berkurs. */
  secondary?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="text-right">
        <span
          className={cn('block tabular-nums', strong ? 'text-base font-bold' : 'font-semibold')}
        >
          {value}
        </span>
        {secondary && (
          <span className="block text-xs tabular-nums text-ink-500 dark:text-ink-400">
            {secondary}
          </span>
        )}
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
  onDuplicate,
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
  onDuplicate: () => void;
  onReceive: () => void;
  onStatus: (status: PurchaseStatus) => void;
  onDelete: () => void;
}) {
  const rest = outstandingOf(purchase);
  const days = daysUntilDue(purchase);
  // DP dihitung dari nilai barang (subtotal), sama seperti di formulir —
  // supaya angkanya tidak berbeda antara formulir dan detail nota.
  const dpTarget = (Number(purchase.subtotal) * Number(purchase.dp_percent)) / 100;

  // Nilai tersimpan selalu rupiah. Untuk nota USD, padanan dolarnya dihitung
  // dari kurs NOTA ini (bukan kurs supplier hari ini), supaya angka nota lama
  // tidak ikut bergeser saat kurs supplier berubah.
  const isUsd = purchase.currency === 'USD';
  const kursNota = Number(purchase.exchange_rate) > 0 ? Number(purchase.exchange_rate) : 1;
  const keDolar = (nilaiRupiah: number) => nilaiRupiah / kursNota;

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
        <DetailStat
          label="Total Nota"
          value={isUsd ? formatMoney(keDolar(Number(purchase.total)), 'USD') : formatMoney(purchase.total, currency)}
          secondary={isUsd ? formatMoney(purchase.total, 'IDR') : undefined}
        />
        <DetailStat
          label={`Target DP ${formatNumber(purchase.dp_percent)}% dari nilai barang`}
          value={isUsd ? formatMoney(keDolar(dpTarget), 'USD') : formatMoney(dpTarget, currency)}
          secondary={isUsd ? formatMoney(dpTarget, 'IDR') : undefined}
        />
        <DetailStat
          label="Sudah Dibayar"
          value={
            isUsd
              ? formatMoney(keDolar(Number(purchase.paid_amount)), 'USD')
              : formatMoney(purchase.paid_amount, currency)
          }
          secondary={isUsd ? formatMoney(purchase.paid_amount, 'IDR') : undefined}
        />
        <DetailStat
          label="Sisa Utang"
          value={isUsd ? formatMoney(keDolar(rest), 'USD') : formatMoney(rest, currency)}
          secondary={isUsd ? formatMoney(rest, 'IDR') : undefined}
          tone={rest > 0 ? 'warning' : 'default'}
        />
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">
          Item ({formatNumber(items.length)}) · Total qty{' '}
          {formatNumber(items.reduce((sum, it) => sum + Number(it.qty || 0), 0))} pcs
        </div>
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
                    {purchase.other_cost_label?.trim() || 'Biaya lain'}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatMoney(purchase.other_cost, currency)}
                  </td>
                </tr>
              )}
              {Number(purchase.extra_cost) > 0 && (
                <tr>
                  <td className="py-1 text-ink-500" colSpan={4}>
                    {purchase.extra_cost_label?.trim() || 'Biaya tambahan'}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatMoney(purchase.extra_cost ?? 0, currency)}
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
        <Button variant="secondary" onClick={onDuplicate}>
          <Copy size={14} /> Duplikat nota
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
  secondary,
  tone = 'default',
}: {
  label: string;
  value: string;
  /** Padanan rupiah, untuk nota berkurs (USD). */
  secondary?: string;
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
      {secondary && (
        <div className="text-xs font-normal tabular-nums text-ink-500 dark:text-ink-400">
          {secondary}
        </div>
      )}
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
  /** Biaya jasa pihak ketiga untuk mengirim uangnya, bukan harga barang. */
  const [adminFee, setAdminFee] = useState('0');
  const [busy, setBusy] = useState(false);

  const rest = purchase ? outstandingOf(purchase) : 0;
  // DP dihitung dari nilai barang (subtotal), sama seperti formulir dan detail.
  const dpTarget = purchase ? (Number(purchase.subtotal) * Number(purchase.dp_percent)) / 100 : 0;
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
    setAdminFee('0');
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
        created_by: isUuid(profileId) ? profileId : null,
        created_at: new Date().toISOString(),
      };
      const { error } = await getBackendClient().from('purchase_payments').insert(row);
      if (error) throw error;

      // Biaya jasa pengiriman uang dicatat sebagai pengeluaran usaha, BUKAN
      // ditambahkan ke nota. Menambahkannya ke nota akan menaikkan harga modal
      // barang yang harganya tidak berubah — HPP jadi salah dan laba kotor ikut
      // salah. Biaya ini muncul karena memindahkan uang, bukan karena barang,
      // jadi tempatnya di pengeluaran operasional.
      const fee = Number(adminFee || 0);
      if (fee > 0) {
        const biaya: Expense = {
          id: uuid(),
          store_id: storeId,
          category: 'biaya_admin',
          description: `Biaya admin pembayaran nota ${purchase.invoice_number}`,
          amount: fee,
          expense_date: paidAt,
          payment_method: method,
          shift_id: null,
          created_by: isUuid(profileId) ? profileId : null,
          created_at: new Date().toISOString(),
        };
        const { error: feeError } = await getBackendClient().from('expenses').insert(biaya);
        if (feeError) {
          // Pembayarannya sendiri sudah tersimpan; jangan buat seolah gagal.
          toast.error(`Pembayaran tersimpan, tapi biaya admin gagal dicatat: ${feeError.message}`);
        } else {
          await db.expenses.put(biaya);
        }
      }

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
            label={`Nominal (${currency || 'IDR'})`}
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={
              // Pembayaran dicatat dalam rupiah, sama seperti seluruh nilai nota.
              // Untuk nota USD, kalimat pertama menegaskan satuannya supaya
              // kasir tidak salah ketik angka dolar di kolom rupiah, dan
              // padanan dolarnya ikut ditampilkan supaya bisa dicocokkan
              // dengan invoice supplier.
              [
                purchase.currency === 'USD' ? 'Nominal dicatat dalam Rupiah, bukan dolar.' : '',
                dpTarget > 0
                  ? `Target DP ${formatNumber(purchase.dp_percent)}% dari nilai barang = ${formatMoney(dpTarget, currency)}`
                  : '',
                purchase.currency === 'USD' && Number(amount || 0) > 0
                  ? `≈ ${formatMoney(Number(amount || 0) / noteRate(purchase), 'USD')} (kurs ${formatNumber(noteRate(purchase))})`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ') || undefined
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
          <Input
            id="input-biaya-admin"
            label="Biaya admin pengiriman uang (opsional)"
            type="number"
            min={0}
            value={adminFee}
            onChange={(e) => setAdminFee(e.target.value)}
            placeholder="0"
            hint="Biaya jasa pihak ketiga untuk mengirim uang ke supplier. Dicatat sebagai pengeluaran 'Biaya Admin Pembayaran', tidak menambah nilai nota — barangnya tidak jadi lebih mahal."
          />
          {Number(adminFee || 0) > 0 && (
            <div className="rounded-xl border border-ink-200 px-3 py-2 text-xs text-ink-600 dark:border-ink-700 dark:text-ink-300">
              Yang dibayar ke supplier {formatMoney(Number(amount || 0), currency)}, ditambah{' '}
              {formatMoney(Number(adminFee || 0), currency)} biaya admin yang masuk pengeluaran
              usaha. Total uang keluar {formatMoney(Number(amount || 0) + Number(adminFee || 0), currency)}.
            </div>
          )}

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

/** Sisa utang nota ini dalam dolar. Nol untuk nota rupiah. */
function outstandingUsdOf(purchase: Purchase): number {
  const kurs = Number(purchase.exchange_rate || 0);
  if (purchase.currency !== 'USD' || kurs <= 0) return 0;
  return outstandingOf(purchase) / kurs;
}

/**
 * Sisa utang dalam rupiah yang DITAMPILKAN: berapa yang harus disiapkan
 * kalau dibayar hari ini.
 *
 * Nota rupiah memakai nilai notanya sendiri. Nota dolar menyisakan kewajiban
 * dolar, jadi dinilai pada kurs supplier saat ini — sama seperti kartu di
 * halaman Supplier, supaya kedua halaman tidak menyebut angka berbeda untuk
 * utang yang sama.
 */
function outstandingTodayOf(purchase: Purchase, kursSupplier: number): number {
  const usd = outstandingUsdOf(purchase);
  if (usd > 0 && kursSupplier > 0) return usd * kursSupplier;
  return outstandingOf(purchase);
}

function daysUntilDue(purchase: Purchase): number | null {
  if (!purchase.due_date) return null;
  const due = new Date(`${purchase.due_date}T23:59:59`).getTime();
  const now = Date.now();
  return Math.ceil((due - now) / 86400000);
}


/** Kurs yang tercatat di nota. Nota lama menyimpan kursnya sendiri, jadi
 *  mengubah kurs supplier tidak menggeser nilai nota yang sudah jadi. */
function noteRate(purchase: { exchange_rate?: number | string | null }): number {
  const rate = Number(purchase.exchange_rate || 0);
  return rate > 0 ? rate : 1;
}

/**
 * Terima barang dengan jumlah aktual. Pesanan ke supplier sering meleset
 * (dipesan 100, jadi 110 atau 95); yang masuk stok dan yang dibayar harus
 * mengikuti jumlah yang benar-benar datang, bukan jumlah yang dipesan.
 * Semua angka di sini dalam IDR, sama seperti nilai nota yang tersimpan.
 */
function ReceiveDialog({
  purchase,
  items,
  busy,
  onClose,
  onConfirm,
}: {
  purchase: Purchase | null;
  items: PurchaseItem[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (actual: { id: string; qty: number }[]) => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    setQty(Object.fromEntries(items.map((it) => [it.id, String(Number(it.qty))])));
    // Diisi ulang hanya saat nota yang dibuka berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase?.id]);

  if (!purchase) return null;

  const angka = (id: string, cadangan: number) => {
    const v = qty[id];
    if (v === undefined || v === '') return cadangan;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : cadangan;
  };
  const subtotal = items.reduce(
    (sum, it) => sum + angka(it.id, Number(it.qty)) * Number(it.cost_price || 0),
    0,
  );
  const total =
    subtotal -
    Number(purchase.discount || 0) +
    Number(purchase.tax || 0) +
    Number(purchase.other_cost || 0) +
    Number(purchase.extra_cost || 0);
  const sudahBayar = Number(purchase.paid_amount || 0);
  const sisa = total - sudahBayar;
  const valid = items.every((it) => {
    const v = qty[it.id];
    return v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  });

  return (
    <Modal open onClose={onClose} title={`Terima barang ${purchase.invoice_number}`} size="lg">
      <div className="space-y-3 text-sm">
        <p className="text-ink-500">
          Isi jumlah yang benar-benar datang. Stok bertambah sebanyak jumlah ini, dan nilai nota
          serta sisa pelunasan ikut disesuaikan.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr>
                <th className="py-1.5">Item</th>
                <th className="py-1.5 text-right">Dipesan</th>
                <th className="py-1.5 text-right">Diterima</th>
                <th className="py-1.5 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const n = angka(it.id, Number(it.qty));
                const beda = n !== Number(it.qty);
                return (
                  <tr key={it.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-2">
                      <div className="font-medium">{it.name}</div>
                      {it.sku && <div className="text-[11px] text-ink-500">{it.sku}</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(Number(it.qty))}</td>
                    <td className="py-2 text-right">
                      <input
                        aria-label={`Diterima ${it.name}`}
                        type="number"
                        min="0"
                        className={`input !w-24 !py-1 text-right ${beda ? '!border-amber-400' : ''}`}
                        value={qty[it.id] ?? ''}
                        onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })}
                      />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(n * Number(it.cost_price || 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-1 border-t border-ink-100 pt-2 dark:border-ink-800">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(subtotal)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total nota</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
          <div className="flex justify-between text-ink-500">
            <span>Sudah dibayar</span>
            <span className="tabular-nums">{formatMoney(sudahBayar)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{sisa >= 0 ? 'Sisa pelunasan' : 'Kelebihan bayar'}</span>
            <span className="tabular-nums">{formatMoney(Math.abs(sisa))}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            onClick={() =>
              onConfirm(items.map((it) => ({ id: it.id, qty: angka(it.id, Number(it.qty)) })))
            }
            disabled={busy || !valid}
          >
            {busy ? 'Memproses...' : 'Terima barang'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
