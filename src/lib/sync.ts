// Offline-first sync engine.
// - Pulls reference data (stores, categories, products, customers, promos,
//   recent shifts/movements) into IndexedDB so the POS keeps working offline.
// - Flushes pending orders from the outbox when connectivity returns, then
//   applies stock decrement (via RPC) and loyalty points.

import { db, type PendingOrder, type PendingWrite } from './db';
import { getBackendClient } from './api';
import { isUuid } from './format';
import { toast } from 'sonner';
import type {
  CashMovement,
  Expense,
  LoyaltyTransaction,
  Product,
  Purchase,
  PurchaseItem,
  PurchasePayment,
  OrderPayment,
  SalesChannel,
  Shift,
  StockMovement,
  RolePermission,
  StockOpname,
  StockOpnameItem,
  Supplier,
  ProductChannelMapping,
  ProductComponent,
  SupplierProductMapping,
  OrderReturn,
  OrderReturnItem,
} from '@/types';

let syncing = false;
let onlineListenerBound = false;

/**
 * Hanya pelanggan. Dipakai impor pelanggan massal: menarik seluruh data
 * referensi (ratusan produk) cuma untuk mencocokkan nomor HP terlalu lambat.
 */
export async function pullCustomers(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const res = await api.from('customers').select('*').eq('store_id', storeId);
  if (res.data) {
    await db.customers.where('store_id').equals(storeId).delete();
    if (res.data.length) await db.customers.bulkPut(res.data);
  }
}

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

  // Hapus dan isi ulang dalam satu transaksi: tanpa itu tabel sempat kosong di
  // antara keduanya, dan layar yang membacanya (POS memanggil ini tiap dibuka)
  // memperlihatkan pelanggan terpilih dan kartu produk hilang sesaat.
  await db.transaction(
    'rw',
    [db.sales_channels, db.stores, db.categories, db.products, db.customers, db.promos],
    async () => {
      if (channelsRes.data?.length) {
        await db.sales_channels.where('store_id').equals(storeId).delete();
        await db.sales_channels.bulkPut(channelsRes.data as SalesChannel[]);
      }
      if (storesRes.data?.length) await db.stores.bulkPut(storesRes.data);
      if (categoriesRes.data?.length) {
        await db.categories.where('store_id').equals(storeId).delete();
        await db.categories.bulkPut(categoriesRes.data);
      }
      if (productsRes.data?.length) {
        await db.products.where('store_id').equals(storeId).delete();
        await db.products.bulkPut(productsRes.data);
      }
      if (customersRes.data?.length) {
        await db.customers.where('store_id').equals(storeId).delete();
        await db.customers.bulkPut(customersRes.data);
      }
      if (promosRes.data?.length) {
        await db.promos.where('store_id').equals(storeId).delete();
        await db.promos.bulkPut(promosRes.data);
      }
    },
  );

  // POS butuh indeks SKU platform supaya scan/ketik kode marketplace ketemu.
  await pullChannelMappings(storeId);
  await pullProductComponents(storeId);
}

