// Local IndexedDB store via Dexie.
// Caches read data + holds pending-order outbox so transactions made offline
// can replay when online. Schema v2 adds shifts, cash/stock/loyalty ledgers.

import Dexie, { type Table } from 'dexie';
import type {
  CashMovement,
  Category,
  Expense,
  Customer,
  LoyaltyTransaction,
  Order,
  OrderItem,
  OrderPayment,
  Product,
  ProductChannelMapping,
  Promo,
  Purchase,
  PurchaseItem,
  PurchasePayment,
  SalesChannel,
  Shift,
  StockMovement,
  RolePermission,
  StockOpname,
  StockOpnameItem,
  Store,
  Supplier,
  SupplierProductMapping,
  OrderReturn,
  OrderReturnItem,
} from '@/types';

/**
 * Antrean tulis umum untuk perubahan yang dibuat saat offline.
 * Sebelumnya halaman menulis ke Dexie tanpa syarat tapi hanya memanggil API
 * `if (navigator.onLine)` — jadi edit offline hilang diam-diam begitu data
 * ditarik ulang dari server.
 */
export interface PendingWrite {
  id: string;
  table: string;
  action: 'insert' | 'upsert' | 'update' | 'delete';
  payload: unknown;
  /** Filter untuk update/delete, mis. { column: 'id', value: '...' }. */
  match?: { column: string; value: unknown };
  created_at: string;
  attempts: number;
  last_error?: string;
}

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
  order_returns!: Table<OrderReturn, string>;
  order_return_items!: Table<OrderReturnItem, string>;
  pending!: Table<PendingOrder, string>;
  pending_writes!: Table<PendingWrite, string>;
  shifts!: Table<Shift, string>;
  cash_movements!: Table<CashMovement, string>;
  expenses!: Table<Expense, string>;
  role_permissions!: Table<RolePermission, string>;
  stock_opnames!: Table<StockOpname, string>;
  stock_opname_items!: Table<StockOpnameItem, string>;
  stock_movements!: Table<StockMovement, string>;
  loyalty_transactions!: Table<LoyaltyTransaction, string>;
  suppliers!: Table<Supplier, string>;
  purchases!: Table<Purchase, string>;
  purchase_items!: Table<PurchaseItem, string>;
  purchase_payments!: Table<PurchasePayment, string>;
  sales_channels!: Table<SalesChannel, string>;
  order_payments!: Table<OrderPayment, string>;
  product_channel_mappings!: Table<ProductChannelMapping, string>;
  supplier_product_mappings!: Table<SupplierProductMapping, string>;

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
    // v5: retur pesanan berbasis order_number (dihapus di v7).
    this.version(5).stores({
      order_returns: 'id, store_id, order_id, order_number, created_at',
      order_return_items: 'id, return_id, product_id',
    });
    // v6: multi-platform SKU mapping + supplier product catalog.
    this.version(6).stores({
      product_channel_mappings: 'id, store_id, product_id, channel_code, external_sku',
      supplier_product_mappings: 'id, store_id, supplier_id, product_id, supplier_sku',
    });
    // v7: fitur retur pesanan dihapus; buang tabelnya dari IndexedDB lama.
    this.version(7).stores({
      order_returns: null,
      order_return_items: null,
    });
    // v8: mapping SKU platform mulai dipakai UI + resolver POS.
    // Indeks compound sengaja TIDAK unique: unique index Dexie membuat
    // bulkPut() melempar saat sync/seed, dan satu baris bermasalah bisa
    // menggagalkan seluruh transaksi tanpa jalan pemulihan. Keunikan dijaga
    // di validasi aplikasi + unique index Postgres.
    this.version(8).stores({
      product_channel_mappings:
        'id, store_id, product_id, channel_code, external_sku, [store_id+channel_code], [product_id+channel_code]',
      supplier_product_mappings:
        'id, store_id, supplier_id, product_id, supplier_sku, [store_id+supplier_id], [supplier_id+supplier_sku]',
    });
    // v9: pengeluaran operasional untuk laporan laba rugi.
    this.version(9).stores({
      expenses: 'id, store_id, category, expense_date, shift_id, [store_id+expense_date]',
    });
    // v10: sesi opname stok fisik.
    this.version(10).stores({
      stock_opnames: 'id, store_id, status, started_at',
      stock_opname_items: 'id, opname_id, product_id, [opname_id+product_id]',
    });
    // v11: pembatasan hak akses per role.
    this.version(11).stores({
      role_permissions: 'id, store_id, role, capability, [store_id+role]',
    });
    // v12: antrean tulis offline.
    this.version(12).stores({
      pending_writes: 'id, table, created_at',
    });
    // v13: retur pesanan. Diindeks pada order_number karena itu kunci
    // pencarian yang dipakai kasir.
    this.version(13).stores({
      order_returns: 'id, store_id, order_number, order_id, created_at',
      order_return_items: 'id, return_id, product_id',
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
    db.order_returns.clear(),
    db.order_return_items.clear(),
    db.pending.clear(),
    db.pending_writes.clear(),
    db.shifts.clear(),
    db.cash_movements.clear(),
    db.expenses.clear(),
    db.role_permissions.clear(),
    db.stock_opnames.clear(),
    db.stock_opname_items.clear(),
    db.stock_movements.clear(),
    db.loyalty_transactions.clear(),
    db.suppliers.clear(),
    db.purchases.clear(),
    db.purchase_items.clear(),
    db.purchase_payments.clear(),
    db.sales_channels.clear(),
    db.order_payments.clear(),
    db.product_channel_mappings.clear(),
    db.supplier_product_mappings.clear(),
  ]);
}
