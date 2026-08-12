// Offline-first sync engine.
// - Pulls reference data (stores, categories, products, customers, promos,
//   recent shifts/movements) into IndexedDB so the POS keeps working offline.
// - Flushes pending orders from the outbox when connectivity returns, then
//   applies stock decrement (via RPC) and loyalty points.

import { db, type PendingOrder } from './db';
import { getBackendClient } from './api';
import { toast } from 'sonner';
import type {
  CashMovement,
  LoyaltyTransaction,
  Product,
  Purchase,
  PurchaseItem,
  PurchasePayment,
  OrderPayment,
  SalesChannel,
  Shift,
  StockMovement,
  Supplier,
} from '@/types';

let syncing = false;
let onlineListenerBound = false;

export async function pullReference(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;

  const [storesRes, categoriesRes, productsRes, customersRes, promosRes, channelsRes] =
    await Promise.all([
      api.from('stores').select('*').eq('id', storeId),
      api.from('categories').select('*').eq('store_id', storeId).order('sort_order'),
      api.from('products').select('*').eq('store_id', storeId),
      api.from('customers').select('*').eq('store_id', storeId),
      api.from('promos').select('*').eq('store_id', storeId),
      api.from('sales_channels').select('*').eq('store_id', storeId).order('sort_order'),
    ]);

  if (channelsRes.data) {
    await db.sales_channels.where('store_id').equals(storeId).delete();
    await db.sales_channels.bulkPut(channelsRes.data as SalesChannel[]);
  }
  if (storesRes.data) await db.stores.bulkPut(storesRes.data);
  if (categoriesRes.data) {
    await db.categories.where('store_id').equals(storeId).delete();
    await db.categories.bulkPut(categoriesRes.data);
  }
  if (productsRes.data) {
    await db.products.where('store_id').equals(storeId).delete();
    await db.products.bulkPut(productsRes.data);
  }
  if (customersRes.data) {
    await db.customers.where('store_id').equals(storeId).delete();
    await db.customers.bulkPut(customersRes.data);
  }
  if (promosRes.data) {
    await db.promos.where('store_id').equals(storeId).delete();
    await db.promos.bulkPut(promosRes.data);
  }
}

export async function pullInventoryReference(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;

  const [storesRes, categoriesRes, productsRes] = await Promise.all([
    api.from('stores').select('*').eq('id', storeId),
    api.from('categories').select('*').eq('store_id', storeId).order('sort_order'),
    api.from('products').select('*').eq('store_id', storeId),
  ]);

  if (storesRes.data) await db.stores.bulkPut(storesRes.data);
  if (categoriesRes.data) {
    await db.categories.where('store_id').equals(storeId).delete();
    await db.categories.bulkPut(categoriesRes.data);
  }
  if (productsRes.data) {
    await db.products.where('store_id').equals(storeId).delete();
    await db.products.bulkPut(productsRes.data);
  }
}

export async function pullCustomerCatalog(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;

  const [storesRes, categoriesRes, productsRes, promosRes] = await Promise.all([
    api.from('stores').select('*').eq('id', storeId),
    api.from('categories').select('*').eq('store_id', storeId).order('sort_order'),
    api.from('products').select('*').eq('store_id', storeId),
    api.from('promos').select('*').eq('store_id', storeId),
  ]);

  if (storesRes.data) await db.stores.bulkPut(storesRes.data);
  if (categoriesRes.data) {
    await db.categories.where('store_id').equals(storeId).delete();
    await db.categories.bulkPut(categoriesRes.data);
  }
  if (productsRes.data) {
    await db.products.where('store_id').equals(storeId).delete();
    await db.products.bulkPut(productsRes.data);
  }
  if (promosRes.data) {
    await db.promos.where('store_id').equals(storeId).delete();
    await db.promos.bulkPut(promosRes.data);
  }
}

export async function pullRecentOrders(storeId: string, limit = 50) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const previousOrderIds = await db.orders.where('store_id').equals(storeId).primaryKeys();
  const { data: orders } = await api
    .from('orders')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  await db.orders.where('store_id').equals(storeId).delete();
  if (previousOrderIds.length) {
    await db.order_items.where('order_id').anyOf(previousOrderIds as string[]).delete();
  }
  if (orders && orders.length) {
    await db.orders.bulkPut(orders);
    const ids = orders.map((o: { id: string }) => o.id);
    const { data: items } = await api
      .from('order_items')
      .select('*')
      .in('order_id', ids);
    if (items) await db.order_items.bulkPut(items);
  }

  // Pelunasan piutang penjualan; kasir tidak punya akses, jadi errornya diabaikan.
  const { data: orderPayments } = await api
    .from('order_payments')
    .select('*')
    .eq('store_id', storeId)
    .order('paid_at', { ascending: false })
    .limit(1000);
  if (orderPayments) {
    await db.order_payments.where('store_id').equals(storeId).delete();
    await db.order_payments.bulkPut(orderPayments as OrderPayment[]);
  }
}

