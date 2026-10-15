// Pengamanan halaman masuk staf (15 Okt 2026): /login tidak lagi membuka
// formulir staf di produksi. Formulir hanya ada di alamat rahasia
// ADMIN_LOGIN_PATH (/pintu-<acak>) yang memberi cookie gerbang HMAC; tanpa
// cookie itu /api/auth/signin berlagak tidak ada. Percobaan masuk dibatasi per
// email dan per IP, dan akun yang tidak ada dijawab selama sandi salah.
//
// Suite ini membangun bundel produksi (VITE_ADMIN_GERBANG=true) ke dist/, lalu
// menyalakan server sendiri di port 3014 dengan alamat rahasia acak.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('playwright');
const A = require('./lib/affiliate.cjs');

const ROOT = path.join(__dirname, '..');
const ENV = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const ADMIN_PW = (ENV.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const ABJAD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const RAHASIA = '/pintu-' + [...crypto.randomBytes(28)].map((b) => ABJAD[b % ABJAD.length]).join('');
const ASAL = 'http://127.0.0.1:3014';
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push(!!ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined && ket !== '' ? ' — ' + ket : ''));
};

(async () => {
  let server = null;
  const browser = await chromium.launch();
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--emptyOutDir'], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production', VITE_ADMIN_GERBANG: 'true', VITE_PUBLIC_STORE_ID: A.idToko() },
      stdio: 'ignore',
    });
    const aset = fs.readdirSync(path.join(ROOT, 'dist', 'assets')).filter((f) => f.endsWith('.js'));
    const bocor = aset.filter((f) => fs.readFileSync(path.join(ROOT, 'dist', 'assets', f), 'utf8').includes(RAHASIA.slice(7)));
    const sw = fs.readFileSync(path.join(ROOT, 'dist', 'sw.js'), 'utf8');
    record('Alamat rahasia tidak ada di bundel; service worker tidak melayani /pintu- dari cache', bocor.length === 0 && sw.includes('pintu-'), `${aset.length} berkas js diperiksa`);

    server = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: '3014', ADMIN_LOGIN_PATH: RAHASIA, ALLOW_DEMO_ACCOUNTS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const batas = setTimeout(() => reject(new Error('server 3014 tidak menyala')), 20000);
      server.stdout.on('data', (d) => String(d).includes('listening') && (clearTimeout(batas), resolve()));
    });

    const tanpaKue = await fetch(`${ASAL}/api/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: ADMIN_PW }) });
    const tidakAda = await fetch(`${ASAL}/api/auth/tidak-ada-rute`, { method: 'POST' });
    record('API masuk tanpa cookie gerbang dijawab sama seperti rute yang tidak ada (404), walau sandinya benar',
      tanpaKue.status === 404 && tidakAda.status === 404 && (await tanpaKue.text()).replace('/api/auth/signin', 'X') === (await tidakAda.text()).replace('/api/auth/tidak-ada-rute', 'X'), `${tanpaKue.status}`);

    for (const [nama, opsi] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['HP', { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
      const ctx = await browser.newContext(opsi);
      const p = await ctx.newPage();
      await p.goto(`${ASAL}/login`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(800);
      record(`${nama}: /login tidak menampilkan formulir staf dan dialihkan ke toko`,
        new URL(p.url()).pathname.startsWith('/toko') && (await p.locator('input[type="password"]').count()) === 0, new URL(p.url()).pathname);
      const jawab = await p.goto(`${ASAL}${RAHASIA}`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(800);
      const kue = (await ctx.cookies()).find((c) => c.name === 'kasir_pintu');
      const h = jawab.headers();
      record(`${nama}: alamat rahasia menampilkan formulir, cookie gerbang HttpOnly di /api/auth, tidak di-cache dan tidak diindeks`,
        (await p.locator('input[type="password"]').count()) === 1 && kue?.httpOnly && kue.path === '/api/auth' && kue.sameSite === 'Strict'
          && /no-store/.test(h['cache-control'] || '') && /noindex/.test(h['x-robots-tag'] || ''),
        `cookie ${kue ? `${kue.path} httpOnly=${kue.httpOnly} ${kue.sameSite}` : 'tidak ada'}, cache ${h['cache-control']}`);
      await p.screenshot({ path: path.join(ROOT, 'scripts', 'screenshots', `pintu-admin-${nama}.png`) }).catch(() => {});
      if (nama === 'desktop') {
        await p.fill('input[type="email"]', 'admin@example.com');
        await p.fill('input[type="password"]', ADMIN_PW);
        await p.click('button[type="submit"]');
        await p.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {});
        await p.waitForTimeout(1500);
        record('Admin asli masuk lewat alamat rahasia dan tiba di konsol', new URL(p.url()).pathname === '/' && (await p.getByText('ADMIN CONSOLE').count()) > 0, new URL(p.url()).pathname);

        // Batas percobaan: cookie gerbang sah, email uji acak, sandi salah.
        const surel = `uji.batas.${Date.now()}@contoh.id`;
        const status = await p.evaluate(async (e) => {
          const out = [];
          for (let i = 0; i < 6; i += 1) {
            const r = await fetch('/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'salah-' + i }) });
            out.push(r.status);
          }
          return out;
        }, surel);
        record('Lima sandi salah untuk satu email dijawab 401, percobaan keenam dikunci 429', status.slice(0, 5).every((s) => s === 401) && status[5] === 429, status.join(','));

        // Samaran waktu: akun tidak ada vs sandi salah akun ada, masing-masing 3 kali (median).
        const waktu = await p.evaluate(async () => {
          const ukur = async (email) => {
            const t = [];
            for (let i = 0; i < 3; i += 1) {
              const a = performance.now();
              await fetch('/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'salah-waktu' }) });
              t.push(performance.now() - a);
            }
            return t.sort((x, y) => x - y)[1];
          };
          return { tidakAda: await ukur(`tidak.ada.${Date.now()}@contoh.id`), adaSalah: await ukur('admin@example.com') };
        });
        const rasio = waktu.tidakAda / waktu.adaSalah;
        record('Akun tidak terdaftar dijawab selama sandi salah (tidak membocorkan email terdaftar)', rasio > 0.5 && rasio < 2, `${Math.round(waktu.tidakAda)} ms vs ${Math.round(waktu.adaSalah)} ms`);
      }
      await ctx.close();
    }
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  const lolos = hasil.filter(Boolean).length;
  console.log(`\n${lolos}/${hasil.length} lolos`);
  process.exitCode = lolos === hasil.length ? 0 : 1;
})();
