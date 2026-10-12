// Sambungan deploy x service worker (TC-84, AC-66).
//
// Toko memakai service worker yang menyajikan index.html dari cache. Pengunjung
// yang pernah membuka toko sebelum rilis affiliate masih memuat aplikasi versi
// lama pada kunjungan pertama setelah deploy, dan aplikasi lama melempar alamat
// yang tidak dikenalnya (/aff/..., /toko/affiliate, /affiliate) ke /toko. Tanpa
// penyelamat di public/kasir-config.js klik affiliate itu hilang.
//
// Dijalankan manual sebelum deploy, karena butuh dua build produksi:
//   git worktree add ../kasir-lama <commit yang sedang tayang>
//   (di ../kasir-lama, node_modules ditautkan dari repo ini, .env.local disalin)
//     NODE_ENV=production npx vite build --outDir <tmp>/dist-lama --emptyOutDir
//   NODE_ENV=production npx vite build --outDir <tmp>/dist-baru --emptyOutDir
//   node scripts/verify_affiliate_stale_shell.cjs <tmp>/dist-lama <tmp>/dist-baru
// NODE_ENV=production wajib: .env lokal berisi NODE_ENV=development, yang
// membuat `vite build` biasa menghasilkan bundel mode pengembangan.
//
// API lokal harus hidup di port 3000. Suite ini menjalankan server statis
// sendiri di port 5180 yang bisa berganti folder, meniru satu kali deploy.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const { ADMIN_PASSWORD } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');

const PORT = 5180;
const ASAL = `http://localhost:${PORT}`;
const DIST_LAMA = path.resolve(process.argv[2] || '');
const DIST_BARU = path.resolve(process.argv[3] || '');
const { record, ringkas } = A.pencatat();

// ---------- server statis yang bisa berganti folder ----------

const JENIS = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' };
let dist = DIST_LAMA;
const permintaanDokumen = [];

function kirimBerkas(req, res, berkas) {
  const tipe = JENIS[path.extname(berkas)] || 'application/octet-stream';
  // Sama dengan Express di VPS: konfigurasi tidak pernah disimpan, sisanya divalidasi ulang.
  const kepala = { 'Content-Type': tipe, 'Cache-Control': path.basename(berkas) === 'kasir-config.js' ? 'no-store, must-revalidate' : 'public, max-age=0' };
  const isi = fs.readFileSync(berkas);
  if (/gzip/.test(req.headers['accept-encoding'] || '') && /javascript|css|html|svg|json/.test(tipe)) {
    const mampat = zlib.gzipSync(isi, { level: 1 });
    res.writeHead(200, { ...kepala, 'Content-Encoding': 'gzip', 'Content-Length': mampat.length, Vary: 'Accept-Encoding' });
    res.end(mampat);
    return;
  }
  res.writeHead(200, kepala);
  res.end(isi);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, ASAL);
  if (url.pathname.startsWith('/api/')) {
    const ke = http.request({ host: '127.0.0.1', port: 3000, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': '127.0.0.1' } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    ke.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(ke);
    return;
  }
  const calon = path.join(dist, decodeURIComponent(url.pathname));
  if (calon.startsWith(dist) && fs.existsSync(calon) && fs.statSync(calon).isFile()) return kirimBerkas(req, res, calon);
  // Dokumen yang benar-benar sampai ke server (yang disajikan service worker tidak lewat sini).
  permintaanDokumen.push(url.pathname);
  return kirimBerkas(req, res, path.join(dist, 'index.html'));
});

// ---------- jalannya uji ----------

