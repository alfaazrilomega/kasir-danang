// Verifikasi antrean tulis offline:
// edit produk saat offline -> masuk pending_writes -> online -> terkirim ke Postgres.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
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

const marker = 'OUTBOX-' + Date.now();

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  trackApi(page);
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass });
    console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + detail : ''));
  };
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
  const apiCalls = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/api/query')) return;
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch (_) {}
    let req = '';
    try { req = (res.request().postData() || '').slice(0, 2000); } catch (_) {}
    apiCalls.push(res.status() + ' <= ' + req + '  ==> ' + body);
  });

  const countQueued = () =>
    page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('pending_writes')) { resolve(-1); db.close(); return; }
        const c = db.transaction('pending_writes', 'readonly').objectStore('pending_writes').count();
        c.onsuccess = () => { resolve(c.result); db.close(); };
      };
    }));

  try {
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
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
    record('Login admin', !page.url().includes('/login'));
    record('Tabel pending_writes ada', (await countQueued()) >= 0);

    await page.goto('http://localhost:5173/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });

    // --- OFFLINE ---
    await context.setOffline(true);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Tambah Produk/i }).click();
    await page.waitForTimeout(1200);
    await page.locator('input[placeholder*="Iced Latte"]').fill(marker);
    // Pastikan tanpa kategori: kategori hasil seed ber-id 'cat-1' (bukan UUID)
    // dan akan ditolak server — itu masalah data demo, bukan outbox.
    await page.locator('select').first().selectOption('').catch(() => {});
    await page.getByRole('button', { name: /^Simpan$/ }).click();
    await page.waitForTimeout(2500);

    const queuedAfterSave = await countQueued();
    record('Edit offline masuk antrean', queuedAfterSave > 0, queuedAfterSave + ' item');

    const body = await page.locator('body').innerText();
    record('Pengguna diberi tahu tersimpan lokal', /disimpan lokal|akan dikirim/i.test(body));

    const inPgBefore = sql(`select count(*) from public.products where name='${marker}';`);
    record('Belum ada di Postgres saat offline', inPgBefore === '0', inPgBefore + ' baris');
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '31_outbox_offline.png') });

    // --- ONLINE lagi ---
    await context.setOffline(false);
    await page.waitForTimeout(1000);
    // Peristiwa 'online' memicu flushWrites lewat bindOnlineSync.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(6000);

    console.log('  >> panggilan /api/query selama flush:');
    for (const c of apiCalls.filter((x) => !x.startsWith('200'))) console.log('     ' + c);
    const afterBody = await page.locator('body').innerText();
    const tolak = /ditolak server.*/i.exec(afterBody);
    if (tolak) console.log('  >> toast penolakan:', tolak[0]);
    const queuedAfterFlush = await countQueued();
    record('Antrean kosong setelah online', queuedAfterFlush === 0, queuedAfterFlush + ' tersisa');

    const inPgAfter = sql(`select count(*) from public.products where name='${marker}';`);
    record('Perubahan sampai ke Postgres', inPgAfter === '1', inPgAfter + ' baris');
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '32_outbox_flushed.png') });

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.pass).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '96_outbox_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    try { sql(`delete from public.products where name='${marker}';`); } catch (_) {}
    await browser.close();
  }
})();
