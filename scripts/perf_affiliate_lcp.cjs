// Kecepatan membuka link affiliate (NFR-1): LCP paling lama 2,5 detik di HP
// kelas menengah dengan jaringan 4G.
//
// Dijalankan manual terhadap BUILD PRODUKSI, bukan server pengembangan Vite:
//   NODE_ENV=production npx vite build
//   node scripts/perf_affiliate_lcp.cjs                (bawaan http://localhost:3000)
// NODE_ENV=production wajib di mesin pengembang: .env lokal berisi
// NODE_ENV=development, sehingga `npm run build` biasa menghasilkan bundel mode
// pengembangan (2,9 MB, React development) dan angkanya tidak mewakili produksi
// (1,9 MB). Server lokal melayani folder dist/ tanpa gzip, jadi untuk angka yang
// sebanding dengan VPS arahkan KASIR_LCP_URL ke server yang memampatkan berkasnya.
//   KASIR_LCP_URL=https://store.gnnkracing.id node scripts/perf_affiliate_lcp.cjs KODE [idProduk]
//
// Profil: layar 393x852, CPU diperlambat 4 kali, jaringan 4G (9 Mbps turun,
// 1,5 Mbps naik, latensi 170 ms), cache kosong di tiap putaran.

const { chromium } = require('playwright');

const ASAL = (process.env.KASIR_LCP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const PUTARAN = 5;
const BATAS_MS = 2500;

async function siapkanLokal() {
  const A = require('./lib/affiliate.cjs');
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = A.psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  await A.aturProgram(admin, { enabled: true, access_mode: 'approved' });
  const cap = Date.now().toString().slice(-6);
  const aff = await A.daftarPembeli(toko, cap, 'lcp');
  await A.izinkan(admin, aff.id);
  const kode = await A.kodeAffiliate(aff.token);
  const [produk] = A.produkUji(toko, 1);
  const pulihkan = async () => {
    A.psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    await A.bersihkanUji(admin, `aff.lcp.${cap}@contoh.id`);
  };
  return { kode, produk: produk.id, pulihkan };
}

(async () => {
  let kode = process.argv[2];
  let produk = process.argv[3] || '';
  let pulihkan = async () => {};
  if (!kode) ({ kode, produk, pulihkan } = await siapkanLokal());
  const alamat = `${ASAL}/aff/${kode}${produk ? '/' + produk : ''}`;
  const browser = await chromium.launch();
  const hasil = [];
  try {
    for (let i = 0; i < PUTARAN; i += 1) {
      const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        window.__lcp = 0;
        new PerformanceObserver((daftar) => {
          for (const e of daftar.getEntries()) window.__lcp = Math.max(window.__lcp, e.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      const mulai = Date.now();
      await page.goto(alamat, { waitUntil: 'load', timeout: 60000 });
      await page.waitForURL((u) => !u.pathname.startsWith('/aff/'), { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const lcp = Math.round(await page.evaluate(() => window.__lcp));
      const tiba = new URL(page.url());
      // LCP 0 berarti tidak ada gambar besar yang tercatat, dan alamat yang masih /aff/
      // berarti pengalihan tidak terjadi. Keduanya pengukuran tidak sah, dihitung gagal.
      const sah = lcp > 0 && !tiba.pathname.startsWith('/aff/');
      hasil.push(sah ? lcp : Infinity);
      console.log(`putaran ${i + 1}: LCP ${lcp} ms, tiba di ${tiba.pathname}${tiba.search} setelah ${Date.now() - mulai} ms${sah ? '' : ' (TIDAK SAH)'}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await pulihkan();
  }
  const urut = [...hasil].sort((a, b) => a - b);
  const median = urut[Math.floor(urut.length / 2)];
  const terburuk = urut[urut.length - 1];
  console.log(`\n${alamat}\nLCP median ${median} ms, terburuk ${terburuk} ms dari ${PUTARAN} putaran (batas ${BATAS_MS} ms)`);
  console.log(terburuk <= BATAS_MS ? 'LOLOS' : 'GAGAL');
  process.exitCode = terburuk <= BATAS_MS ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
