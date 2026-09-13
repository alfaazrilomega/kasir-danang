// Verifikasi permintaan dari chat client (setelah revisi 9.9) lewat layar:
//   - impor produk sebagian dari sheet client, termasuk isi set (Gear Set)
//   - stok set di toko online dihitung dari stok isinya
//   - urutan produk: nama lalu SKU (angka dibaca sebagai angka)
//   - tombol riwayat keluar-masuk per SKU dari halaman Produk
//   - cetak label barcode
//   - total qty berupa angka di nota pembelian
//   - halaman detail produk toko online (desktop dan HP)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { BASE_URL: BASE, DB_PASSWORD, trackApi, waitForApiIdle, loginAdmin } = require('./lib/harness.cjs');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
const CSV = path.join(__dirname, '..', 'docs', 'impor-produk-gnnk-fizr.csv');
const sql = (q) =>
  execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: DB_PASSWORD },
    encoding: 'utf8',
  }).trim();
const first = (q) => sql(q).split('\n')[0].trim();

// SKU dari berkas client, untuk dicek dan dibersihkan.
const skus = fs
  .readFileSync(CSV, 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .slice(2)
  .map((l) => l.split(';')[0])
  .filter(Boolean);
const daftarSku = skus.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');

function bersihkan(S) {
  sql(`delete from public.product_components where parent_product_id in
        (select id from public.products where store_id='${S}' and sku in (${daftarSku}));`);
  sql(`delete from public.stock_movements where product_id in
        (select id from public.products where store_id='${S}' and sku in (${daftarSku}));`);
  sql(`delete from public.products where store_id='${S}' and sku in (${daftarSku});`);
  sql(`delete from public.categories c where c.store_id='${S}'
        and c.name in ('GEAR-DEPAN-FIZR-BLACK','GEAR-BLKNG-FIZR-BLACK','RANTAI TYPE 415')
        and not exists (select 1 from public.products p where p.category_id = c.id);`);
}

(async () => {
  const results = [];
  const record = (n, p, d) => {
    results.push({ n, p });
    console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d !== undefined ? ' — ' + d : ''));
  };
  const S = first('select id from public.stores order by created_at limit 1;');
  bersihkan(S);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  trackApi(page);
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const dialog = () => page.locator('div.fixed.inset-0').last();

  try {
    await loginAdmin(page);
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {});
    // Perangkat baru: tunggu isi awal lokal selesai supaya katalog dari server yang dipakai.
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await page.waitForTimeout(20000);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });

    // ---------- Impor sebagian dari sheet client ----------
    const produkAwal = Number(first(`select count(*) from public.products where store_id='${S}';`));
    await page.getByRole('button', { name: /Impor Produk/i }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Impor dari berkas/i }).click();
    await page.waitForTimeout(400);
    await dialog().locator('input[type="file"]').setInputFiles(CSV);
    // Rencana dihitung dengan membandingkan ke katalog yang ada; tunggu sampai selesai.
    const mulaiRencana = Date.now();
    await page.waitForTimeout(500);
    await dialog().getByText(/Memeriksa berkas/i).waitFor({ state: 'detached', timeout: 90000 }).catch(() => {});
    console.log(`  (rencana impor selesai dalam ${((Date.now() - mulaiRencana) / 1000).toFixed(1)} detik)`);
    const rencana = (await dialog().innerText()).replace(/\s+/g, ' ');
    record('Rencana impor mengenali produk set', /Produk set\s*81/i.test(rencana), rencana.slice(0, 160));
    await page.screenshot({ path: path.join(SHOT_DIR, 'chat_impor_rencana.png') });
    await dialog().getByRole('button', { name: /Jalankan Impor/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 4000, timeoutMs: 180000 });
    const masuk = Number(first(`select count(*) from public.products where store_id='${S}' and sku in (${daftarSku});`));
    record('Semua produk dari sheet masuk', masuk === skus.length, `${masuk} dari ${skus.length}`);
    record('Produk lama tidak ikut terhapus (impor sebagian)',
      Number(first(`select count(*) from public.products where store_id='${S}';`)) === produkAwal + skus.length);
    const set = first(`select count(distinct pc.parent_product_id) || '|' || count(*) from public.product_components pc
                        join public.products p on p.id = pc.parent_product_id
                        where p.store_id='${S}' and p.sku like 'G-415/%';`);
    record('81 Gear Set tersusun dari 3 isi (243 baris isi)', set === '81|243', set);
    const kategori = first(`select count(*) from public.categories where store_id='${S}'
                            and name in ('GEAR-DEPAN-FIZR-BLACK','GEAR-BLKNG-FIZR-BLACK','RANTAI TYPE 415');`);
    record('Kategori dari sheet dibuat', kategori === '3', kategori);
    record('Berat dari sheet ikut masuk',
      first(`select weight_gram from public.products where store_id='${S}' and sku='Gd-415-12-FIZ';`) === '100');

    // ---------- Stok set mengikuti isinya di toko online ----------
    sql(`update public.products set stock_qty = 5 where store_id='${S}' and sku = 'Gd-415-12-FIZ';`);
    sql(`update public.products set stock_qty = 3 where store_id='${S}' and sku = 'Gb-415-30F-Black';`);
    sql(`update public.products set stock_qty = 10 where store_id='${S}' and sku = 'G-415-130l';`);
    const idSet = first(`select id from public.products where store_id='${S}' and sku='G-415/12-30Black+R';`);
    const idDepan = first(`select id from public.products where store_id='${S}' and sku='Gd-415-12-FIZ';`);
    const katalog = await page.evaluate(async (sid) => {
      const r = await fetch(`/api/public/catalog?store_id=${sid}`);
      return (await r.json()).data.products;
    }, S);
    const setDiKatalog = katalog.find((p) => p.id === idSet);
    record('Stok Gear Set di toko online = isi paling sedikit (3)',
      !!setDiKatalog && setDiKatalog.track_stock === true && Number(setDiKatalog.stock_qty) === 3,
      JSON.stringify(setDiKatalog && { stok: setDiKatalog.stock_qty, lacak: setDiKatalog.track_stock }));
    record('Katalog publik tidak membocorkan SKU/harga modal',
      !!setDiKatalog && !('sku' in setDiKatalog) && !('cost_price' in setDiKatalog));

    // ---------- Urutan nama lalu SKU di kasir ----------
    await page.goto(BASE + '/menu', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByPlaceholder(/Cari menu/i).fill('Gear Belakang');
    await page.waitForTimeout(1200);
    const urutan = ((await page.locator('body').innerText()).match(/Gb-415-\d+F-Black/g) || []).map((s) =>
      Number(/Gb-415-(\d+)F/.exec(s)[1]));
    const naik = urutan.length >= 3 && urutan.every((n, i) => i === 0 || n >= urutan[i - 1]);
    record('Kasir: produk bernama sama urut SKU (30, 33, 34, ...)', naik, urutan.slice(0, 8).join(', '));

    // ---------- Riwayat keluar-masuk per SKU ----------
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    const baris = page.locator('tbody tr').filter({ hasText: 'Gd-415-12-FIZ' }).first();
    await baris.locator('button[title="Riwayat keluar-masuk"]').click();
    await page.waitForURL((u) => u.pathname.includes('/stock-mutation'), { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const nilaiCari = await page.getByPlaceholder(/Cari produk/i).inputValue().catch(() => '');
    const dari = await page.locator('input[type="date"]').first().inputValue().catch(() => '');
    record('Tombol riwayat membuka Mutasi Stok untuk SKU itu, seluruh periode',
      nilaiCari === 'Gd-415-12-FIZ' && dari === '2020-01-01', `${nilaiCari} sejak ${dari}`);

    // ---------- Label barcode ----------
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.locator('tbody tr').filter({ hasText: 'Gd-415-12-FIZ' }).first()
      .locator('button[title="Cetak label barcode"]').click();
    await page.waitForTimeout(800);
    const tercentang = await dialog().locator('input[type="checkbox"]:checked').count();
    const adaPratinjau = await dialog().locator('svg rect').count();
    record('Modal label terbuka dengan produk terpilih dan pratinjau barcode',
      tercentang >= 1 && adaPratinjau > 10, `${tercentang} dipilih, ${adaPratinjau} batang`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'chat_label_modal.png') });
    await page.evaluate(() => {
      window.__label = [];
      const asli = HTMLIFrameElement.prototype.remove;
      HTMLIFrameElement.prototype.remove = function () {
        window.__label.push(this.contentDocument?.documentElement?.outerHTML || '');
        return asli.call(this);
      };
    });
    await dialog().getByRole('button', { name: /^Cetak Label$/ }).click();
    await page.waitForTimeout(1500);
    const htmlLabel = await page.evaluate(() =>
      [...window.__label, ...[...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.documentElement?.outerHTML || '')].join('\n'));
    record('Label tercetak berisi barcode CODE128 dan kode SKU',
      htmlLabel.includes('<svg') && htmlLabel.includes('Gd-415-12-FIZ') && htmlLabel.includes('50mm'));
    fs.writeFileSync(path.join(SHOT_DIR, 'chat_label.html'), htmlLabel.split('\n</html>')[0] + '</html>');
    await page.keyboard.press('Escape');

    // ---------- Total qty di nota ----------
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(800);
    const cari = dialog().getByPlaceholder('Cari nama atau SKU...');
    await cari.first().click();
    await cari.first().fill('Gd-415-12');
    await page.waitForTimeout(400);
    await dialog().locator('button').filter({ hasText: 'Gd-415-12-FIZ' }).first().click();
    await page.waitForTimeout(600);
    const teksNota = await dialog().innerText();
    record('Nota menampilkan Total qty dalam pcs, terpisah dari Rp',
      /Total qty\s*1 pcs/.test(teksNota) && /Subtotal harga/.test(teksNota));
    await page.screenshot({ path: path.join(SHOT_DIR, 'chat_nota_qty.png') });
    await page.keyboard.press('Escape');

    // ---------- Halaman detail toko online ----------
    const tamu = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const t = await tamu.newPage();
    await t.goto(`${BASE}/toko/produk?id=${idDepan}`, { waitUntil: 'networkidle' });
    await t.waitForTimeout(1500);
    const teksDetail = await t.locator('body').innerText();
    record('Detail produk: spesifikasi, berat, terjual, deskripsi',
      /Spesifikasi/.test(teksDetail) && /100 gram/.test(teksDetail) && /Terjual/.test(teksDetail) &&
        /Detail Produk/.test(teksDetail));
    await t.screenshot({ path: path.join(SHOT_DIR, 'chat_detail_desktop.png'), fullPage: true });
    await t.goto(`${BASE}/toko/produk?id=${idSet}`, { waitUntil: 'networkidle' });
    await t.waitForTimeout(1200);
    record('Detail Gear Set menampilkan stok dari isinya', /Tersisa 3 buah/.test(await t.locator('body').innerText()));
    await t.setViewportSize({ width: 400, height: 860 });
    await t.reload({ waitUntil: 'networkidle' });
    await t.waitForTimeout(1200);
    const lebar = await t.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    const barBeli = await t.getByRole('button', { name: /^Beli Sekarang$/ }).isVisible();
    record('Detail di HP: tidak melebar dan bar Beli Sekarang menempel di bawah',
      lebar[0] <= lebar[1] + 1 && barBeli, `${lebar.join(' vs ')}, bar=${barBeli}`);
    await t.screenshot({ path: path.join(SHOT_DIR, 'chat_detail_hp.png') });
    await tamu.close();
  } catch (e) {
    record('Skrip berjalan tanpa error', false, e.message.split('\n').slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOT_DIR, 'chat_gagal.png') }).catch(() => {});
  } finally {
    bersihkan(S);
    await browser.close();
    const gagal = results.filter((r) => !r.p).length;
    console.log(`\n${results.length - gagal}/${results.length} lulus`);
    process.exit(gagal ? 1 : 0);
  }
})();
