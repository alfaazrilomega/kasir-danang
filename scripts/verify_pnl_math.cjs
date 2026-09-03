// Uji LOGIKA Laba Rugi: angka di layar dibandingkan dengan hitungan SQL
// independen langsung dari Postgres. Rentang sengaja sangat lebar supaya
// perbedaan zona waktu tidak memicu selisih palsu.
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

const FROM = '2020-01-01';
const TO = '2030-12-31';

/** Cap isi database yang dipakai laporan ini. */
const sidikJari = () =>
  sql(
    `select (select count(*) from public.orders)::text || '/' ||
            (select count(*) from public.order_items)::text || '/' ||
            (select count(*) from public.expenses)::text;`,
  );

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tunggu sampai isi database berhenti berubah.
 *
 * Aplikasi mendorong data contoh ke server TANPA menunggunya selesai
 * (`void pushSeedToServer()` di src/stores/auth.ts) supaya layar login tidak
 * tertahan belasan detik. Akibatnya baris masih berdatangan saat uji berjalan,
 * sedangkan angka layar dan angka SQL dibaca pada dua saat yang berbeda — itu
 * saja sudah cukup membuat keduanya berbeda tanpa ada yang salah.
 */
async function tungguTenang(batasMs = 90000) {
  const mulai = Date.now();
  let sebelum = sidikJari();
  while (Date.now() - mulai < batasMs) {
    await tidur(2500);
    const sekarang = sidikJari();
    if (sekarang === sebelum) return sekarang;
    sebelum = sekarang;
  }
  return sebelum;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  trackApi(page);
  const results = [];
  const record = (n, p, d) => {
    results.push({ n, p });
    console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
  };
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));

  try {
    await tungguTenang();

    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    // Login bisa gagal saat server sibuk; tunggu eksplisit sampai keluar
    // dari /login agar kegagalannya jelas, bukan merembet ke asersi lain.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
      .catch(() => {});

    await page.goto('http://localhost:5173/reports', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });

    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(FROM);
    await dates.nth(1).fill(TO);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Laba Rugi/i }).first().click();
    await page.waitForTimeout(2500);

    const bacaUI = () => page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('dl > div'));
      const grab = (label) => {
        const el = rows.find((r) => r.textContent.trim().startsWith(label));
        if (!el) return null;
        const spans = el.querySelectorAll('span');
        return spans.length > 1 ? spans[spans.length - 1].textContent.trim() : null;
      };
      return {
        revenue: grab('Pendapatan'),
        cogs: grab('HPP'),
        gross: grab('Laba Kotor'),
        opex: grab('Pengeluaran Operasional'),
        net: grab('Laba Bersih'),
      };
    });
    // Jangan pakai Math.abs: laba bersih BOLEH negatif dan tandanya bermakna.
    const num = (v) => Number(String(v || '0').replace(/[^0-9-]/g, ''));
    // Baris pengeluaran ditampilkan dengan tanda minus di depan.
    const magnitude = (v) => Math.abs(num(v));

    // --- hitungan independen dari Postgres ---
    const bacaSql = () => ({
      revenueSql: Number(sql(
        `select coalesce(sum(total - tax),0)::bigint from public.orders
          where order_status <> 'canceled'
            and created_at::date between '${FROM}' and '${TO}';`)),
      cogsSql: Number(sql(
        `select coalesce(sum(coalesce(i.cost_price,0) * i.qty),0)::bigint
           from public.order_items i
           join public.orders o on o.id = i.order_id
          where o.order_status <> 'canceled'
            and o.created_at::date between '${FROM}' and '${TO}';`)),
      opexSql: Number(sql(
        `select coalesce(sum(amount),0)::bigint from public.expenses
          where expense_date between '${FROM}' and '${TO}';`)),
    });

    // Angka layar dan angka SQL harus berasal dari isi database yang sama.
    // Kalau berubah di antara dua pembacaan, keduanya dibaca ulang sekali —
    // membandingkan dua keadaan berbeda hanya menghasilkan alarm palsu.
    let sidikSebelum = sidikJari();
    let ui = await bacaUI();
    let { revenueSql, cogsSql, opexSql } = bacaSql();

    if (sidikJari() !== sidikSebelum) {
      console.log('  Isi database berubah saat dibaca; menunggu tenang lalu mengulang.');
      await tungguTenang();
      await page.reload({ waitUntil: 'networkidle' });
      await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
      await dates.nth(0).fill(FROM);
      await dates.nth(1).fill(TO);
      await page.waitForTimeout(2500);
      await page.getByRole('button', { name: /Laba Rugi/i }).first().click();
      await page.waitForTimeout(2500);
      sidikSebelum = sidikJari();
      ui = await bacaUI();
      ({ revenueSql, cogsSql, opexSql } = bacaSql());
      record('Isi database tenang saat dibandingkan', sidikJari() === sidikSebelum);
    }

    console.log(`  SQL  pendapatan=${revenueSql} hpp=${cogsSql} opex=${opexSql}`);
    console.log(`  UI   pendapatan=${magnitude(ui.revenue)} hpp=${magnitude(ui.cogs)} opex=${magnitude(ui.opex)}`);
    console.log(`  UI   laba kotor=${ui.gross}  laba bersih=${ui.net}`);
    console.log(`  Harapan: laba bersih = ${revenueSql - cogsSql - opexSql}`);

    const near = (a, b) => Math.abs(a - b) <= 2;
    record('Pendapatan UI = SQL', near(magnitude(ui.revenue), revenueSql));
    record('HPP UI = SQL', near(magnitude(ui.cogs), cogsSql));
    record('Pengeluaran UI = SQL', near(magnitude(ui.opex), opexSql));
    record('Laba Kotor = Pendapatan - HPP', near(num(ui.gross), revenueSql - cogsSql));
    record('Laba Bersih = Laba Kotor - Pengeluaran', near(num(ui.net), revenueSql - cogsSql - opexSql));
    record('Laba Bersih < Laba Kotor (opex benar dipotong)', num(ui.net) < num(ui.gross));
    // Tandanya harus mengikuti hitungan, bukan diasumsikan. Dulu uji ini
    // mengunci 'selalu minus' mengikuti data demo saat itu, lalu ikut merah
    // begitu data demo dibangun ulang dan labanya jadi positif.
    const netSql = revenueSql - cogsSql - opexSql;
    const netTampilMinus = /-/.test(String(ui.net));
    record('Tanda laba bersih sesuai hitungan', netTampilMinus === netSql < 0,
      `${ui.net} (SQL ${Math.round(netSql)})`);

    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '33_pnl_math.png'), fullPage: true });

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.p).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
