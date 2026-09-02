// QC endpoint NON-/api/query: /api/auth/*, /api/admin/*, /api/rpc/*, /api/health.
//
// Ditambahkan setelah bug "Tambah User gagal" lolos dari QC sebelumnya yang
// hanya menguji /api/query. Diuji dengan tiga jenis sesi:
//   - admin asli (UUID)
//   - akun demo
//   - token LAMA bersub demo (kasus nyata: browser belum login ulang)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const line = (k) => (envText.split(/\r?\n/).find((l) => l.startsWith(k + '=')) || '').slice(k.length + 1);
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(line('DATABASE_URL'))[1];
const adminPw = line('BOOTSTRAP_ADMIN_PASSWORD');
const authSecret = line('AUTH_SECRET');
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim().split('\n')[0].trim();

const curl = (args) => execFileSync('curl', ['-s','-m','15','-w','|%{http_code}', ...args], { encoding: 'utf8' });
const call = (method, url, jwt, body) => {
  const args = ['-X', method, 'http://localhost:3000' + url];
  if (jwt) args.push('-H', `Authorization: Bearer ${jwt}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  const res = curl(args);
  return { code: res.split('|').pop().trim(), body: res.slice(0, res.lastIndexOf('|')) };
};

// Token lama bersub demo, seperti yang tersimpan di browser pengguna.
const legacyToken = (sub, email) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', authSecret).update(`${h}.${p}`).digest('base64url')}`;
};

const results = [];
const expect = (name, r, want) => {
  const ok = String(r.code) === String(want);
  results.push({ name, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + ` [${want}]` + (ok ? '' : ` — dapat ${r.code} ${r.body.slice(0, 120)}`));
};

(async () => {
  const store = sql("select id from public.stores order by created_at limit 1;");
  const admin = JSON.parse(call('POST', '/api/auth/signin', null, { email: 'admin@example.com', password: adminPw }).body);
  const A = admin.session.access_token;
  const K = JSON.parse(call('POST', '/api/auth/signin', null, { email: 'kasir@example.com', password: 'kasir12345' }).body).session.access_token;
  const LEGACY = legacyToken('usr-admin-001', 'admin@example.com');
  const tag = 'QCE-' + Date.now();

  // ---- health & auth ----
  expect('GET /api/health', call('GET', '/api/health'), 200);
  expect('signin password salah', call('POST', '/api/auth/signin', null, { email: 'admin@example.com', password: 'salah' }), 401);
  expect('signin email tak dikenal', call('POST', '/api/auth/signin', null, { email: 'nobody@x.com', password: 'x' }), 401);
  expect('GET /api/auth/session (admin)', call('GET', '/api/auth/session', A), 200);
  expect('GET /api/auth/user (admin)', call('GET', '/api/auth/user', A), 200);
  expect('tanpa token ditolak', call('GET', '/api/auth/session'), 401);
  expect('token ngawur ditolak', call('GET', '/api/auth/session', 'bukan.token.valid'), 401);
  expect('signup publik dimatikan', call('POST', '/api/auth/signup', null, { email: 'a@b.c', password: 'rahasia123' }), 403);

  // ---- admin: sesi ASLI ----
  expect('GET /api/admin/users', call('GET', '/api/admin/users', A), 200);
  expect('GET /api/admin/system', call('GET', '/api/admin/system', A), 200);
  expect('GET /api/admin/audit-logs', call('GET', '/api/admin/audit-logs?limit=5', A), 200);
  expect('kasir DITOLAK di /api/admin/users', call('GET', '/api/admin/users', K), 403);

  const created = call('POST', '/api/admin/users', A, { email: `${tag}@example.com`, password: 'rahasia12345', full_name: 'QC User', role: 'cashier' });
  expect('POST /api/admin/users (buat user)', created, 201);
  const newId = created.code === '201' ? JSON.parse(created.body).data.id : null;

  expect('POST user: email duplikat', call('POST', '/api/admin/users', A, { email: `${tag}@example.com`, password: 'rahasia12345', full_name: 'X', role: 'cashier' }), 409);
  expect('POST user: password pendek', call('POST', '/api/admin/users', A, { email: `${tag}b@example.com`, password: '123', full_name: 'X', role: 'cashier' }), 400);
  expect('POST user: role ngawur', call('POST', '/api/admin/users', A, { email: `${tag}c@example.com`, password: 'rahasia12345', full_name: 'X', role: 'dewa' }), 400);

  if (newId) {
    expect('PATCH user (ubah nama & role)', call('PATCH', `/api/admin/users/${newId}`, A, { full_name: 'QC Updated', role: 'warehouse' }), 200);
    expect('PATCH user: reset password', call('PATCH', `/api/admin/users/${newId}`, A, { password: 'rahasiabaru123' }), 200);
    expect('DELETE user', call('DELETE', `/api/admin/users/${newId}`, A), 200);
  }
  expect('admin tak bisa hapus dirinya sendiri', call('DELETE', `/api/admin/users/${admin.user.id}`, A), 400);

  // ---- admin: TOKEN LAMA bersub demo (bug yang dilaporkan) ----
  expect('token lama: GET /api/admin/users', call('GET', '/api/admin/users', LEGACY), 200);
  expect('token lama: GET /api/admin/system', call('GET', '/api/admin/system', LEGACY), 200);
  const legacyCreated = call('POST', '/api/admin/users', LEGACY, { email: `${tag}-legacy@example.com`, password: 'rahasia12345', full_name: 'Legacy', role: 'warehouse' });
  expect('token lama: POST /api/admin/users', legacyCreated, 201);
  expect('token lama: baca profiles', call('POST', '/api/query', LEGACY, { table: 'profiles', action: 'select', maybeSingle: true }), 200);
  expect('token lama: baca stores', call('POST', '/api/query', LEGACY, { table: 'stores', action: 'select', maybeSingle: true }), 200);
  expect('token lama: baca products', call('POST', '/api/query', LEGACY, { table: 'products', action: 'select', limit: 1 }), 200);

  // ---- RPC ----
  const opn = sql(`insert into public.stock_opnames(store_id,status) values ('${store}','draft') returning id;`);
  expect('RPC post_stock_opname (admin)', call('POST', '/api/rpc/post_stock_opname', A, { p_opname_id: opn }), 200);
  expect('RPC post_stock_opname (kasir ditolak)', call('POST', '/api/rpc/post_stock_opname', K, { p_opname_id: opn }), 403);
  expect('RPC tanpa parameter', call('POST', '/api/rpc/post_stock_opname', A, {}), 400);
  expect('RPC tidak dikenal', call('POST', '/api/rpc/tidak_ada', A, {}), 404);
  expect('RPC apply_order_stock', call('POST', '/api/rpc/apply_order_stock', A, { p_order_id: sql(`select id from public.orders where store_id='${store}' limit 1;`) }), 200);

  // ---- input rusak ----
  // Kirim JSON benar-benar rusak lewat curl mentah (bukan body kosong).
  const malformed = execFileSync('curl', ['-s','-m','10','-w','|%{http_code}','-X','POST',
    'http://localhost:3000/api/query','-H','Content-Type: application/json',
    '-H', `Authorization: Bearer ${A}`, '-d', '{"table": '], { encoding: 'utf8' });
  expect('JSON rusak', { code: malformed.split('|').pop().trim(), body: malformed }, 400);
  expect('tabel tak dikenal', call('POST', '/api/query', A, { table: 'tabel_hantu', action: 'select' }), 400);
  expect('aksi tak dikenal', call('POST', '/api/query', A, { table: 'products', action: 'drop' }), 400);
  expect('kolom tak dikenal', call('POST', '/api/query', A, { table: 'products', action: 'select', columns: 'id,hantu' }), 400);
  expect('limit di luar batas', call('POST', '/api/query', A, { table: 'products', action: 'select', limit: 99999 }), 400);
  expect('delete tanpa filter ditolak', call('POST', '/api/query', A, { table: 'products', action: 'delete' }), 400);

  // bersihkan
  try {
    sql(`delete from public.app_users where email like '${tag}%';`);
    sql(`delete from public.stock_opnames where id='${opn}';`);
  } catch (_) {}

  console.log('');
  console.log('--- RINGKASAN QC ENDPOINT ---');
  const pass = results.filter((r) => r.ok).length;
  console.log(pass + '/' + results.length + ' lolos');
  process.exitCode = pass === results.length ? 0 : 1;
})();
