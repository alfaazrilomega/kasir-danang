// Permintaan 19 (15 Okt 2026): "mode opsi black + white khusus user / calon
// pembeli". Toko mulai terang, pembeli bisa memilih gelap lewat footer (semua
// layar) dan tombol header (layar lebar), pilihan bertahan di browser pembeli,
// dan tema toko terpisah dari tema konsol admin ke dua arah.

const { chromium } = require('playwright');
const { loginAdmin, trackApi, BASE_URL } = require('./lib/harness.cjs');

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push(!!ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined && ket !== '' ? ' — ' + ket : ''));
};
const gelapAktif = (p) => p.evaluate(() => document.documentElement.classList.contains('dark'));
const HP = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const HP_KECIL = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 } };

async function buka(p, rute) {
  await p.goto(BASE_URL + rute, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- Pembeli baru di HP ----------
    let ctx = await browser.newContext(HP);
    let p = await ctx.newPage();
    await buka(p, '/toko');
    record('Pembeli baru: toko mulai terang', (await gelapAktif(p)) === false);
    const grup = p.locator('[data-pilih-tema-toko]');
    const tombolGelap = grup.getByRole('button', { name: /Gelap/ });
    const tinggi = Math.round((await tombolGelap.boundingBox())?.height ?? 0);
    record('HP: pilihan Tampilan ada di footer, tombolnya setinggi 44 px', (await grup.count()) === 1 && tinggi >= 44, `jumlah ${await grup.count()}, tinggi ${tinggi}`);
    const tombolHeader = await p.locator('[data-tombol-tema-toko]').isVisible();
    const lebarCari = Math.round((await p.getByRole('textbox', { name: 'Cari di toko' }).boundingBox())?.width ?? 0);
    record('HP: header tidak bertambah tombol, kolom cari tetap 119 px', tombolHeader === false && lebarCari >= 119, `tombol header terlihat ${tombolHeader}, cari ${lebarCari}`);
    await tombolGelap.click();
    await p.waitForTimeout(300);
    record('HP: pilih Gelap membuat toko gelap dan tombolnya tertekan',
      (await gelapAktif(p)) === true && (await tombolGelap.getAttribute('aria-pressed')) === 'true');
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    record('HP: pilihan gelap bertahan setelah halaman dimuat ulang', (await gelapAktif(p)) === true);
    await buka(p, '/toko/keranjang');
    record('HP: pilihan gelap ikut ke halaman toko lain (keranjang)', (await gelapAktif(p)) === true);
    await buka(p, '/aff/TIDAKADA999');
    record('HP: halaman link affiliate memakai tema toko', (await gelapAktif(p)) === true, p.url());
    await buka(p, '/toko');
    await p.locator('[data-pilih-tema-toko]').getByRole('button', { name: /Terang/ }).click();
    await p.waitForTimeout(300);
    record('HP: pilih Terang mengembalikan tampilan terang', (await gelapAktif(p)) === false);
    await ctx.close();

    ctx = await browser.newContext(HP_KECIL);
    p = await ctx.newPage();
    await buka(p, '/toko');
    const cariKecil = Math.round((await p.getByRole('textbox', { name: 'Cari di toko' }).boundingBox())?.width ?? 0);
    const lebar = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    record('HP 360: kolom cari tetap 86 px dan tidak ada gulir ke samping', cariKecil >= 86 && lebar[0] === lebar[1], `cari ${cariKecil}, lebar ${lebar.join('/')}`);
    await ctx.close();

    // ---------- Desktop ----------
    ctx = await browser.newContext(DESK);
    p = await ctx.newPage();
    await buka(p, '/toko');
    const tombol = p.locator('[data-tombol-tema-toko]');
    const kotak = await tombol.boundingBox();
    const keranjang = await p.getByRole('link', { name: 'Keranjang' }).first().boundingBox();
    record('Desktop: tombol tema terlihat di header, seukuran tombol keranjang di sebelahnya',
      (await tombol.isVisible()) && Math.round(kotak.width) === Math.round(keranjang.width) && Math.round(kotak.height) === Math.round(keranjang.height),
      `${Math.round(kotak.width)}x${Math.round(kotak.height)} vs ${Math.round(keranjang.width)}x${Math.round(keranjang.height)}`);
    await tombol.click();
    await p.waitForTimeout(300);
    const labelGelap = await tombol.getAttribute('aria-label');
    record('Desktop: tombol header mengganti ke gelap dan labelnya berbalik', (await gelapAktif(p)) === true && labelGelap === 'Ganti ke tampilan terang', labelGelap);
    record('Desktop: footer ikut menandai Gelap', (await p.locator('[data-pilih-tema-toko]').getByRole('button', { name: /Gelap/ }).getAttribute('aria-pressed')) === 'true');
    await tombol.click();
    await p.waitForTimeout(300);
    record('Desktop: klik lagi kembali terang', (await gelapAktif(p)) === false);
    await ctx.close();

    // ---------- Tema admin dan tema toko terpisah ----------
    ctx = await browser.newContext(DESK);
    p = await ctx.newPage();
    trackApi(p);
    await loginAdmin(p, { theme: 'dark' });
    record('Admin memakai mode gelap di konsol', (await gelapAktif(p)) === true);
    await buka(p, '/toko');
    record('Mode gelap admin tidak menular ke toko di browser yang sama', (await gelapAktif(p)) === false);
    await p.locator('[data-pilih-tema-toko]').getByRole('button', { name: /Gelap/ }).click();
    await p.waitForTimeout(300);
    await p.locator('[data-pilih-tema-toko]').getByRole('button', { name: /Terang/ }).click();
    await p.waitForTimeout(300);
    await buka(p, '/');
    record('Mengganti tema toko tidak mengubah tema admin (admin tetap gelap)', (await gelapAktif(p)) === true);
    await ctx.close();

    ctx = await browser.newContext(DESK);
    p = await ctx.newPage();
    trackApi(p);
    await loginAdmin(p, { theme: 'light' });
    await buka(p, '/toko');
    await p.locator('[data-pilih-tema-toko]').getByRole('button', { name: /Gelap/ }).click();
    await p.waitForTimeout(300);
    await buka(p, '/');
    record('Toko gelap tidak membuat konsol admin gelap', (await gelapAktif(p)) === false);
    await ctx.close();
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
  }
  const lolos = hasil.filter(Boolean).length;
  console.log(`\n${lolos}/${hasil.length} lolos`);
  process.exitCode = lolos === hasil.length ? 0 : 1;
})();
