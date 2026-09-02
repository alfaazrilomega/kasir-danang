// Uji LOGIKA keamanan lewat API sungguhan:
// - matriks role bawaan ditegakkan
// - override role_permissions hanya bisa MENGURANGI, tidak menambah
// - isolasi antar toko (baca & tulis)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim().split('\n')[0].trim();

const results = [];
const record = (n, p, d) => { results.push({ n, p }); console.log((p?'PASS  ':'FAIL  ')+n+(d?' — '+d:'')); };

const curl = (args) => execFileSync('curl', ['-s','-m','12', ...args], { encoding: 'utf8' });
const login = (email, pw) => {
  const r = curl(['-X','POST','http://localhost:3000/api/auth/signin','-H','Content-Type: application/json',
    '-d', JSON.stringify({ email, password: pw })]);
  return JSON.parse(r).session.access_token;
};
const q = (jwt, body) => curl(['-w','|%{http_code}','-X','POST','http://localhost:3000/api/query',
  '-H','Content-Type: application/json','-H',`Authorization: Bearer ${jwt}`,'-d', JSON.stringify(body)]);
const code = (res) => res.split('|').pop().trim();

(async () => {
  const store = sql("select id from public.stores order by created_at limit 1;");
  const admin = login('admin@example.com', adminPw);
  const kasir = login('kasir@example.com', 'kasir12345');
  const gudang = login('gudang@example.com', 'gudang12345');
  const customer = login('customer@example.com', 'customer12345');

  // --- kasir harus bisa membaca isi pesanan ---
  //
  // Regresi nyata: klausa tenant order_items menambahkan `o.cashier_id = <id>`
  // tanpa memeriksa apakah id-nya UUID. Akun demo memakai 'usr-cashier-001',
  // jadi SETIAP pembacaan gagal 22P02. Akibatnya Export CSV di Riwayat
  // Transaksi keluar nol baris, karena penarikan data menghapus cache lokal
  // lalu gagal mengisinya kembali.
  record('Kasir bisa baca order_items (tanpa 22P02)',
    code(q(kasir, { table: 'order_items', action: 'select', limit: 5 })) === '200');

  const contohOrder = sql("select id from public.orders order by created_at desc limit 1;");
  record('Kasir bisa baca order_items dengan filter in',
    code(q(kasir, {
      table: 'order_items', action: 'select',
      filters: [{ type: 'in', column: 'order_id', values: [contohOrder] }],
    })) === '200', contohOrder);

  record('Kasir bisa baca orders',
    code(q(kasir, { table: 'orders', action: 'select', limit: 5 })) === '200');

  // --- matriks role bawaan ---
  record('Kasir tidak bisa baca expenses? (boleh baca, POS_ROLES)',
    code(q(kasir, { table: 'expenses', action: 'select', limit: 1 })) === '200');
  record('Kasir TIDAK bisa tulis expenses',
    code(q(kasir, { table: 'expenses', action: 'insert', payload: { store_id: store, category: 'sewa', amount: 1 } })) === '403');
  record('Gudang TIDAK bisa baca expenses',
    code(q(gudang, { table: 'expenses', action: 'select' })) === '403');
  record('Customer TIDAK bisa baca produk mapping',
    code(q(customer, { table: 'product_channel_mappings', action: 'select' })) === '403');
  record('Kasir TIDAK bisa tulis produk',
    code(q(kasir, { table: 'products', action: 'insert', payload: { store_id: store, name: 'x', base_price: 1 } })) === '403');
  record('Gudang bisa tulis produk',
    code(q(gudang, { table: 'products', action: 'select', limit: 1 })) === '200');
  record('Kasir TIDAK bisa posting opname',
    curl(['-w','|%{http_code}','-X','POST','http://localhost:3000/api/rpc/post_stock_opname',
      '-H','Content-Type: application/json','-H',`Authorization: Bearer ${kasir}`,
      '-d','{"p_opname_id":"00000000-0000-0000-0000-000000000000"}']).includes('|403'));

  // --- override hanya bisa mengurangi ---
  sql(`insert into public.role_permissions(store_id,role,capability,enabled) values ('${store}','admin','manageCustomers',false)
       on conflict (store_id,role,capability) do update set enabled=false;`);
  execFileSync('node', ['-e', 'setTimeout(()=>{},0)']); // no-op
  await new Promise((r) => setTimeout(r, 32000)); // tunggu cache 30 dtk
  record('Override MEMATIKAN akses admin ke customers',
    code(q(admin, { table: 'customers', action: 'select', limit: 1 })) === '403');
  record('Tabel lain tidak ikut terkunci',
    code(q(admin, { table: 'products', action: 'select', limit: 1 })) === '200');

  // coba MENAMBAH hak kasir lewat override -> harus tetap ditolak
  sql(`insert into public.role_permissions(store_id,role,capability,enabled) values ('${store}','cashier','manageInventory',true)
       on conflict (store_id,role,capability) do update set enabled=true;`);
  await new Promise((r) => setTimeout(r, 32000));
  record('Override TIDAK BISA memberi kasir hak tulis produk',
    code(q(kasir, { table: 'products', action: 'insert', payload: { store_id: store, name: 'y', base_price: 1 } })) === '403');

  sql(`delete from public.role_permissions where store_id='${store}';`);
  await new Promise((r) => setTimeout(r, 32000));
  record('Akses pulih setelah override dihapus',
    code(q(admin, { table: 'customers', action: 'select', limit: 1 })) === '200');

  // --- isolasi antar toko ---
  const storeB = sql("insert into public.stores(name) values ('Toko Uji Isolasi') returning id;");
  const prodB = sql(`insert into public.products(store_id,name,base_price) values ('${storeB}','Produk B',1) returning id;`);
  record('Admin toko A tidak melihat produk toko B',
    !q(admin, { table: 'products', action: 'select', columns: 'id,name' }).includes('Produk B'));
  record('Admin toko A tidak bisa menulis dengan store_id toko B',
    code(q(admin, { table: 'products', action: 'insert', payload: { store_id: storeB, name: 'z', base_price: 1 } })) === '403');
  record('Admin toko A tidak bisa memetakan produk toko B',
    code(q(admin, { table: 'product_channel_mappings', action: 'insert',
      payload: { store_id: store, product_id: prodB, channel_code: 'shopee', external_sku: 'X-1' } })) === '403');
  sql(`delete from public.stores where id='${storeB}';`);

  console.log('');
  console.log('--- RINGKASAN ---');
  const pass = results.filter((r) => r.p).length;
  console.log(pass + '/' + results.length + ' lolos');
  process.exitCode = pass === results.length ? 0 : 1;
})();
