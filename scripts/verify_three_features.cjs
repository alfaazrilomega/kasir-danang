// Verifikasi tiga fitur: katalog SKU supplier, Stock Opname, Role management.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const BASE = 'http://localhost:5173';
const SHOTS = path.join(__dirname, '..', 'audit_screenshots');
const PSQL = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];

const sql = (q) =>
  execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: dbPw },
    encoding: 'utf8',
  }).trim();

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
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 }).then(() => true).catch(() => false));

    const dbInfo = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = () => {
        const db = req.result;
        resolve({ version: db.version, stores: Array.from(db.objectStoreNames) });
        db.close();
      };
    }));
    record('Dexie version minimal 11', dbInfo.version >= 11, 'v' + dbInfo.version);
    for (const t of ['stock_opnames', 'stock_opname_items', 'role_permissions']) {
      record('Tabel ' + t + ' ada', dbInfo.stores.includes(t));
    }

    // --- 1. Stock Opname ---
    await page.goto(BASE + '/stock-opname', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    record('Halaman Stock Opname render', await page.getByText('Stock Opname').first().isVisible());

    await page.getByRole('button', { name: /Mulai Sesi Baru/i }).click();
    await page.waitForTimeout(4000);
    const opnameRows = await page.locator('tbody tr').count();
    record('Sesi opname membekukan daftar produk', opnameRows > 0, opnameRows + ' produk');

    const opnameInPg = sql("select count(*) from public.stock_opnames where status='draft';");
    record('Sesi opname tersimpan di Postgres', Number(opnameInPg) >= 1, opnameInPg + ' sesi draft');

    // isi hitungan fisik pada baris pertama -> selisih harus muncul
    const firstCount = page.locator('tbody tr input[type="number"]').first();
    const sysQty = await page.locator('tbody tr').first().locator('td').nth(1).innerText();
    await firstCount.fill(String(Number(sysQty.replace(/[^0-9]/g, '')) + 5));
    await page.waitForTimeout(900);
    const bodyTxt = await page.locator('body').innerText();
    record('Selisih dihitung dan ditampilkan', /\+5/.test(bodyTxt), 'sistem ' + sysQty + ' -> +5');
    await page.screenshot({ path: path.join(SHOTS, '27_stock_opname.png') });

    // --- 2. Katalog supplier ---
    await page.goto(BASE + '/suppliers', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    // Nama harus persis 'Katalog': /Katalog/i juga cocok ke 'Export Katalog' di header.
    const katalogBtn = page.getByRole('button', { name: 'Katalog', exact: true }).first();
    const hasKatalog = await katalogBtn.isVisible().catch(() => false);
    record('Tombol Katalog ada di kartu supplier', hasKatalog);
    if (hasKatalog) {
      await katalogBtn.click();
      await page.waitForTimeout(1500);
      const modalOpen = await page.getByText('Katalog Barang').first().isVisible().catch(() => false);
      record('Modal katalog supplier terbuka', modalOpen);
      const addBtn = page.getByRole('button', { name: /^Tambah$/ }).first();
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(800);
        const hasSkuField = await page.getByText('Kode barang supplier').first().isVisible().catch(() => false);
        record('Baris katalog bisa ditambah', hasSkuField);
      } else {
        record('Baris katalog bisa ditambah', false, 'tombol Tambah tidak terlihat');
      }
      await page.screenshot({ path: path.join(SHOTS, '28_supplier_catalog.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }

    // --- 3. Role management ---
    await page.goto(BASE + '/users', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    // Klik tab 'Role & Permission'; /Role/i saja akan mengenai menu sidebar.
    await page.getByRole('button', { name: /Role & Permission/i }).first().click();
    await page.waitForTimeout(2000);
    const matrixButtons = await page.locator('table button').count();
    record('Sel matriks role bisa diklik', matrixButtons > 0, matrixButtons + ' sel');

    const before = sql("select count(*) from public.role_permissions;");
    // matikan satu capability lewat UI
    const cell = page.locator('table button:not([disabled])').first();
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.waitForTimeout(3000);
    const after = sql("select count(*) from public.role_permissions;");
    record('Klik matriks tersimpan ke Postgres', Number(after) > Number(before),
      before + ' -> ' + after + ' baris');
    const disabledRow = sql("select role||'/'||capability from public.role_permissions where enabled=false;");
    record('Baris tersimpan sebagai dimatikan', disabledRow.length > 0, disabledRow);
    await page.screenshot({ path: path.join(SHOTS, '29_role_matrix.png'), fullPage: true });

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.pass).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(SHOTS, '97_three_features_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    // bersihkan artefak uji
    try {
      sql('delete from public.role_permissions;');
      sql("delete from public.stock_opnames;");
      sql("delete from public.products where name='Uji Opname';");
    } catch (_) {}
    await browser.close();
  }
})();
