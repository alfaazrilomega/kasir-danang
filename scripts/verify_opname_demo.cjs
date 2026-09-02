// Reproduksi bug "Gagal membuat sesi opname" dengan login akun demo gudang.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  trackApi(page);
  const toasts = [];
  page.on('console', () => {});
  try {
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('kasir');
      q.onsuccess = q.onerror = q.onblocked = () => r(true);
    }));
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'gudang@example.com');
    await page.fill('input[type="password"]', 'gudang12345');
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    // Login bisa gagal saat server sibuk; tunggu eksplisit sampai keluar
    // dari /login agar kegagalannya jelas, bukan merembet ke asersi lain.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
      .catch(() => {});
    console.log('URL setelah login:', page.url());

    const storeId = await page.evaluate(() => {
      const raw = localStorage.getItem('kasir.auth.token.v1');
      return raw ? 'token ada' : 'token tidak ada';
    });
    console.log('auth:', storeId);

    await page.goto('http://localhost:5173/stock-opname', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    const before = sql("select count(*) from public.stock_opnames;");

    await page.getByRole('button', { name: /Mulai Sesi Baru/i }).click();
    await page.waitForTimeout(5000);

    const body = await page.locator('body').innerText();
    const errShown = /Gagal membuat sesi opname|tidak cocok|tidak boleh/i.test(body);
    const warnShown = /tersimpan di server/i.test(body);
    console.log('toast peringatan :', warnShown);
    const okShown = /Sesi opname dibuat/i.test(body);
    const after = sql("select count(*) from public.stock_opnames;");
    const itemsPg = sql("select count(*) from public.stock_opname_items;");
    const rows = await page.locator('tbody tr').count();

    console.log('toast sukses     :', okShown);
    console.log('toast error      :', errShown);
    console.log('sesi di Postgres :', before, '->', after);
    console.log('item di Postgres :', itemsPg);
    console.log('baris di tabel   :', rows);
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '30_opname_demo.png') });
    process.exitCode = okShown && !errShown && Number(after) > Number(before) ? 0 : 1;
  } catch (e) {
    console.log('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    try { sql('delete from public.stock_opnames;'); } catch (_) {}
    await browser.close();
  }
})();
