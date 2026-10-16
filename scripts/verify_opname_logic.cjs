// Uji LOGIKA posting Stock Opname langsung di database:
// - stok disamakan dengan hasil hitung fisik (bukan ditambah delta)
// - mutasi 'adjust' mencatat selisih yang benar
// - produk yang TIDAK dihitung tidak boleh tersentuh
// - posting ulang idempoten
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) =>
  execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: dbPw },
    encoding: 'utf8',
  }).trim();
const one = (q) => sql(q).split('\n')[0].trim();

const results = [];
const record = (n, p, d) => {
  results.push({ n, p });
  console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
};

(async () => {
  const store = one("select id from public.stores order by created_at limit 1;");
  const tag = 'OPNLOGIC-' + Date.now();

  // Tiga produk: selisih kurang, selisih lebih, dan TIDAK dihitung.
  const pKurang = one(`insert into public.products(store_id,name,base_price,stock_qty,track_stock) values ('${store}','${tag}-kurang',1000,100,true) returning id;`);
  const pLebih = one(`insert into public.products(store_id,name,base_price,stock_qty,track_stock) values ('${store}','${tag}-lebih',1000,50,true) returning id;`);
  const pSkip = one(`insert into public.products(store_id,name,base_price,stock_qty,track_stock) values ('${store}','${tag}-skip',1000,77,true) returning id;`);

  const opn = one(`insert into public.stock_opnames(store_id,status) values ('${store}','draft') returning id;`);
  sql(`insert into public.stock_opname_items(opname_id,product_id,system_qty,counted_qty) values
        ('${opn}','${pKurang}',100,87),
        ('${opn}','${pLebih}',50,58),
        ('${opn}','${pSkip}',77,null);`);

  const token = execFileSync('curl', ['-s', '-m', '10', '-X', 'POST', 'http://localhost:3000/api/auth/signin',
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ email: 'admin@example.com', password: adminPw })], { encoding: 'utf8' });
  const jwt = JSON.parse(token).session.access_token;

  const post = () => execFileSync('curl', ['-s', '-m', '15', '-w', '|%{http_code}', '-X', 'POST',
    'http://localhost:3000/api/rpc/post_stock_opname',
    '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${jwt}`,
    '-d', JSON.stringify({ p_opname_id: opn })], { encoding: 'utf8' });

  const r1 = post();
  record('Posting berhasil', r1.includes('|200'), r1.trim());

  record('Stok disamakan ke hasil hitung (100 -> 87)',
    one(`select stock_qty::int from public.products where id='${pKurang}';`) === '87');
  record('Stok naik ke hasil hitung (50 -> 58)',
    one(`select stock_qty::int from public.products where id='${pLebih}';`) === '58');
  record('Produk TIDAK dihitung tidak tersentuh (tetap 77)',
    one(`select stock_qty::int from public.products where id='${pSkip}';`) === '77');

  record('Mutasi adjust selisih kurang = -13',
    one(`select qty_delta::int from public.stock_movements where product_id='${pKurang}' and type='adjust';`) === '-13');
  record('Mutasi adjust selisih lebih = +8',
    one(`select qty_delta::int from public.stock_movements where product_id='${pLebih}' and type='adjust';`) === '8');
  record('Tidak ada mutasi untuk produk yang tidak dihitung',
    one(`select count(*) from public.stock_movements where product_id='${pSkip}';`) === '0');

  record('Status sesi jadi posted',
    one(`select status from public.stock_opnames where id='${opn}';`) === 'posted');

  // --- idempotensi ---
  const r2 = post();
  record('Posting ulang tidak error', r2.includes('|200'));
  record('Stok tidak berubah lagi setelah posting ulang',
    one(`select stock_qty::int from public.products where id='${pKurang}';`) === '87');
  record('Tidak ada mutasi ganda',
    one(`select count(*) from public.stock_movements where product_id='${pKurang}';`) === '1');

  // bersihkan
  sql(`delete from public.stock_opnames where id='${opn}';`);
  sql(`delete from public.products where name like '${tag}%';`);

  console.log('');
  console.log('--- RINGKASAN ---');
  const pass = results.filter((r) => r.p).length;
  console.log(pass + '/' + results.length + ' lolos');
  process.exitCode = pass === results.length ? 0 : 1;
})();
