/**
 * Ekspor CSV dari data IndexedDB, dikelompokkan per SKU.
 *
 * Seluruh penulisan CSV memakai src/lib/csvFormat.ts supaya format berkasnya
 * seragam di semua fitur ekspor: pemisah titik koma (agar Excel Indonesia
 * memisah kolom dengan benar), angka & tanggal berformat lokal, dan nilai
 * teknis seperti `sale`/`paid` diterjemahkan ke label manusia.
 */
import { db } from './db';
import { channelFeePercent, channelLabel } from './channels';
import { countsAsSale } from './orderStatus';
import type { Category, Order, Product, StockMovement } from '@/types';
import {
  buildCsv,
  csvFilename,
  date as fmtDate,
  dateTime as fmtDateTime,
  downloadCsv,
  int,
  label,
  num,
  text,
  yesNo,
} from './csvFormat';

/**
 * Export produk per SKU.
 * Beri `productList` untuk mengekspor hasil filter yang sedang tampil; tanpa itu
 * seluruh isi Dexie yang diekspor.
 */
export async function exportProductsBySKU(productList?: Product[], categoryList?: Category[]) {
  const products = productList ?? (await db.products.toArray());
  const categories = categoryList ?? (await db.categories.toArray());
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  const mappings = await db.product_channel_mappings.toArray();
  const channels = await db.sales_channels.toArray();
  const channelName = Object.fromEntries(channels.map(c => [c.code, c.name]));
  const byProduct = new Map<string, string[]>();
  for (const m of mappings) {
    const label = channelName[m.channel_code] ?? m.channel_code;
    const list = byProduct.get(m.product_id);
    if (list) list.push(label);
    else byProduct.set(m.product_id, [label]);
  }

  const headers = [
    'SKU', 'Barcode', 'Nama Produk', 'Kategori', 'Harga Jual', 'Harga Modal (HPP)',
    'Margin (%)', 'Stok', 'Stok Minimum', 'Status', 'Terkoneksi Channel',
  ];
  const rows = products
    .slice()
    .sort((a, b) => (a.sku || '').localeCompare(b.sku || ''))
    .map(p => {
      const price = Number(p.base_price);
      const cost = Number(p.cost_price ?? 0);
      const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
      return [
        text(p.sku),
        text(p.barcode),
        text(p.name),
        text(catMap[p.category_id || ''] || ''),
        int(price),
        int(cost),
        num(margin, 1),
        int(p.stock_qty),
        int(p.min_stock),
        p.is_active ? 'Aktif' : 'Nonaktif',
        (byProduct.get(p.id) ?? ['Toko Fisik']).join(' + '),
      ];
    });

  downloadCsv(csvFilename('produk'), buildCsv(headers, rows));
  return rows.length;
}

/** Export orders with SKU detail per item. */
export async function exportOrdersBySKU(
  orderList?: Order[],
  opts?: { fromDate?: string; toDate?: string; filenameSuffix?: string },
) {
  // Halaman Orders mengirim daftar yang SUDAH difilter; tanpa itu jatuh ke
  // seluruh isi Dexie dengan filter tanggal opsional.
  let orders = orderList ?? (await db.orders.toArray());
  if (!orderList) {
    if (opts?.fromDate) orders = orders.filter(o => o.created_at >= opts.fromDate!);
    if (opts?.toDate) orders = orders.filter(o => o.created_at <= opts.toDate!);
  }
  const items = await db.order_items.toArray();
  const products = await db.products.toArray();
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  // Nama channel, bukan kode mentah seperti "shopee".
  const channels = await db.sales_channels.toArray();
  // Pelanggan terdaftar dicari lewat customer_id; pesanan impor marketplace
  // hanya membawa nama penerima di customer_name.
  const customers = await db.customers.toArray();
  const namaPelanggan = new Map(customers.map((c) => [c.id, c.name]));

  const headers = [
    'No. Pesanan', 'No. Pesanan Platform', 'Tanggal', 'Channel', 'Pelanggan', 'SKU', 'Barcode',
    'Nama Produk', 'Qty', 'Harga Satuan', 'Subtotal', 'Status Bayar', 'Status Order',
  ];
  const rows: (string | number | null)[] [] = [];

  for (const ord of orders.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const orderItems = items.filter(i => i.order_id === ord.id);
    for (const it of orderItems) {
      const prod = prodMap[it.product_id || ''];
      rows.push([
        text(ord.order_number),
        text(ord.external_order_no),
        fmtDateTime(ord.created_at),
        channelLabel(ord.sales_channel, channels),
        text((ord.customer_id ? namaPelanggan.get(ord.customer_id) : null) ?? ord.customer_name ?? null),
        text(prod?.sku),
        text(prod?.barcode),
        text(it.name),
        int(it.qty),
        int(it.price),
        int(it.qty * it.price),
        label('paymentStatus', ord.payment_status),
        label('orderStatus', ord.order_status),
      ]);
    }
  }

  const suffix = opts?.filenameSuffix || new Date().toISOString().slice(0, 10);
  downloadCsv(csvFilename('pesanan', suffix), buildCsv(headers, rows));
  return rows.length;
}

