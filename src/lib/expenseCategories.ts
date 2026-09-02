import type { ExpenseCategory, ExpensePaymentMethod } from '@/types';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'sewa', label: 'Sewa Tempat' },
  { value: 'gaji', label: 'Gaji & Upah' },
  { value: 'listrik_air', label: 'Listrik & Air' },
  { value: 'internet', label: 'Internet & Telepon' },
  { value: 'transport', label: 'Transport & Pengiriman' },
  { value: 'pemasaran', label: 'Pemasaran & Iklan' },
  { value: 'perlengkapan', label: 'Perlengkapan Toko' },
  { value: 'perawatan', label: 'Perawatan & Perbaikan' },
  { value: 'pajak_retribusi', label: 'Pajak & Retribusi' },
  { value: 'lainnya', label: 'Lainnya' },
];

export const EXPENSE_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'card', label: 'Kartu' },
  { value: 'ewallet', label: 'E-Wallet' },
  { value: 'other', label: 'Lainnya' },
];

export function expenseCategoryLabel(value: string | null | undefined): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? String(value ?? 'Lainnya');
}

export function expenseMethodLabel(value: string | null | undefined): string {
  return EXPENSE_METHODS.find((m) => m.value === value)?.label ?? String(value ?? '-');
}