export async function pullInventoryReference(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;

  const [storesRes, categoriesRes, productsRes] = await Promise.all([
    api.from('stores').select('*').eq('id', storeId),
    api.from('categories').select('*').eq('store_id', storeId).order('sort_order'),
    api.from('products').select('*').eq('store_id', storeId),
  ]);

  if (storesRes.data?.length) await db.stores.bulkPut(storesRes.data);
  if (categoriesRes.data?.length) {
    await db.categories.where('store_id').equals(storeId).delete();
    await db.categories.bulkPut(categoriesRes.data);
  }
  if (productsRes.data?.length) {
    await db.products.where('store_id').equals(storeId).delete();
    await db.products.bulkPut(productsRes.data);
  }

  await Promise.all([
    pullChannelMappings(storeId),
    pullSupplierCatalog(storeId),
    pullProductComponents(storeId),
  ]);
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

  if (storesRes.data?.length) await db.stores.bulkPut(storesRes.data);
  if (categoriesRes.data?.length) {
    await db.categories.where('store_id').equals(storeId).delete();
    await db.categories.bulkPut(categoriesRes.data);
  }
  if (productsRes.data?.length) {
    await db.products.where('store_id').equals(storeId).delete();
    await db.products.bulkPut(productsRes.data);
  }
  if (promosRes.data?.length) {
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
  if (orders && orders.length) {
    // Ambil SEMUA data dulu, baru tukar isi cache.
    //
    // Sebelumnya urutannya: hapus order lama -> hapus itemnya -> tulis order
    // baru -> baru ambil itemnya dari server. Di antara langkah itu ada jeda
    // beberapa detik ketika tabel order sudah terisi tapi order_items masih
    // kosong. Kalau kasir menekan Export CSV tepat di jeda itu, hasilnya nol
    // baris padahal daftar pesanannya kelihatan penuh.
    const ids = orders.map((o: { id: string }) => o.id);
    const { data: items, error: itemError } = await api
      .from('order_items')
      .select('*')
      .in('order_id', ids);
    // Gagal mengambil item berarti jangan sentuh cache sama sekali: lebih baik
    // menampilkan data lama daripada menghapusnya tanpa pengganti.
    if (itemError) return;

    await db.transaction('rw', db.orders, db.order_items, async () => {
      await db.orders.where('store_id').equals(storeId).delete();
      if (previousOrderIds.length) {
        await db.order_items.where('order_id').anyOf(previousOrderIds as string[]).delete();
      }
      await db.orders.bulkPut(orders);
      if (items?.length) await db.order_items.bulkPut(items);
    });
  }

  // Pelunasan piutang penjualan; kasir tidak punya akses, jadi errornya diabaikan.
  const { data: orderPayments } = await api
    .from('order_payments')
    .select('*')
    .eq('store_id', storeId)
    .order('paid_at', { ascending: false })
    .limit(1000);
  if (orderPayments?.length) {
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
  if (shiftsRes.data?.length) {
    await db.shifts.where('store_id').equals(storeId).delete();
    await db.shifts.bulkPut(shiftsRes.data as Shift[]);
  }
  if (movementsRes.data?.length) {
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
  if (data?.length) {
    await db.loyalty_transactions.where('store_id').equals(storeId).delete();
    await db.loyalty_transactions.bulkPut(data as LoyaltyTransaction[]);
  }
}

/**
 * Riwayat mutasi stok. Server membatasi limit di 1000, jadi yang ditarik adalah
 * yang TERBARU; halaman Mutasi Stok memberi tahu kalau jumlahnya menyentuh
 * batas itu supaya pengguna tidak mengira melihat seluruh riwayat.
 */
export async function pullStockMovements(storeId: string, limit = 1000) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('stock_movements')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data?.length) return;
  await db.transaction('rw', db.stock_movements, async () => {
    await db.stock_movements.where('store_id').equals(storeId).delete();
    await db.stock_movements.bulkPut(data as StockMovement[]);
  });
}

/** Pengeluaran operasional untuk laporan laba rugi. */
export async function pullExpenses(storeId: string, limit = 1000) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('expenses')
    .select('*')
    .eq('store_id', storeId)
    .order('expense_date', { ascending: false })
    .limit(limit);
  // Alasan guard sama seperti pullChannelMappings: server mengembalikan
  // {data: []} tanpa error saat Postgres mati, jadi respons kosong tidak
  // boleh dipakai untuk menghapus cache lokal.
  if (error || !data?.length) return;
  // HPP per barang membaca biaya nota dari tabel ini. Begitu pengeluaran toko
  // melebihi batas tarik, biaya nota lama jatuh di luar jendela dan HPP-nya
  // berkurang tanpa pesan apa pun. Biaya yang menempel ke nota ditarik
  // tersendiri; di bawah batas, jendela sudah memuat semuanya.
  const milikNota: Expense[] = [];
  if (data.length >= limit) {
    // Daftar nota diambil dari server, bukan dari salinan lokal: tarikan nota
    // berjalan bersamaan dan salinannya belum tentu sudah terisi.
    const { data: nota } = await api.from('purchases').select('id').eq('store_id', storeId);
    const idNota = ((nota as { id: string }[] | null) ?? []).map((n) => n.id);
    for (let i = 0; i < idNota.length; i += 200) {
      const { data: tambahan } = await api
        .from('expenses')
        .select('*')
        .eq('store_id', storeId)
        .in('purchase_id', idNota.slice(i, i + 200));
      if (tambahan?.length) milikNota.push(...(tambahan as Expense[]));
    }
  }
  // Satu transaksi supaya tidak ada jeda tabel kosong yang terlihat di UI.
  await db.transaction('rw', db.expenses, async () => {
    await db.expenses.where('store_id').equals(storeId).delete();
    await db.expenses.bulkPut([...(data as Expense[]), ...milikNota]);
  });
}