/**
 * Export stock movements grouped by SKU.
 *
 * Kolom Channel dan No. Pesanan Platform ditambahkan supaya berkas ini bisa
 * dipakai mencocokkan kartu stok fisik gudang dengan sistem: baris penjualan
 * ditelusuri balik ke pesanannya lewat ref_order_id, untuk tahu barang keluar
 * lewat channel mana dan nomor pesanan berapa. Baris jenis lain (restock,
 * adjust) tidak berasal dari pesanan, jadi kedua kolom itu dikosongkan.
 */
export async function exportStockMovementsBySKU(
  movementList?: StockMovement[],
  /** Pesanan yang sudah ditarik halaman Mutasi Stok (termasuk yang di luar cache). */
  orderLookup?: Map<string, Order>,
) {
  // Beri daftar terfilter untuk mengekspor persis yang tampil di layar.
  const movements = movementList ?? (await db.stock_movements.toArray());
  const products = await db.products.toArray();
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const orderIds = [...new Set(movements.map((m) => m.ref_order_id).filter((id): id is string => !!id))];
  const orders = orderIds.length ? await db.orders.bulkGet(orderIds) : [];
  const orderMap = new Map(orders.filter((o): o is Order => !!o).map((o) => [o.id, o]));
  for (const [id, o] of orderLookup ?? []) if (!orderMap.has(id)) orderMap.set(id, o);
  const channelRows = await db.sales_channels.toArray();
  const customers = await db.customers.toArray();
  const namaPelanggan = new Map(customers.map((c) => [c.id, c.name]));

  const headers = [
    'SKU', 'Barcode', 'Nama Produk', 'Jenis', 'Perubahan Stok', 'Alasan', 'Tanggal',
    'No. Pesanan', 'Channel', 'No. Pesanan Platform', 'Pelanggan',
  ];
  const rows = movements
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(m => {
      const prod = prodMap[m.product_id || ''];
      const order = m.ref_order_id ? orderMap.get(m.ref_order_id) : null;
      return [
        text(prod?.sku),
        text(prod?.barcode),
        text(prod?.name),
        label('stockMovement', m.type),
        int(m.qty_delta),
        text(m.reason),
        fmtDateTime(m.created_at),
        order ? text(order.order_number) : '',
        order ? text(channelLabel(order.sales_channel, channelRows)) : '',
        order ? text(order.external_order_no) : '',
        order
          ? text((order.customer_id ? namaPelanggan.get(order.customer_id) : null) ?? order.customer_name ?? null)
          : '',
      ];
    });

  downloadCsv(csvFilename('mutasi-stok'), buildCsv(headers, rows));
  return rows.length;
}

/** Export purchase orders with SKU detail per item. */
export async function exportPurchasesBySKU() {
  const purchases = await db.purchases.toArray();
  const items = await db.purchase_items.toArray();
  const suppliers = await db.suppliers.toArray();
  const suppMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const headers = [
    'No. Invoice', 'Tanggal', 'Supplier', 'Mata Uang', 'Kurs',
    'SKU', 'Barcode', 'Nama Barang', 'Qty', 'Qty Diterima',
    'Harga Modal (Asli)', 'Harga Modal (IDR)', 'Subtotal (IDR)', 'Status',
  ];
  const rows: (string | number | null)[][] = [];

  for (const po of purchases.sort((a, b) => a.order_date.localeCompare(b.order_date))) {
    const poItems = items.filter(i => i.purchase_id === po.id);
    const supp = suppMap[po.supplier_id || ''];
    for (const it of poItems) {
      rows.push([
        text(po.invoice_number),
        fmtDate(po.order_date),
        text(supp?.name),
        text(po.currency),
        num(po.exchange_rate),
        text(it.sku),
        text(it.barcode),
        text(it.name),
        int(it.qty),
        int(it.received_qty),
        num(it.original_cost_price ?? it.cost_price),
        int(it.cost_price),
        int(it.subtotal),
        label('purchaseStatus', po.status),
      ]);
    }
  }

  downloadCsv(csvFilename('pembelian'), buildCsv(headers, rows));
  return rows.length;
}

