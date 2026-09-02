const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  trackApi(page);
  const results = [];
  const record = (n, p, d) => { results.push({ n, p }); console.log((p?'PASS  ':'FAIL  ')+n+(d?' — '+d:'')); };
  page.on('console', (m) => { if (m.type()==='warning' && m.text().includes('Seed push')) console.log('  [warn]', m.text().slice(0,300)); });
  try {
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('kasir'); q.onsuccess=q.onerror=q.onblocked=()=>r(1); }));
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    // Login bisa gagal saat server sibuk; tunggu eksplisit sampai keluar
    // dari /login agar kegagalannya jelas, bukan merembet ke asersi lain.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
      .catch(() => {});
    record('Login admin', !page.url().includes('/login'));
    for (const t of ['categories','products','customers','suppliers','shifts','orders','order_items','expenses','product_channel_mappings']) {
      const n = Number(sql(`select count(*) from public.${t};`));
      record(`${t} terdorong ke Postgres`, n > 0, n + ' baris');
    }
    const badId = sql("select count(*) from public.products where id::text !~ '^[0-9a-f]{8}-';");
    record('Semua id produk berbentuk UUID', badId === '0');
    console.log(''); console.log('--- RINGKASAN ---');
    const pass = results.filter(r=>r.p).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) { console.log('ERROR: ' + e.message); process.exitCode = 1; }
  finally { await browser.close(); }
})();
