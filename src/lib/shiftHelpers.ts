import { db } from './db';
import { getBackendClient } from './api';
import { uuid } from './format';
import type { CashMovement } from '@/types';

export async function recordMovement(args: {
  storeId: string;
  shiftId: string;
  type: CashMovement['type'];
  amount: number;
  note: string;
}) {
  const api = getBackendClient();
  const row: CashMovement = {
    id: uuid(),
    store_id: args.storeId,
    shift_id: args.shiftId,
    type: args.type,
    amount: args.amount,
    note: args.note || null,
    created_at: new Date().toISOString(),
  };
  await db.cash_movements.put(row);
  if (navigator.onLine) {
    try {
      await api.from('cash_movements').insert(row);
    } catch {
      // offline
    }
  }
}

/** Helper used by the POS to log a cash sale to the active shift. */
export async function logSaleToActiveShift(args: {
  storeId: string;
  amount: number;
  orderId: string;
}): Promise<string | null> {
  const active = await db.shifts.where('store_id').equals(args.storeId).filter((s) => !s.closed_at).first();
  if (!active) return null;
  await recordMovement({
    storeId: args.storeId,
    shiftId: active.id,
    type: 'sale',
    amount: args.amount,
    note: `Order ${args.orderId}`,
  });
  await db.shifts.put({
    ...active,
    total_sales: Number(active.total_sales ?? 0) + args.amount,
    total_orders: Number(active.total_orders ?? 0) + 1,
  });
  return active.id;
}
