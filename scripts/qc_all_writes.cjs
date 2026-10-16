// QC: uji SETIAP jalur tulis ke server dengan payload seperti yang benar-benar
// dikirim aplikasi, memakai akun DEMO (id non-UUID) sebagai kasus terburuk.
//
// Tujuannya menangkap kegagalan diam-diam kelas '22P02 / foreign key' yang
// dulu tersembunyi karena error database ditelan.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim().split('\n')[0].trim();
const uuid = () => require('crypto').randomUUID();

const curl = (args) => execFileSync('curl', ['-s','-m','15', ...args], { encoding: 'utf8' });
const login = (email, pw) => JSON.parse(curl(['-X','POST','http://localhost:3000/api/auth/signin',
  '-H','Content-Type: application/json','-d', JSON.stringify({ email, password: pw })]));
const write = (jwt, table, action, payload, extra = {}) => {
  const res = curl(['-w','|%{http_code}','-X','POST','http://localhost:3000/api/query',
    '-H','Content-Type: application/json','-H',`Authorization: Bearer ${jwt}`,
    '-d', JSON.stringify({ table, action, payload, ...extra })]);
  const code = res.split('|').pop().trim();
  return { code, body: res.slice(0, res.lastIndexOf('|')) };
};

const results = [];
const check = (name, r) => {
  const ok = r.code === '200';
  results.push({ name, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : ` — HTTP ${r.code} ${r.body}`));
};