/** Export channel SKU mappings. */
export async function exportChannelMappings() {
  const mappings = await db.product_channel_mappings.toArray();
  const products = await db.products.toArray();
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

  const channels = await db.sales_channels.toArray();
  const channelName = Object.fromEntries(channels.map(c => [c.code, c.name]));

  const headers = ['SKU Internal', 'Nama Produk', 'Platform', 'Kode Platform', 'SKU Platform', 'URL', 'Sudah Sinkron'];
  const rows = mappings
    .sort((a, b) => a.channel_code.localeCompare(b.channel_code))
    .map(m => {
      const prod = prodMap[m.product_id];
      return [
        text(prod?.sku),
        text(prod?.name),
        text(channelName[m.channel_code] ?? m.channel_code),
        text(m.channel_code),
        text(m.external_sku),
        text(m.external_url),
        yesNo(m.is_synced),
      ];
    });

  downloadCsv(csvFilename('sku-platform'), buildCsv(headers, rows));
  return rows.length;
}

/** Export supplier product catalog. */
export async function exportSupplierCatalog() {
  const mappings = await db.supplier_product_mappings.toArray();
  const products = await db.products.toArray();
  const suppliers = await db.suppliers.toArray();
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]));
  const suppMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const headers = ['Supplier', 'SKU Supplier', 'Barcode Supplier', 'Nama Barang (Supplier)', 'SKU Internal', 'Nama Produk Internal', 'Harga Terakhir', 'Mata Uang'];
  const rows = mappings
    .sort((a, b) => a.supplier_id.localeCompare(b.supplier_id))
    .map(m => {
      const prod = prodMap[m.product_id];
      const supp = suppMap[m.supplier_id];
      return [
        text(supp?.name),
        text(m.supplier_sku),
        text(m.supplier_barcode),
        text(m.supplier_product_name),
        text(prod?.sku),
        text(prod?.name),
        int(m.last_cost_price),
        text(m.currency),
      ];
    });

  downloadCsv(csvFilename('katalog-supplier'), buildCsv(headers, rows));
  return rows.length;
}

/**
 * Laporan dana cair per pesanan: harga tayang dikurangi potongan platform
 * (biaya admin dll) = uang yang benar-benar diterima toko.
 *
 * Urutan sumber angkanya, dari yang paling dipercaya:
 *   1. Laporan pencairan yang sudah diimpor (net_settled/marketplace_fee) —
 *      angka dari penyedia, bukan hitungan sendiri.
 *   2. Total yang sudah disesuaikan manual lewat "Sesuaikan harga"
 *      (total asli tersimpan di original_total).
 *   3. Perkiraan dari persen biaya channel di Pengaturan, untuk pesanan yang
 *      belum cair sama sekali.
 */
export async function exportDisbursement(orderList: Order[], opts?: { filenameSuffix?: string }) {
  const channels = await db.sales_channels.toArray();
  const customers = await db.customers.toArray();
  const namaPelanggan = new Map(customers.map((c) => [c.id, c.name]));

  const headers = [
    'No. Pesanan', 'No. Pesanan Platform', 'Tanggal', 'Channel', 'Pelanggan', 'Status Order',
    'Harga Tayang', 'Potongan (Admin dll)', 'Dana Cair', 'Dasar Potongan', 'Tanggal Cair',
    'Sudah Diterima', 'Belum Diterima',
  ];
  const rows = orderList
    .filter(countsAsSale)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) => {
      const sudahCair = o.net_settled != null;
      const disesuaikan = o.original_total != null;
      const tayang = Number(o.original_total ?? o.total);
      const fee = channelFeePercent(o.sales_channel, channels);
      const cair = sudahCair
        ? Number(o.net_settled)
        : disesuaikan
          ? Number(o.total)
          : Math.round(tayang * (1 - fee / 100));
      const diterima =
        o.payment_term === 'tempo'
          ? Number(o.paid_amount ?? 0)
          : o.payment_status === 'paid'
            ? cair
            : Number(o.paid_amount ?? 0);
      return [
        text(o.order_number),
        text(o.external_order_no),
        fmtDateTime(o.created_at),
        channelLabel(o.sales_channel, channels),
        text((o.customer_id ? namaPelanggan.get(o.customer_id) : null) ?? o.customer_name ?? null),
        label('orderStatus', o.order_status),
        int(tayang),
        int(tayang - cair),
        int(cair),
        sudahCair
          ? 'Aktual (pencairan)'
          : disesuaikan
            ? 'Aktual (disesuaikan)'
            : fee > 0
              ? `Estimasi ${fee}% biaya channel`
              : 'Tanpa potongan',
        text(o.settlement_date ?? null),
        int(diterima),
        int(Math.max(0, cair - diterima)),
      ];
    });

  const suffix = opts?.filenameSuffix || new Date().toISOString().slice(0, 10);
  downloadCsv(csvFilename('dana-cair', suffix), buildCsv(headers, rows));
  return rows.length;
}