/**
 * Pembatasan hak akses per role. Ditarik untuk semua role karena UI perlu tahu
 * menu apa yang harus disembunyikan. Penegakan sebenarnya tetap di server.
 */
export async function pullRolePermissions(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  // store_id bertipe uuid di database. Toko demo memakai id seperti
  // 'store-default-001', dan mengirimnya hanya menghasilkan 400 (22P02)
  // berulang di konsol tanpa pernah bisa berhasil.
  if (!isUuid(storeId)) return;
  const { data, error } = await api.from('role_permissions').select('*').eq('store_id', storeId);
  if (error || !data) return;
  await db.transaction('rw', db.role_permissions, async () => {
    await db.role_permissions.where('store_id').equals(storeId).delete();
    if (data.length) await db.role_permissions.bulkPut(data as RolePermission[]);
  });
}

/** Sesi opname stok beserta barisnya. */
export async function pullStockOpnames(storeId: string, limit = 50) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('stock_opnames')
    .select('*')
    .eq('store_id', storeId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error || !data?.length) return;
  const ids = (data as StockOpname[]).map((row) => row.id);
  const { data: items } = await api.from('stock_opname_items').select('*').in('opname_id', ids);
  await db.transaction('rw', db.stock_opnames, db.stock_opname_items, async () => {
    await db.stock_opnames.where('store_id').equals(storeId).delete();
    await db.stock_opnames.bulkPut(data as StockOpname[]);
    if (items?.length) await db.stock_opname_items.bulkPut(items as StockOpnameItem[]);
  });
}

/** Posting opname: server yang menulis mutasi & menyamakan stok (atomik). */
export async function postStockOpname(opnameId: string, storeId: string) {
  const api = getBackendClient();
  const { error } = await api.rpc('post_stock_opname', { p_opname_id: opnameId });
  if (error) return { error };
  await Promise.all([pullStockOpnames(storeId), pullInventoryReference(storeId)]);
  return { error: null };
}

export async function pullSuppliers(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data } = await api.from('suppliers').select('*').eq('store_id', storeId).order('name');
  if (data?.length) {
    await db.suppliers.where('store_id').equals(storeId).delete();
    await db.suppliers.bulkPut(data as Supplier[]);
  }
}

/**
 * Mapping SKU platform. POS memakainya untuk mencari produk dari SKU
 * marketplace, jadi ikut ditarik untuk semua role yang boleh membacanya.
 * Role tanpa akses (customer) hanya menerima error yang sengaja diabaikan.
 */
export async function pullChannelMappings(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('product_channel_mappings')
    .select('*')
    .eq('store_id', storeId);
  // Saat Postgres tak terjangkau, server MENGEMBALIKAN {data: []} tanpa error
  // (lihat selectRows di server/index.js). Jadi respons kosong tidak bisa
  // dibedakan dari "memang kosong", dan menghapus di sini akan membuang cache
  // lokal tiap kali database bermasalah. Karena itu replace hanya dilakukan
  // ketika benar-benar ada data; penghapusan baris ditangani eksplisit oleh
  // form produk saat menyimpan.
  if (error || !data?.length) return;
  await db.transaction('rw', db.product_channel_mappings, async () => {
    await db.product_channel_mappings.where('store_id').equals(storeId).delete();
    await db.product_channel_mappings.bulkPut(data as ProductChannelMapping[]);
  });
}

/**
 * Isi produk set.
 *
 * POS membutuhkannya untuk menghitung ketersediaan set dari stok komponennya,
 * jadi ikut ditarik bersama data acuan lain, bukan hanya di halaman Produk.
 */
