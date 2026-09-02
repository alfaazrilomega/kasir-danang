// Verifikasi Pengeluaran + Laba Rugi:
// - halaman /expenses render dan bisa mencatat pengeluaran
// - baris tersimpan ke Dexie DAN Postgres
// - tab Laba Rugi memotong pengeluaran jadi Laba Bersih
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5173';
const SHOTS = path.join(__dirname, '..', 'audit_screenshots');
const PSQL = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';

function dbPassword() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  return /:\/\/[^:]+:([^@]*)@/.exec(line)[1];
}

function sql(q) {
  return execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: dbPassword() },
    encoding: 'utf8',
  }).trim();
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  trackApi(page);
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass });
    console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + detail : ''));
  };
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  const adminPw = fs
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD='))
    .split('=')[1];

  const marker = 'UJI-OPEX-' + Date.now();

  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('kasir');
      q.onsuccess = q.onerror = q.onblocked = () => r(true);
    }));
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
    record('Login admin (akun database asli)', !page.url().includes('/login'));

    // Dexie v9 + tabel expenses
    const dbInfo = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = () => {
        const db = req.result;
        const stores = Array.from(db.objectStoreNames);
        if (!stores.includes('expenses')) { resolve({ version: db.version, stores, count: 0 }); db.close(); return; }
        const c = db.transaction('expenses', 'readonly').objectStore('expenses').count();
        c.onsuccess = () => { resolve({ version: db.version, stores, count: c.result }); db.close(); };
      };
    }));
    record('Dexie version minimal 9', dbInfo.version >= 9, 'v' + dbInfo.version);
    record('Tabel expenses ada di IndexedDB', dbInfo.stores.includes('expenses'));
    record('Seed pengeluaran terisi', dbInfo.count > 0, dbInfo.count + ' baris');

    // Halaman Pengeluaran
    await page.goto(BASE + '/expenses', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    const heading = await page.getByText('Pengeluaran', { exact: false }).first().isVisible().catch(() => false);
    record('Halaman /expenses render', heading);
    const rowsBefore = await page.locator('tbody tr').count();
    record('Tabel pengeluaran ada isinya', rowsBefore > 0, rowsBefore + ' baris');
    await page.screenshot({ path: path.join(SHOTS, '24_expenses_page.png') });

    // Catat pengeluaran baru
    await page.getByRole('button', { name: /Catat Pengeluaran/i }).click();
    await page.waitForTimeout(1200);
    await page.locator('input[type="number"]').first().fill('1234567');
    await page.locator('input[placeholder*="Sewa ruko"]').fill(marker);
    await page.getByRole('button', { name: /^Simpan$/ }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, '25_expenses_after_create.png') });

    const inDexie = await page.evaluate((mk) => new Promise((resolve) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction('expenses', 'readonly').objectStore('expenses').getAll();
        all.onsuccess = () => { resolve(all.result.filter((r) => r.description === mk).length); db.close(); };
      };
    }), marker);
    record('Pengeluaran baru tersimpan di IndexedDB', inDexie === 1, inDexie + ' baris');

    const inPg = sql(`select count(*) from public.expenses where description='${marker}';`);
    record('Pengeluaran baru tersimpan di Postgres', inPg === '1', inPg + ' baris');
    const amt = sql(`select amount::int from public.expenses where description='${marker}';`);
    record('Nominal benar tersimpan', amt === '1234567', 'Rp ' + amt);

    // Laba Rugi memotong pengeluaran
    await page.goto(BASE + '/reports', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    const pnlTab = page.getByRole('button', { name: /Laba Rugi/i }).first();
    await pnlTab.click().catch(() => {});
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    record('Tab Laba Rugi punya baris Pengeluaran Operasional', /Pengeluaran Operasional/i.test(body));
    record('Tab Laba Rugi punya baris Laba Bersih', /Laba Bersih/i.test(body));

    const nums = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('dl > div'));
      const grab = (label) => {
        const el = rows.find((r) => r.textContent.trim().startsWith(label));
        if (!el) return null;
        const spans = el.querySelectorAll('span');
        return spans.length > 1 ? spans[spans.length - 1].textContent.trim() : null;
      };
      return { gross: grab('Laba Kotor'), opex: grab('Pengeluaran Operasional'), net: grab('Laba Bersih') };
    });
    console.log('    Laba Kotor=' + nums.gross + '  Opex=' + nums.opex + '  Laba Bersih=' + nums.net);
    const toNum = (v) => Number(String(v || '0').replace(/[^0-9-]/g, ''));
    // Baris opex sudah tampil bertanda minus, jadi pakai nilai absolutnya.
    const ok = nums.gross && nums.net && Math.abs((toNum(nums.gross) - Math.abs(toNum(nums.opex))) - toNum(nums.net)) <= 2;
    record('Laba Bersih = Laba Kotor - Pengeluaran', ok);
    record('Laba Bersih berbeda dari Laba Kotor', toNum(nums.net) !== toNum(nums.gross));
    await page.screenshot({ path: path.join(SHOTS, '26_pnl_net_profit.png'), fullPage: true });

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.pass).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(SHOTS, '98_expenses_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    try { sql(`delete from public.expenses where description='${marker}';`); } catch (_) {}
    await browser.close();
  }
})();