export async function pullShifts(storeId: string, limit = 30) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const [shiftsRes, movementsRes] = await Promise.all([
    api.from('shifts').select('*').eq('store_id', storeId).order('opened_at', { ascending: false }).limit(limit),
    api.from('cash_movements').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(500),
  ]);
  if (shiftsRes.data) {
    await db.shifts.where('store_id').equals(storeId).delete();
    await db.shifts.bulkPut(shiftsRes.data as Shift[]);
  }
  if (movementsRes.data) {
    await db.cash_movements.where('store_id').equals(storeId).delete();
    await db.cash_movements.bulkPut(movementsRes.data as CashMovement[]);
  }
}

export async function pullLoyalty(storeId: string, limit = 500) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data } = await api
    .from('loyalty_transactions')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (data) {
    await db.loyalty_transactions.where('store_id').equals(storeId).delete();
    await db.loyalty_transactions.bulkPut(data as LoyaltyTransaction[]);
  }
}

export async function pullSuppliers(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data } = await api.from('suppliers').select('*').eq('store_id', storeId).order('name');
  if (data) {
    await db.suppliers.where('store_id').equals(storeId).delete();
    await db.suppliers.bulkPut(data as Supplier[]);
  }
}

export async function pullPurchases(storeId: string, limit = 200) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const previousIds = await db.purchases.where('store_id').equals(storeId).primaryKeys();
  const [purchasesRes, paymentsRes] = await Promise.all([
    api
      .from('purchases')
      .select('*')
      .eq('store_id', storeId)
      .order('order_date', { ascending: false })
      .limit(limit),
    api
      .from('purchase_payments')
      .select('*')
      .eq('store_id', storeId)
      .order('paid_at', { ascending: false })
      .limit(1000),
  ]);

  await db.purchases.where('store_id').equals(storeId).delete();
  if (previousIds.length) {
    await db.purchase_items.where('purchase_id').anyOf(previousIds as string[]).delete();
  }
  if (purchasesRes.data?.length) {
    await db.purchases.bulkPut(purchasesRes.data as Purchase[]);
    const ids = (purchasesRes.data as Purchase[]).map((row) => row.id);
    const { data: items } = await api.from('purchase_items').select('*').in('purchase_id', ids);
    if (items) await db.purchase_items.bulkPut(items as PurchaseItem[]);
  }
  if (paymentsRes.data) {
    await db.purchase_payments.where('store_id').equals(storeId).delete();
    await db.purchase_payments.bulkPut(paymentsRes.data as PurchasePayment[]);
  }
}

/** Terima barang dari nota pembelian: stok bertambah + mutasi tercatat di server. */
export async function receivePurchase(purchaseId: string, storeId: string) {
  const api = getBackendClient();
  const { error } = await api.rpc('receive_purchase', { p_purchase_id: purchaseId });
  if (error) return { error };
  await Promise.all([pullPurchases(storeId), pullInventoryReference(storeId)]);
  return { error: null };
}

export async function enqueueOrder(pending: PendingOrder) {
  await db.pending.put(pending);
  await db.orders.put({ ...pending.payload.order });
  const itemsForLocal = pending.payload.items.map((i, idx) => ({
    ...i,
    id: `${pending.id}:${idx}`,
    order_id: pending.payload.order.id,
  }));
  await db.order_items.bulkPut(itemsForLocal);

  // Local stock decrement for instant feedback (server is authoritative when online).
  await decrementLocalStock(pending);
  // Local stock-movement audit row (optimistic).
  await db.stock_movements.bulkPut(
    pending.payload.items
      .filter((i) => i.product_id)
      .map((i, idx) => ({
        id: `${pending.id}:sm:${idx}`,
        store_id: pending.payload.order.store_id,
        product_id: i.product_id!,
        type: 'sale' as const,
        qty_delta: -i.qty,
        reason: 'POS sale',
        ref_order_id: pending.payload.order.id,
        created_at: pending.created_at,
      })),
  );

  // Local loyalty ledger row + customer point bump (optimistic).
  if (pending.payload.order.customer_id && pending.payload.order.points_earned > 0) {
    await db.loyalty_transactions.put({
      id: `${pending.id}:loy`,
      store_id: pending.payload.order.store_id,
      customer_id: pending.payload.order.customer_id,
      points_delta: pending.payload.order.points_earned,
      reason: 'order',
      ref_order_id: pending.payload.order.id,
      created_at: pending.created_at,
    });
    const customer = await db.customers.get(pending.payload.order.customer_id);
    if (customer) {
      await db.customers.put({
        ...customer,
        points: (customer.points ?? 0) + pending.payload.order.points_earned,
      });
    }
  }

  void flushPending();
}

