// Verifikasi kontras tombol di header berwarna, pada mode terang DAN gelap.
//
// Bug yang diperbaiki: tombol header memakai variant="secondary" lalu ditimpa
// className="bg-white ...". Aturan `.dark .btn-secondary` adalah selektor
// keturunan (spesifisitas 0,2,0) yang mengalahkan utility `bg-white` (0,1,0),
// sehingga di mode gelap latarnya jadi ink-800 sementara teksnya tetap gelap
// karena `!text-ink-900` — gelap di atas gelap.
//
// Konteks browser dibuat BARU untuk tiap mode supaya state sesi tidak melemah
// di tengah pengujian.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');

const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const ROUTES = ['/products', '/suppliers', '/purchases', '/expenses', '/stock-mutation'];

const lum = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  return m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255 : null;
};
// Tombol semi-transparan tampak sebagai campuran dengan latar header.
const composite = (fg, bg) => {
  const f = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(fg);
  const b = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  if (!f) return fg;
  const a = f[4] === undefined ? 1 : parseFloat(f[4]);
  if (a >= 1 || !b) return fg;
  const mix = (i) => Math.round(+f[i] * a + +b[i] * (1 - a));
  return `rgb(${mix(1)}, ${mix(2)}, ${mix(3)})`;
};

const results = [];
const record = (n, p, d) => {
  results.push({ n, p });
  console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
};

async function runMode(browser, mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  trackApi(page);
  try {
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    // Setel tema lewat store yang dipersist aplikasi; menempel class .dark
    // manual akan ditimpa applyTheme() saat React mount.
    await page.evaluate((m) => {
      localStorage.setItem('kasir.ui', JSON.stringify({ state: { theme: m }, version: 0 }));
    }, mode);
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    // Login bisa gagal saat server sibuk; tunggu eksplisit sampai keluar
    // dari /login agar kegagalannya jelas, bukan merembet ke asersi lain.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
      .catch(() => {});

    for (const route of ROUTES) {
      await page.goto('http://localhost:5173' + route, { waitUntil: 'networkidle' });
      const ready = await page
        .waitForFunction(() =>
          Array.from(document.querySelectorAll(
            'div[class*="bg-brand-600"], div[class*="from-brand-700"], div[class*="from-brand-600"]',
          )).some((el) => el.querySelectorAll('button').length > 0),
        { timeout: 25000 })
        .then(() => true)
        .catch(() => false);

      if (!ready) {
        record(`${mode.padEnd(5)} ${route.padEnd(16)} header ter-render`, false, page.url());
        continue;
      }

      const info = await page.evaluate(() => {
        const header = Array.from(document.querySelectorAll(
          'div[class*="bg-brand-600"], div[class*="from-brand-700"], div[class*="from-brand-600"]',
        )).find((el) => el.querySelectorAll('button').length > 0);
        const behind = getComputedStyle(header).backgroundColor;
        return {
          dark: document.documentElement.classList.contains('dark'),
          behind,
          buttons: Array.from(header.querySelectorAll('button')).map((b) => {
            const cs = getComputedStyle(b);
            return { text: b.innerText.trim().slice(0, 20), bg: cs.backgroundColor, fg: cs.color };
          }),
        };
      });

      if (info.dark !== (mode === 'dark')) {
        record(`${mode.padEnd(5)} ${route.padEnd(16)} mode aktif benar`, false, `dark=${info.dark}`);
        continue;
      }

      const problems = info.buttons.filter((b) => {
        const lb = lum(composite(b.bg, info.behind));
        const lf = lum(b.fg);
        return lb !== null && lf !== null && Math.abs(lb - lf) < 0.3;
      });
      record(
        `${mode.padEnd(5)} ${route.padEnd(16)} kontras tombol header`,
        info.buttons.length > 0 && problems.length === 0,
        problems.length ? JSON.stringify(problems) : `${info.buttons.length} tombol terbaca`,
      );
    }

    await page.goto('http://localhost:5173/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 800 });
    await page.screenshot({
      path: path.join(__dirname, '..', 'audit_screenshots', `35_products_${mode}.png`),
      clip: { x: 264, y: 55, width: 1176, height: 140 },
    });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    await runMode(browser, 'light');
    await runMode(browser, 'dark');
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
