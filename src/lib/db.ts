// Local IndexedDB store via Dexie.
// Caches read data + holds pending-order outbox so transactions made offline
// can replay when online. Schema v2 adds shifts, cash/stock/loyalty ledgers.

import Dexie, { type Table } from 'dexie';
import type {
  CashMovement,
  Category,
  Customer,
  LoyaltyTransaction,
  Order,
  OrderItem,
  OrderPayment,
  Product,
  Promo,
  Purchase,
  PurchaseItem,
  PurchasePayment,
  SalesChannel,
  Shift,
  StockMovement,
  Store,
  Supplier,
} from '@/types';

export interface PendingOrder {
  id: string;
  payload: {
    order: Omit<Order, 'created_at'> & { created_at: string };
    items: Omit<OrderItem, 'id' | 'order_id'>[];
  };
  created_at: string;
  attempts: number;
  last_error?: string;
}

class KasirDB extends Dexie {
  stores!: Table<Store, string>;
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  customers!: Table<Customer, string>;
  promos!: Table<Promo, string>;
  orders!: Table<Order, string>;
  order_items!: Table<OrderItem, string>;
  pending!: Table<PendingOrder, string>;
  shifts!: Table<Shift, string>;
  cash_movements!: Table<CashMovement, string>;
  stock_movements!: Table<StockMovement, string>;
  loyalty_transactions!: Table<LoyaltyTransaction, string>;
  suppliers!: Table<Supplier, string>;
  purchases!: Table<Purchase, string>;
  purchase_items!: Table<PurchaseItem, string>;
  purchase_payments!: Table<PurchasePayment, string>;
  sales_channels!: Table<SalesChannel, string>;
  order_payments!: Table<OrderPayment, string>;

  constructor() {
    super('kasir');
    this.version(1).stores({
      stores: 'id, name',
      categories: 'id, store_id, sort_order',
      products: 'id, store_id, category_id, name, is_active',
      customers: 'id, store_id, name, joined_date, is_active',
      promos: 'id, store_id, code, is_active',
      orders: 'id, store_id, created_at, payment_status, order_status',
      order_items: 'id, order_id, product_id',
      pending: 'id, created_at',
    });
    this.version(2).stores({
      products: 'id, store_id, category_id, name, is_active, sku, barcode',
      shifts: 'id, store_id, cashier_id, opened_at, closed_at',
      cash_movements: 'id, store_id, shift_id, type, created_at',
      stock_movements: 'id, store_id, product_id, type, created_at',
      loyalty_transactions: 'id, store_id, customer_id, created_at',
    });
    // v3: supplier & pembelian dengan pembayaran bertahap (DP + pelunasan).
    this.version(3).stores({
      suppliers: 'id, store_id, name, is_active',
      purchases: 'id, store_id, supplier_id, status, order_date, due_date',
      purchase_items: 'id, purchase_id, product_id',
      purchase_payments: 'id, store_id, purchase_id, paid_at',
    });
    // v4: channel penjualan + piutang tempo.
    this.version(4).stores({
      orders: 'id, store_id, created_at, payment_status, order_status, sales_channel, payment_term, due_date',
      sales_channels: 'id, store_id, code, is_active',
      order_payments: 'id, store_id, order_id, paid_at',
    });
  }
}

export const db = new KasirDB();

export async function clearLocalCache() {
  await Promise.all([
    db.stores.clear(),
    db.categories.clear(),
    db.products.clear(),
    db.customers.clear(),
    db.promos.clear(),
    db.orders.clear(),
    db.order_items.clear(),
    db.pending.clear(),
    db.shifts.clear(),
    db.cash_movements.clear(),
    db.stock_movements.clear(),
    db.loyalty_transactions.clear(),
    db.suppliers.clear(),
    db.purchases.clear(),
    db.purchase_items.clear(),
    db.purchase_payments.clear(),
    db.sales_channels.clear(),
    db.order_payments.clear(),
  ]);
}