export async function pullProductComponents(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('product_components')
    .select('*')
    .eq('store_id', storeId);
  // Alasan guard sama seperti pullChannelMappings: respons kosong tidak bisa
  // dibedakan dari database yang sedang tak terjangkau.
  if (error || !data?.length) return;
  await db.transaction('rw', db.product_components, async () => {
    await db.product_components.where('store_id').equals(storeId).delete();
    await db.product_components.bulkPut(data as ProductComponent[]);
  });
}

/** Katalog barang supplier (kode & harga versi supplier). */
export async function pullSupplierCatalog(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('supplier_product_mappings')
    .select('*')
    .eq('store_id', storeId);
  // Alasan sama seperti pullChannelMappings di atas.
  if (error || !data?.length) return;
  await db.transaction('rw', db.supplier_product_mappings, async () => {
    await db.supplier_product_mappings.where('store_id').equals(storeId).delete();
    await db.supplier_product_mappings.bulkPut(data as SupplierProductMapping[]);
  });
}

/**
 * Tarik retur pesanan beserta barisnya.
 *
 * Sama seperti pull lain: kalau server tidak menjawab atau hasilnya kosong,
 * cache lokal dibiarkan. Menghapus lebih dulu lalu gagal mengisi akan membuat
 * riwayat retur lenyap dari layar padahal datanya masih ada di server.
 */
