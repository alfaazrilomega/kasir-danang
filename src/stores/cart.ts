import { create } from 'zustand';
import { OFFLINE_CHANNEL } from '@/lib/channels';
import type { CartLine, OrderType, PaymentMethod, PaymentTerm, Promo } from '@/types';

export interface ParkedOrder {
  id: string;
  label: string;
  parked_at: string;
  lines: CartLine[];
  orderType: OrderType;
  tableNumber: string;
  payment: PaymentMethod;
  customerId: string | null;
  promo: Promo | null;
  manualDiscount: number;
  salesChannel?: string;
  paymentTerm?: PaymentTerm;
}

interface CartState {
  lines: CartLine[];
  orderType: OrderType;
  tableNumber: string;
  payment: PaymentMethod;
  customerId: string | null;
  notes: string;
  promo: Promo | null;
  manualDiscount: number;     // additional flat-amount discount in cart currency
  receivedAmount: number;     // cash tendered; relevant for cash payments
  salesChannel: string;       // offline | shopee | tiktok | ...
  paymentTerm: PaymentTerm;   // cash = lunas saat itu, tempo = jadi piutang
  dueDate: string;            // ISO date, hanya dipakai saat paymentTerm = tempo
  parked: ParkedOrder[];
  add: (line: CartLine) => void;
  updateQty: (idx: number, qty: number) => void;
  remove: (idx: number) => void;
  setNote: (idx: number, note: string) => void;
  setOrderType: (t: OrderType) => void;
  setTable: (t: string) => void;
  setPayment: (p: PaymentMethod) => void;
  setCustomer: (id: string | null) => void;
  setNotes: (n: string) => void;
  setPromo: (p: Promo | null) => void;
  setManualDiscount: (n: number) => void;
  setReceivedAmount: (n: number) => void;
  setSalesChannel: (code: string) => void;
  setPaymentTerm: (term: PaymentTerm) => void;
  setDueDate: (date: string) => void;
  clear: () => void;
  park: (label?: string) => string | null;
  resume: (id: string) => boolean;
  dropParked: (id: string) => void;
}

const PARK_KEY = 'kasir.parked_orders.v1';

function loadParked(): ParkedOrder[] {
  try {
    const raw = localStorage.getItem(PARK_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveParked(list: ParkedOrder[]) {
  try {
    localStorage.setItem(PARK_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded — ignore */
  }
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  orderType: 'dine_in',
  tableNumber: '',
  payment: 'cash',
  customerId: null,
  notes: '',
  promo: null,
  manualDiscount: 0,
  receivedAmount: 0,
  salesChannel: OFFLINE_CHANNEL,
  paymentTerm: 'cash',
  dueDate: '',
  parked: loadParked(),
  add: (line) =>
    set((s) => {
      const i = s.lines.findIndex(
        (l) => l.product_id === line.product_id && l.size === line.size,
      );
      if (i >= 0) {
        const next = [...s.lines];
        next[i] = { ...next[i], qty: next[i].qty + line.qty };
        return { lines: next };
      }
      return { lines: [...s.lines, line] };
    }),
  updateQty: (idx, qty) =>
    set((s) => {
      if (qty <= 0) return { lines: s.lines.filter((_, i) => i !== idx) };
      const next = [...s.lines];
      next[idx] = { ...next[idx], qty };
      return { lines: next };
    }),
  remove: (idx) => set((s) => ({ lines: s.lines.filter((_, i) => i !== idx) })),
  setNote: (idx, note) =>
    set((s) => {
      const next = [...s.lines];
      next[idx] = { ...next[idx], note };
      return { lines: next };
    }),
  setOrderType: (t) => set({ orderType: t }),
  setTable: (t) => set({ tableNumber: t }),
  setPayment: (p) => set({ payment: p }),
  setCustomer: (id) => set({ customerId: id }),
  setNotes: (n) => set({ notes: n }),
  setPromo: (p) => set({ promo: p }),
  setManualDiscount: (n) => set({ manualDiscount: Math.max(0, n) }),
  setReceivedAmount: (n) => set({ receivedAmount: Math.max(0, n) }),
  setSalesChannel: (code) => set({ salesChannel: code }),
  setPaymentTerm: (term) => set({ paymentTerm: term }),
  setDueDate: (date) => set({ dueDate: date }),
  clear: () =>
    set({
      lines: [],
      orderType: 'dine_in',
      tableNumber: '',
      payment: 'cash',
      customerId: null,
      notes: '',
      promo: null,
      manualDiscount: 0,
      receivedAmount: 0,
      salesChannel: OFFLINE_CHANNEL,
      paymentTerm: 'cash',
      dueDate: '',
    }),
  park: (label) => {
    const s = get();
    if (s.lines.length === 0) return null;
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `pk-${Date.now()}`;
    const order: ParkedOrder = {
      id,
      label: label?.trim() || s.tableNumber.trim() || `Order ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
      parked_at: new Date().toISOString(),
      lines: s.lines,
      orderType: s.orderType,
      tableNumber: s.tableNumber,
      payment: s.payment,
      customerId: s.customerId,
      promo: s.promo,
      manualDiscount: s.manualDiscount,
      salesChannel: s.salesChannel,
      paymentTerm: s.paymentTerm,
    };
    const next = [order, ...s.parked].slice(0, 20);
    saveParked(next);
    set({
      parked: next,
      lines: [],
      orderType: 'dine_in',
      tableNumber: '',
      payment: 'cash',
      customerId: null,
      notes: '',
      promo: null,
      manualDiscount: 0,
      receivedAmount: 0,
      salesChannel: OFFLINE_CHANNEL,
      paymentTerm: 'cash',
      dueDate: '',
    });
    return id;
  },
  resume: (id) => {
    const s = get();
    const found = s.parked.find((p) => p.id === id);
    if (!found) return false;
    const next = s.parked.filter((p) => p.id !== id);
    saveParked(next);
    set({
      parked: next,
      lines: found.lines,
      orderType: found.orderType,
      tableNumber: found.tableNumber,
      payment: found.payment,
      customerId: found.customerId,
      promo: found.promo,
      manualDiscount: found.manualDiscount,
      receivedAmount: 0,
      notes: '',
      salesChannel: found.salesChannel ?? OFFLINE_CHANNEL,
      paymentTerm: found.paymentTerm ?? 'cash',
      dueDate: '',
    });
    return true;
  },
  dropParked: (id) => {
    const next = get().parked.filter((p) => p.id !== id);
    saveParked(next);
    set({ parked: next });
  },
}));

export interface Totals {
  subtotal: number;
  promoDiscount: number;
  manualDiscount: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  pointsEarned: number;
}

export function cartTotals(
  lines: CartLine[],
  taxRate: number,
  promo: Promo | null,
  manualDiscount: number,
  pointsPerAmount: number,
): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  let promoDiscount = 0;
  if (promo && promo.is_active) {
    promoDiscount = promo.type === 'percent'
      ? +(subtotal * (Number(promo.value) / 100)).toFixed(2)
      : Math.min(Number(promo.value), subtotal);
  }
  const md = Math.min(manualDiscount, subtotal - promoDiscount);
  const discount = +(promoDiscount + md).toFixed(2);
  const taxable = Math.max(0, subtotal - discount);
  const tax = +(taxable * (taxRate / 100)).toFixed(2);
  const total = +(taxable + tax).toFixed(2);
  const pointsEarned = pointsPerAmount > 0 ? Math.floor(total * pointsPerAmount) : 0;
  return { subtotal, promoDiscount, manualDiscount: md, discount, taxable, tax, total, pointsEarned };
}