(async () => {
  const store = sql("select id from public.stores order by created_at limit 1;");
  const product = sql(`select id from public.products where store_id='${store}' limit 1;`);
  const customer = sql(`select id from public.customers where store_id='${store}' limit 1;`);
  const supplier = sql(`select id from public.suppliers where store_id='${store}' limit 1;`);
  const purchase = sql(`select id from public.purchases where store_id='${store}' limit 1;`);
  const order = sql(`select id from public.orders where store_id='${store}' limit 1;`);

  const adminReal = login('admin@example.com', adminPw);
  const A = adminReal.session.access_token;
  const demoWh = login('gudang@example.com', 'gudang12345');
  const W = demoWh.session.access_token;
  const demoCashier = login('kasir@example.com', 'kasir12345');
  const K = demoCashier.session.access_token;

  console.log(`Akun demo gudang id = ${demoWh.user.id} (sengaja BUKAN UUID)\n`);
  const tag = 'QC-' + Date.now();
  const cleanup = [];

  // ---- master data (gudang) ----
  const catId = uuid();
  check('Kategori: insert', write(W, 'categories', 'upsert',
    { id: catId, store_id: store, name: `${tag}-kat`, icon: null, sort_order: 99 }));
  cleanup.push(`delete from public.categories where id='${catId}';`);

  const prodId = uuid();
  check('Produk: upsert (dengan sizes jsonb)', write(W, 'products', 'upsert',
    { id: prodId, store_id: store, category_id: catId, name: `${tag}-produk`, description: null,
      image_url: null, base_price: 15000, sizes: [{ label: 'S', price_modifier: 0 }],
      is_active: true, sku: `${tag}-SKU`, barcode: null, cost_price: 9000,
      stock_qty: 10, min_stock: 2, track_stock: true }));
  cleanup.push(`delete from public.products where id='${prodId}';`);

  check('Produk: update stok', write(W, 'products', 'update', { stock_qty: 12 },
    { filters: [{ type: 'eq', column: 'id', value: prodId }] }));

  check('Mapping SKU platform: insert', write(W, 'product_channel_mappings', 'insert',
    { id: uuid(), store_id: store, product_id: prodId, channel_code: 'shopee',
      external_sku: `${tag}-SHP`, external_url: null, is_synced: false, last_synced_at: null }));

  check('Katalog supplier: upsert', write(W, 'supplier_product_mappings', 'upsert',
    { id: uuid(), store_id: store, supplier_id: supplier, product_id: prodId,
      supplier_sku: `${tag}-SUP`, supplier_barcode: null, supplier_product_name: 'x',
      last_cost_price: 9000, currency: 'IDR' }));

  check('Mutasi stok: insert', write(W, 'stock_movements', 'insert',
    { id: uuid(), store_id: store, product_id: prodId, type: 'restock', qty_delta: 5,
      reason: tag, ref_order_id: null, created_at: new Date().toISOString() }));

  // ---- supplier & pembelian (gudang + admin) ----
  const purId = uuid();
  check('Nota pembelian: insert', write(W, 'purchases', 'insert',
    { id: purId, store_id: store, supplier_id: supplier, invoice_number: `${tag}-INV`,
      status: 'ordered', order_date: '2026-08-29', expected_date: null, due_date: null,
      subtotal: 90000, discount: 0, tax: 0, other_cost: 0, total: 90000, paid_amount: 0,
      dp_percent: 30, currency: 'IDR', exchange_rate: 1, received_at: null, notes: null,
      created_by: null, created_at: new Date().toISOString() }));
  cleanup.push(`delete from public.purchases where id='${purId}';`);

  check('Item pembelian: insert', write(W, 'purchase_items', 'insert',
    { id: uuid(), purchase_id: purId, product_id: prodId, name: 'x', sku: null, barcode: null,
      qty: 10, received_qty: 0, cost_price: 9000, original_cost_price: 9000, currency: 'IDR',
      subtotal: 90000, note: null }));

  // INI yang dilaporkan user gagal — created_by dari akun demo
  check('Pembayaran supplier (created_by demo)', write(A, 'purchase_payments', 'insert',
    { id: uuid(), store_id: store, purchase_id: purId, type: 'dp', amount: 27000,
      method: 'ewallet', paid_at: new Date().toISOString(), reference: '123', note: 'Done',
      created_by: null, created_at: new Date().toISOString() }));

  // ---- penjualan (kasir demo) ----
  const ordId = uuid();
  check('Order POS (cashier_id demo -> null)', write(K, 'orders', 'insert',
    { id: ordId, store_id: store, customer_id: customer, cashier_id: null, shift_id: null,
      order_number: `#${tag}`, subtotal: 15000, tax: 1500, discount: 0, total: 16500,
      payment_method: 'cash', payment_status: 'paid', order_status: 'done', order_type: 'take_away',
      table_number: null, notes: null, promo_code: null, received_amount: 20000,
      change_amount: 3500, points_earned: 0, created_at: new Date().toISOString(),
      sales_channel: 'offline', payment_term: 'cash', due_date: null, paid_amount: 16500,
      settled_at: null, original_total: null, adjustment_amount: 0, adjustment_note: null,
      adjusted_at: null, adjusted_by: null, external_order_no: null }));
  cleanup.push(`delete from public.orders where id='${ordId}';`);

  check('Item order (banyak baris, satu order)', write(K, 'order_items', 'insert', [
    { id: uuid(), order_id: ordId, product_id: prodId, name: 'a', size: null, qty: 1, price: 5000, cost_price: 3000, note: null },
    { id: uuid(), order_id: ordId, product_id: prodId, name: 'b', size: null, qty: 2, price: 5000, cost_price: 3000, note: null },
  ]));

  check('Pelunasan piutang order', write(A, 'order_payments', 'insert',
    { id: uuid(), store_id: store, order_id: ordId, amount: 1000, method: 'cash',
      paid_at: new Date().toISOString(), reference: null, note: null, created_by: null,
      created_at: new Date().toISOString() }));

  check('Penyesuaian harga order', write(A, 'orders', 'update',
    { total: 17000, original_total: 16500, adjustment_amount: 500, adjustment_note: 'qc',
      adjusted_at: new Date().toISOString(), adjusted_by: null },
    { filters: [{ type: 'eq', column: 'id', value: ordId }] }));

  // ---- shift & kas (kasir demo) ----
  const shiftId = uuid();
  check('Shift: buka', write(K, 'shifts', 'insert',
    { id: shiftId, store_id: store, cashier_id: null, opened_at: new Date().toISOString(),
      closed_at: null, opening_cash: 100000, closing_cash: null, expected_cash: null,
      total_sales: 0, total_orders: 0, notes: tag }));
  cleanup.push(`delete from public.shifts where id='${shiftId}';`);

  check('Mutasi kas', write(K, 'cash_movements', 'insert',
    { id: uuid(), store_id: store, shift_id: shiftId, type: 'in', amount: 50000,
      note: tag, created_at: new Date().toISOString() }));

  check('Loyalty', write(K, 'loyalty_transactions', 'insert',
    { id: uuid(), store_id: store, customer_id: customer, points_delta: 5,
      reason: tag, ref_order_id: ordId, created_at: new Date().toISOString() }));

  // ---- lain-lain (admin) ----
  check('Pelanggan: upsert', write(A, 'customers', 'upsert',
    { id: uuid(), store_id: store, name: `${tag}-cust`, phone: null, email: null, location: null,
      joined_date: '2026-08-29', is_active: true, points: 0 }));

  check('Promo: insert', write(A, 'promos', 'insert',
    { id: uuid(), store_id: store, code: `${tag}`.slice(0, 20), name: 'qc', type: 'percent',
      value: 5, start_date: null, end_date: null, is_active: true }));

  check('Pengeluaran: upsert', write(A, 'expenses', 'upsert',
    { id: uuid(), store_id: store, category: 'lainnya', description: tag, amount: 1000,
      expense_date: '2026-08-29', payment_method: 'cash', shift_id: null, created_by: null,
      created_at: new Date().toISOString() }));

  check('Channel penjualan: upsert', write(A, 'sales_channels', 'upsert',
    { id: uuid(), store_id: store, code: `qc${Date.now()}`.slice(0, 12), name: 'QC',
      fee_percent: 1, default_term_days: 0, is_active: true, sort_order: 99 }));

  check('Pengaturan toko: update', write(A, 'stores', 'update', { low_stock_threshold: 10 },
    { filters: [{ type: 'eq', column: 'id', value: store }] }));

  const opnId = uuid();
  check('Opname: buat sesi', write(W, 'stock_opnames', 'insert',
    { id: opnId, store_id: store, status: 'draft', note: tag, counted_by: null,
      started_at: new Date().toISOString(), posted_at: null, created_at: new Date().toISOString() }));
  cleanup.push(`delete from public.stock_opnames where id='${opnId}';`);

  check('Opname: item', write(W, 'stock_opname_items', 'insert',
    { id: uuid(), opname_id: opnId, product_id: prodId, system_qty: 12, counted_qty: 11, note: null }));

  check('Role permission: upsert', write(A, 'role_permissions', 'upsert',
    { id: uuid(), store_id: store, role: 'cashier', capability: 'manageShifts', enabled: true,
      updated_at: new Date().toISOString() }));
  cleanup.push(`delete from public.role_permissions where store_id='${store}';`);

  // bersihkan
  cleanup.push(`delete from public.stock_movements where reason='${tag}';`);
  cleanup.push(`delete from public.cash_movements where note='${tag}';`);
  cleanup.push(`delete from public.loyalty_transactions where reason='${tag}';`);
  cleanup.push(`delete from public.expenses where description='${tag}';`);
  cleanup.push(`delete from public.customers where name='${tag}-cust';`);
  cleanup.push(`delete from public.promos where name='qc';`);
  cleanup.push(`delete from public.sales_channels where name='QC';`);
  for (const c of cleanup.reverse()) { try { sql(c); } catch (_) {} }

  console.log('');
  console.log('--- RINGKASAN QC ---');
  const pass = results.filter((r) => r.ok).length;
  console.log(pass + '/' + results.length + ' jalur tulis lolos');
  process.exitCode = pass === results.length ? 0 : 1;
})();