(async () => {
  for (const [nama, d] of [['lama', DIST_LAMA], ['baru', DIST_BARU]]) {
    if (!fs.existsSync(path.join(d, 'index.html')) || !fs.existsSync(path.join(d, 'sw.js'))) {
      console.error(`Folder build ${nama} tidak berisi index.html dan sw.js: ${d}\nLihat cara pakai di kepala berkas ini.`);
      process.exit(2);
    }
  }
  const htmlLama = fs.readFileSync(path.join(DIST_LAMA, 'index.html'), 'utf8');
  const htmlBaru = fs.readFileSync(path.join(DIST_BARU, 'index.html'), 'utf8');
  record('Build lama belum membawa penanda cangkang, build baru membawanya', !/data-cangkang=/.test(htmlLama) && /data-cangkang="2"/.test(htmlBaru));

  // Deploy setengah jalan: konfigurasi baru sampai, index.html masih lama.
  // Dipakai membuktikan penyelamat hanya mencoba sekali dan tidak berputar.
  const distSetengah = fs.mkdtempSync(path.join(os.tmpdir(), 'cangkang-setengah-'));
  fs.cpSync(DIST_LAMA, distSetengah, { recursive: true });
  fs.copyFileSync(path.join(DIST_BARU, 'kasir-config.js'), path.join(distSetengah, 'kasir-config.js'));

  await new Promise((r) => server.listen(PORT, r));
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = A.psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const cap = Date.now().toString().slice(-6);
  const browser = await chromium.launch();

  try {
    await A.aturProgram(admin, { enabled: true, access_mode: 'approved', general_cookie: true, permanent: false });
    const aff = await A.daftarPembeli(toko, cap, 'sw');
    await A.izinkan(admin, aff.id);
    const kode = await A.kodeAffiliate(aff.token);
    const [produk] = A.produkUji(toko, 1);
    const klik = () => Number(A.psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${aff.id}'`));
    const linkProduk = `/aff/${kode}/${produk.id}?utm_source=what`;

    /** Konteks baru yang sudah dikendalikan service worker versi lama. */
    const pengunjungLama = async (siapkan) => {
      dist = DIST_LAMA;
      const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'allow' });
      const page = await ctx.newPage();
      if (siapkan) await siapkan(page);
      await page.goto(ASAL + '/toko', { waitUntil: 'load' });
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
      const jejak = [];
      page.on('framenavigated', (f) => {
        if (f === page.mainFrame()) jejak.push(new URL(f.url()).pathname);
      });
      return { ctx, page, jejak };
    };
    const swAktif = (page) =>
      page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return r ? (r.active ? 'aktif' : 'belum aktif') : 'tidak terdaftar';
      });

    // ---- 1. Pengunjung lama membuka link affiliate ----
    {
      const { ctx, page, jejak } = await pengunjungLama();
      dist = DIST_BARU;
      const sebelum = klik();
      const mulai = Date.now();
      await page.goto(ASAL + linkProduk, { waitUntil: 'load' });
      const tiba = await page.waitForURL((u) => u.pathname === '/toko/produk', { timeout: 20000 }).then(() => true).catch(() => false);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const url = new URL(page.url());
      record('Pengunjung lama, klik pertama setelah deploy: tiba di halaman produk yang dibagikan (AC-66)',
        tiba && url.searchParams.get('id') === produk.id, `${url.pathname}${url.search} setelah ${Date.now() - mulai} ms; jejak ${jejak.join(' -> ')}`);
      record('Klik pertama itu memasang cookie affiliate', (await ctx.cookies(ASAL)).some((c) => c.name === 'gnnk_aff'));
      record('Klik pertama itu tercatat sebagai tepat satu klik', klik() - sebelum === 1, `${klik() - sebelum} klik`);
      record('Halaman tidak sempat dilempar ke /toko oleh aplikasi lama', !jejak.includes('/toko'), jejak.join(' -> '));
      await page.waitForTimeout(3000);
      record('Service worker terpasang lagi sesudahnya (PWA tetap jalan)', (await swAktif(page)) === 'aktif', await swAktif(page));
      await ctx.close();
    }

    // ---- 2. Affiliate lama membuka dashboard dari tautan email ----
    {
      const { ctx, page, jejak } = await pengunjungLama((p) => p.addInitScript((t) => {
        try {
          localStorage.setItem('tokoku.customer.token.v1', t);
        } catch (_) { /* abaikan */ }
      }, aff.token));
      dist = DIST_BARU;
      await page.goto(ASAL + '/toko/affiliate?tab=komisi', { waitUntil: 'load' });
      const ada = await page.locator('[data-affiliate-layar]').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      const url = new URL(page.url());
      record('Affiliate lama membuka /toko/affiliate dari email: dashboard tampil di tab yang dituju (AC-66)',
        ada && url.pathname === '/toko/affiliate' && url.searchParams.get('tab') === 'komisi', `${url.pathname}${url.search}; jejak ${jejak.join(' -> ')}`);
      await ctx.close();
    }

    // ---- 3. Admin lama membuka menu Affiliate lewat alamat langsung ----
    {
      const { ctx, page, jejak } = await pengunjungLama(async (p) => {
        await p.goto(ASAL + '/login', { waitUntil: 'networkidle' });
        await p.fill('input[type="email"]', 'admin@example.com');
        await p.fill('input[type="password"]', ADMIN_PASSWORD);
        await p.click('button[type="submit"]');
        await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 });
        await p.waitForTimeout(4000);
      });
      dist = DIST_BARU;
      await page.goto(ASAL + '/affiliate?tab=pengaturan', { waitUntil: 'load' });
      const ada = await page.locator('[data-affiliate-layar]').first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
      const url = new URL(page.url());
      record('Admin lama membuka /affiliate: halaman Affiliate tampil, sesi tetap masuk (AC-66)',
        ada && url.pathname === '/affiliate', `${url.pathname}${url.search}; jejak ${jejak.join(' -> ')}`);
      await ctx.close();
    }

    // ---- 4. Alamat lama tidak ikut dimuat ulang ----
    {
      const { ctx, page } = await pengunjungLama();
      dist = DIST_BARU;
      permintaanDokumen.length = 0;
      await page.goto(ASAL + `/toko/produk?id=${produk.id}`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      record('Alamat yang sudah dikenal aplikasi lama tidak dimuat ulang paksa', permintaanDokumen.length === 0 && new URL(page.url()).pathname === '/toko/produk',
        `${permintaanDokumen.length} dokumen diminta ke server, tiba di ${new URL(page.url()).pathname}`);
      await ctx.close();
    }

    // ---- 5. Deploy setengah jalan: penyelamat mencoba sekali, tidak berputar ----
    {
      const { ctx, page, jejak } = await pengunjungLama();
      dist = distSetengah;
      permintaanDokumen.length = 0;
      await page.goto(ASAL + linkProduk, { waitUntil: 'load' });
      await page.waitForTimeout(7000);
      const dimuat = permintaanDokumen.filter((p) => p.startsWith('/aff/')).length;
      record('index.html masih lama: dimuat ulang tepat satu kali lalu berhenti, tanpa putaran', dimuat === 1 && new URL(page.url()).pathname === '/toko',
        `${dimuat} kali dimuat dari server, berakhir di ${new URL(page.url()).pathname}; jejak ${jejak.join(' -> ')}`);
      await ctx.close();
    }
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    await A.bersihkanUji(admin, `aff.sw.${cap}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    A.psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    fs.rmSync(distSetengah, { recursive: true, force: true });
    await new Promise((r) => server.close(r));
  }
  ringkas();
})();