export async function pullOrderReturns(storeId: string) {
  const api = getBackendClient();
  if (!navigator.onLine) return;
  const { data, error } = await api
    .from('order_returns')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data?.length) return;
  const returns = data as OrderReturn[];
  const { data: items } = await api
    .from('order_return_items')
    .select('*')
    .in('return_id', returns.map((row) => row.id));
  await db.transaction('rw', db.order_returns, db.order_return_items, async () => {
    await db.order_returns.where('store_id').equals(storeId).delete();
    await db.order_returns.bulkPut(returns);
    if (items?.length) await db.order_return_items.bulkPut(items as OrderReturnItem[]);
  });
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

  if (purchasesRes.data?.length) {
    const rows = purchasesRes.data as Purchase[];
    const itemsRes = await api.from('purchase_items').select('*').in('purchase_id', rows.map((row) => row.id));
    // Item diambil DULU, baru salinan lokal diganti dalam satu transaksi.
    // Sebelumnya item lama dihapus sebelum yang baru datang, jadi selama
    // permintaan berjalan detail nota (dan HPP per barangnya) tampil kosong.
    // Kalau pengambilan item gagal, item lama dibiarkan apa adanya.
    const items = itemsRes.error ? null : ((itemsRes.data as PurchaseItem[] | null) ?? []);
    await db.transaction('rw', db.purchases, db.purchase_items, async () => {
      await db.purchases.where('store_id').equals(storeId).delete();
      await db.purchases.bulkPut(rows);
      if (items) {
        if (previousIds.length) {
          await db.purchase_items.where('purchase_id').anyOf(previousIds as string[]).delete();
        }
        if (items.length) await db.purchase_items.bulkPut(items);
      }
    });
  }
  if (paymentsRes.data?.length) {
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

/**
 * Terima barang dengan jumlah aktual per baris (dipesan 100, datang 110).
 * Nilai nota dan sisa pelunasan ikut jumlah yang benar-benar datang.
 */
export async function receivePurchaseActual(
  purchaseId: string,
  storeId: string,
  items: { id: string; qty: number }[],
) {
  const api = getBackendClient();
  const { error } = await api.rpc('receive_purchase_actual', {
    p_purchase_id: purchaseId,
    p_items: items,
  });
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

    // Produk set tidak punya stok sendiri: yang berkurang isinya. Aturan ini
    // harus sama persis dengan apply_order_stock di server (migrasi 019),
    // kalau tidak angka di layar dan angka sebenarnya akan berbeda sampai
    // sinkronisasi berikutnya.
    const isi = await db.product_components
      .where('parent_product_id')
      .equals(it.product_id)
      .toArray();

    if (isi.length) {
      for (const komponen of isi) {
        const bagian = await db.products.get(komponen.component_product_id);
        if (bagian && bagian.track_stock) {
          await db.products.put({
            ...bagian,
            stock_qty: Number(bagian.stock_qty ?? 0) - it.qty * Number(komponen.qty ?? 1),
          });
        }
      }
      continue;
    }

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

// --- Antrean tulis offline -------------------------------------------------
// Server sekarang membedakan kesalahan DATA dari kegagalan KONEKSI (lihat
// server/pgErrors.js). Di klien pembedanya: error dengan `status` berarti
// server menjawab dan menolak — itu bug data, jangan diantre ulang selamanya.
// Error tanpa `status` berarti fetch gagal (jaringan) — itu yang diantre.

function isNetworkError(error: { status?: number } | null | undefined): boolean {
  return Boolean(error) && error!.status === undefined;
}

/** Masukkan satu operasi tulis ke antrean untuk dikirim ulang saat online. */
export async function queueWrite(
  table: string,
  action: PendingWrite['action'],
  payload: unknown,
  match?: PendingWrite['match'],
): Promise<void> {
  await db.pending_writes.put({
    id: crypto.randomUUID(),
    table,
    action,
    payload,
    match,
    created_at: new Date().toISOString(),
    attempts: 0,
  });
}

/**
 * Tulis ke server bila memungkinkan; kalau jaringan gagal, antrekan.
 * Melempar bila server menolak dengan alasan data — pemanggil harus
 * menampilkan pesannya, bukan diam-diam menyimpan lokal saja.
 *
 * @returns queued=true bila operasi masuk antrean (offline).
 */
export async function writeThrough(
  table: string,
  action: PendingWrite['action'],
  payload: unknown,
  match?: PendingWrite['match'],
): Promise<{ queued: boolean }> {
  if (!navigator.onLine) {
    await queueWrite(table, action, payload, match);
    return { queued: true };
  }

  const api = getBackendClient();
  const builder = api.from(table);
  let error: { message: string; status?: number } | null = null;

  if (action === 'insert') ({ error } = await builder.insert(payload));
  else if (action === 'upsert') ({ error } = await builder.upsert(payload));
  else if (action === 'update') {
    ({ error } = await builder.update(payload).eq(match!.column, match!.value));
  } else {
    ({ error } = await api.from(table).delete().eq(match!.column, match!.value));
  }

  if (!error) return { queued: false };
  if (isNetworkError(error)) {
    await queueWrite(table, action, payload, match);
    return { queued: true };
  }
  throw error;
}

/** Kirim ulang antrean tulis. Dipanggil saat kembali online. */
export async function flushWrites(): Promise<{ ok: number; failed: number; dropped: number }> {
  if (!navigator.onLine) return { ok: 0, failed: 0, dropped: 0 };
  const api = getBackendClient();
  const queued = await db.pending_writes.orderBy('created_at').toArray();
  let ok = 0;
  let failed = 0;
  let dropped = 0;

  for (const item of queued) {
    try {
      const builder = api.from(item.table);
      let error: { message: string; status?: number } | null = null;
      if (item.action === 'insert') ({ error } = await builder.insert(item.payload));
      else if (item.action === 'upsert') ({ error } = await builder.upsert(item.payload));
      else if (item.action === 'update') {
        ({ error } = await builder.update(item.payload).eq(item.match!.column, item.match!.value));
      } else {
        ({ error } = await api.from(item.table).delete().eq(item.match!.column, item.match!.value));
      }

      if (!error) {
        await db.pending_writes.delete(item.id);
        ok++;
        continue;
      }
      if (isNetworkError(error)) {
        failed++;
        await db.pending_writes.update(item.id, { attempts: (item.attempts ?? 0) + 1 });
        continue;
      }
      // Server menolak karena data: mengantre ulang tidak akan pernah berhasil.
      dropped++;
      await db.pending_writes.delete(item.id);
      toast.error(`Perubahan pada ${item.table} ditolak server: ${error.message}`);
    } catch (e) {
      failed++;
      await db.pending_writes.update(item.id, {
        attempts: (item.attempts ?? 0) + 1,
        last_error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (ok > 0) toast.success(`${ok} perubahan offline tersinkronisasi.`);
  return { ok, failed, dropped };
}

export async function pendingWriteCount(): Promise<number> {
  return db.pending_writes.count();
}

export function bindOnlineSync() {
  if (onlineListenerBound) return;
  onlineListenerBound = true;
  window.addEventListener('online', () => {
    toast.message('Kembali online — sinkronisasi…');
    void flushPending();
    void flushWrites();
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
