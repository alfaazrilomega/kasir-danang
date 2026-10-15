// Celah 15 Okt 2026: di produksi, kredensial demo yang tercetak di halaman /login
// (admin@example.com / change-me-strong-password) memberi sesi admin toko asli,
// dan sandi salah di /login membuka konsol admin berisi data demo atau cache.
//
// Suite ini menyalakan server sendiri seperti produksi (ALLOW_DEMO_ACCOUNTS
// tidak true) di port 3012, plus server demo di port 3013 hanya untuk
// menerbitkan token demo, lalu membuktikan:
//   - kredensial demo ditolak, token demo yang terlanjur terbit ditolak;
//   - akun admin asli tetap bisa masuk;
//   - halaman /login tidak lagi menawarkan akun demo, dan sandi salah tetap di /login.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { BASE_URL } = require('./lib/harness.cjs');

const ROOT = path.join(__dirname, '..');
const ENV = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const ADMIN_PW = (ENV.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push(!!ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined && ket !== '' ? ' — ' + ket : ''));
};

function nyalakan(port, demo) {
  const p = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ALLOW_DEMO_ACCOUNTS: demo ? 'true' : 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const batas = setTimeout(() => reject(new Error(`server ${port} tidak menyala`)), 20000);
    p.stdout.on('data', (d) => {
      if (String(d).includes('listening')) {
        clearTimeout(batas);
        resolve(p);
      }
    });
  });
}

const masuk = (port, email, password) =>
  fetch(`http://127.0.0.1:${port}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));

(async () => {
  const proses = [];
  try {
    proses.push(await nyalakan(3012, false));
    proses.push(await nyalakan(3013, true));

    for (const [email, sandi] of [['gudang@example.com', 'gudang12345'], ['kasir@example.com', 'kasir12345'], ['customer@example.com', 'customer12345']]) {
      const r = await masuk(3012, email, sandi);
      record(`Mode produksi: kredensial demo ${email} ditolak`, r.status === 401, `${r.status} ${r.j.error || r.j.user?.id || ''}`);
    }

    const demo = await masuk(3013, 'gudang@example.com', 'gudang12345');
    const token = demo.j.session?.access_token;
    record('Server demo (pengembangan) masih bisa menerbitkan token demo', demo.status === 200 && !!token, demo.j.user?.id);
    const sesi = await fetch('http://127.0.0.1:3012/api/auth/session', { headers: { Authorization: `Bearer ${token}` } });
    const kueri = await fetch('http://127.0.0.1:3012/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ table: 'products', action: 'select', columns: 'id', filters: [], limit: 1 }),
    });
    record('Mode produksi: token demo yang terlanjur terbit ditolak (sesi dan baca data)', sesi.status === 401 && kueri.status === 401, `${sesi.status}/${kueri.status}`);

    const asli = await masuk(3012, 'admin@example.com', ADMIN_PW);
    record('Mode produksi: akun admin asli di database tetap bisa masuk', asli.status === 200 && asli.j.user?.role === 'admin' && /^[0-9a-f-]{36}$/.test(asli.j.user?.id || ''), `${asli.status} ${asli.j.user?.role}`);

    const browser = await chromium.launch();
    for (const [nama, opsi] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['HP', { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
      const p = await (await browser.newContext(opsi)).newPage();
      await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      const tawaranDemo = await p.getByText(/Akun Demo|example\.com/).count();
      await p.fill('input[type="email"]', `orang.asing.${Date.now()}@contoh.id`);
      await p.fill('input[type="password"]', 'sandi-asal-salah');
      await p.click('button[type="submit"]');
      await p.waitForTimeout(2500);
      const url = new URL(p.url()).pathname;
      record(`${nama}: /login tanpa akun demo; sandi salah tetap di /login dengan pesan, bukan konsol admin`,
        tawaranDemo === 0 && url === '/login' && (await p.getByText('Email atau password salah.').count()) > 0 && (await p.getByText('ADMIN CONSOLE').count()) === 0,
        `demo ${tawaranDemo}, url ${url}`);
    }
    await browser.close();
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    for (const p of proses) p.kill();
  }
  const lolos = hasil.filter(Boolean).length;
  console.log(`\n${lolos}/${hasil.length} lolos`);
  process.exitCode = lolos === hasil.length ? 0 : 1;
})();