async function decrementLocalStock(pending: PendingOrder) {
  for (const it of pending.payload.items) {
    if (!it.product_id) continue;
    const p = await db.products.get(it.product_id);
    if (p && p.track_stock) {
      await db.products.put({ ...p, stock_qty: Number(p.stock_qty ?? 0) - it.qty });
    }
  }
}

export async function flushPending(): Promise<{ ok: number; failed: number }> {
  if (syncing) return { ok: 0, failed: 0 };
  const api = getBackendClient();
  if (!navigator.onLine) return { ok: 0, failed: 0 };

  syncing = true;
  let ok = 0;
  let failed = 0;
  try {
    const pending = await db.pending.toArray();
    for (const p of pending) {
      try {
        const { error: orderErr } = await api.from('orders').insert(p.payload.order);
        if (orderErr) throw orderErr;

        if (p.payload.items.length) {
          const itemsWithOrder = p.payload.items.map((it) => ({
            ...it,
            order_id: p.payload.order.id,
          }));
          const { error: itemErr } = await api.from('order_items').insert(itemsWithOrder);
          if (itemErr) throw itemErr;
        }

        // Server-side stock decrement (race-safe).
        const { error: stockErr } = await api.rpc('apply_order_stock', { p_order_id: p.payload.order.id });
        if (stockErr) {
          // Not fatal — local stock already updated; just log.
          console.warn('apply_order_stock RPC failed:', stockErr.message);
        }

        // Loyalty ledger insert + customer.points bump.
        if (p.payload.order.customer_id && p.payload.order.points_earned > 0) {
          await api.from('loyalty_transactions').insert({
            store_id: p.payload.order.store_id,
            customer_id: p.payload.order.customer_id,
            points_delta: p.payload.order.points_earned,
            reason: 'order',
            ref_order_id: p.payload.order.id,
          });
          const { data: cust } = await api
            .from('customers')
            .select('points')
            .eq('id', p.payload.order.customer_id)
            .maybeSingle();
          const current = (cust?.points ?? 0) + p.payload.order.points_earned;
          await api.from('customers').update({ points: current }).eq('id', p.payload.order.customer_id);
        }

        await db.pending.delete(p.id);
        ok++;
      } catch (e) {
        failed++;
        await db.pending.update(p.id, {
          attempts: (p.attempts ?? 0) + 1,
          last_error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    syncing = false;
  }
  if (ok > 0) toast.success(`${ok} pesanan tersinkronisasi`);
  return { ok, failed };
}

export function bindOnlineSync() {
  if (onlineListenerBound) return;
  onlineListenerBound = true;
  window.addEventListener('online', () => {
    toast.message('Kembali online — sinkronisasi…');
    void flushPending();
  });
}

export async function pendingCount(): Promise<number> {
  return db.pending.count();
}

/** Records a stock movement (restock/adjust/refund) + updates products.stock_qty. */
export async function adjustStock(args: {
  storeId: string;
  product: Product;
  delta: number;
  type: 'restock' | 'adjust' | 'refund';
  reason?: string;
}) {
  const api = getBackendClient();
  const newQty = Number(args.product.stock_qty ?? 0) + args.delta;
  const movement: StockMovement = {
    id: crypto.randomUUID(),
    store_id: args.storeId,
    product_id: args.product.id,
    type: args.type,
    qty_delta: args.delta,
    reason: args.reason ?? null,
    ref_order_id: null,
    created_at: new Date().toISOString(),
  };
  await db.products.put({ ...args.product, stock_qty: newQty });
  await db.stock_movements.put(movement);
  if (navigator.onLine) {
    await api.from('products').update({ stock_qty: newQty }).eq('id', args.product.id);
    await api.from('stock_movements').insert(movement);
  }
}
