// Permintaan 20 (15 Okt 2026): alamat produk dari nama, /toko/produk/{slug},
// bukan /toko/produk?id={uuid}. Keputusan user: satu alamat per kelompok varian,
// ?varian= untuk varian tertentu, alamat tidak berubah sendiri saat nama diganti,
// admin bisa mengubahnya manual, link lama ?id= tetap jalan dan dialihkan.
// Produk uji UJIALAMAT-* dibuat dan dihapus di suite ini.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loginAdmin, trackApi, waitForApiIdle, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const INDUK = `UJIALAMAT-${CAP}`;
const NAMA = `Uji Alamat ${CAP} Gear Set / RX King`;
const SLUG = `uji-alamat-${CAP}-gear-set-rx-king`;
const DESK = { viewport: { width: 1440, height: 900 } };
const HP = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

(async () => {
  const toko = A.idToko();
  const browser = await chromium.launch();
  try {
    A.psql(`insert into public.products (store_id, name, base_price, parent_sku, sku, variant_name, variant_label, is_active, track_stock, stock_qty)
            values ('${toko}', '${NAMA}', 10000, '${INDUK}', '${INDUK}-A', '13T', 'Ukuran', true, false, 0),
                   ('${toko}', '${NAMA}', 12000, '${INDUK}', '${INDUK}-B/1+R', '14T', 'Ukuran', true, false, 0)`);
    const slugDb = A.psql(`select string_agg(distinct slug, ',') from public.products where parent_sku = '${INDUK}'`);
    record('Produk baru mendapat alamat dari nama, sama untuk semua varian', slugDb === SLUG, slugDb);
    const idB = A.psql(`select id from public.products where sku = '${INDUK}-B/1+R'`);

    // ---------- Katalog ----------
    let ctx = await browser.newContext(DESK);
    let p = await ctx.newPage();
    await p.goto(`${BASE_URL}/toko?semua=1`, { waitUntil: 'networkidle' });
    await p.locator('[data-kartu-produk]').first().waitFor({ timeout: 20000 });
    const href = await p.locator('[data-kartu-produk]').evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
    record('Katalog: semua kartu produk memakai /toko/produk/{nama}, tidak ada ?id=',
      href.length > 0 && href.every((h) => h.startsWith('/toko/produk/') && !h.includes('?id=')), `${href.length} kartu, contoh ${href[0]}`);

    // ---------- Halaman produk lewat slug ----------
    await p.goto(`${BASE_URL}/toko/produk/${SLUG}`, { waitUntil: 'networkidle' });
    await p.locator('h1').first().waitFor({ timeout: 15000 });
    const judul = await p.locator('h1').first().innerText();
    record('Alamat slug membuka produknya, varian termurah dulu', judul.includes(`Uji Alamat ${CAP}`) && (await p.getByText(`${INDUK}-A`).count()) + (await p.getByText('13T').count()) > 0, judul);
    await p.getByRole('button', { name: '14T', exact: true }).first().click();
    await p.waitForTimeout(1200);
    const u = new URL(p.url());
    record('Pilih varian: alamat tetap slug, ?varian= berisi SKU varian itu',
      u.pathname === `/toko/produk/${SLUG}` && u.searchParams.get('varian') === `${INDUK}-B/1+R`, p.url());
    // Tombol varian aktif berbingkai warna tema (border-brand-500).
    const varianAktif = () => p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /border-brand-500/.test(b.className) && /^(13T|14T)$/.test(b.textContent.trim())).map((b) => b.textContent.trim()));
    let permintaanSlug = 0;
    const hitung = (r) => { if (r.url().includes('/api/public/product?')) permintaanSlug += 1; };
    p.on('request', hitung);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    p.off('request', hitung);
    const aktifSesudah = await varianAktif();
    record('Muat ulang alamat varian tetap memilih varian itu', aktifSesudah.includes('14T') && !aktifSesudah.includes('13T'), aktifSesudah.join(','));

    // ---------- Alamat lama ----------
    await p.goto(`${BASE_URL}/toko/produk?id=${idB}&utm_source=fb`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const lama = new URL(p.url());
    record('Link lama ?id= dialihkan ke alamat slug dengan varian yang sama, parameter iklan ikut',
      lama.pathname === `/toko/produk/${SLUG}` && lama.searchParams.get('varian') === `${INDUK}-B/1+R` && lama.searchParams.get('utm_source') === 'fb' && !lama.searchParams.has('id'), p.url());
    const permintaan = [];
    p.on('request', (r) => { if (r.url().includes('/api/public/product?')) permintaan.push(r.url()); });
    await p.goto(`${BASE_URL}/toko/produk?id=${idB}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    // Mode pengembangan (StrictMode) menjalankan efek dua kali, jadi pembandingnya
    // jumlah permintaan saat alamat slug dibuka langsung.
    record('Pengalihan dari ?id= tidak menambah permintaan produk', permintaan.length === permintaanSlug, `${permintaan.length} vs langsung ${permintaanSlug}`);

    await p.goto(`${BASE_URL}/toko/produk/tidak-ada-produk-${CAP}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    record('Alamat tak dikenal menampilkan "Produk tidak ditemukan"', (await p.getByText('Produk tidak ditemukan atau sudah tidak dijual.').count()) === 1);
    await ctx.close();

    ctx = await browser.newContext(HP);
    p = await ctx.newPage();
    await p.goto(`${BASE_URL}/toko/produk/${SLUG}?varian=${encodeURIComponent(`${INDUK}-B/1+R`)}`, { waitUntil: 'networkidle' });
    await p.locator('h1').locator('visible=true').first().waitFor({ timeout: 15000 });
    const lebar = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    record('HP: alamat slug dengan varian terbuka tanpa gulir ke samping', lebar[0] === lebar[1] && (await p.locator('body').innerText()).includes('12.000'), lebar.join('/'));
    await ctx.close();

    // ---------- Ganti nama, ubah manual lewat formulir admin ----------
    A.psql(`update public.products set name = '${NAMA} Baru' where parent_sku = '${INDUK}'`);
    record('Ganti nama produk tidak mengubah alamatnya', A.psql(`select string_agg(distinct slug, ',') from public.products where parent_sku = '${INDUK}'`) === SLUG);

    ctx = await browser.newContext(DESK);
    p = await ctx.newPage();
    trackApi(p);
    await loginAdmin(p);
    const bukaForm = async () => {
      await p.goto(BASE_URL + '/products', { waitUntil: 'networkidle' });
      await waitForApiIdle(p, { idleMs: 2500, minWaitMs: 1500 });
      await p.getByPlaceholder('Cari nama / SKU / barcode').fill(`${INDUK}-A`);
      await p.waitForTimeout(900);
      await p.locator('tr', { hasText: `${INDUK}-A` }).first().locator('button[title="Edit"]').click();
      await p.locator('input[name="slug"]').waitFor({ timeout: 10000 });
    };
    await bukaForm();
    record('Formulir produk menampilkan alamat saat ini', (await p.locator('input[name="slug"]').inputValue()) === SLUG, await p.locator('input[name="slug"]').inputValue());
    const lain = A.psql(`select slug from public.products where store_id = '${toko}' and slug is not null and coalesce(parent_sku, '') <> '${INDUK}' limit 1`);
    await p.locator('input[name="slug"]').fill(lain);
    await p.getByRole('button', { name: 'Simpan', exact: true }).last().click();
    await p.waitForTimeout(1500);
    record('Alamat milik produk lain ditolak formulir dan tidak tersimpan',
      (await p.getByText(`Alamat produk "${lain}" sudah dipakai produk`).count()) > 0 && A.psql(`select string_agg(distinct slug, ',') from public.products where parent_sku = '${INDUK}'`) === SLUG, lain);
    await p.locator('input[name="slug"]').fill(`Alamat Pilihan Admin ${CAP}`);
    await p.getByRole('button', { name: 'Simpan', exact: true }).last().click();
    await p.waitForTimeout(2000);
    const slugBaru = `alamat-pilihan-admin-${CAP}`;
    record('Ubah manual: alamat dirapikan dan berlaku untuk semua varian',
      A.psql(`select string_agg(distinct slug, ',') from public.products where parent_sku = '${INDUK}'`) === slugBaru,
      A.psql(`select string_agg(distinct slug, ',') from public.products where parent_sku = '${INDUK}'`));
    await ctx.close();

    ctx = await browser.newContext(DESK);
    p = await ctx.newPage();
    await p.goto(`${BASE_URL}/toko/produk/${slugBaru}`, { waitUntil: 'networkidle' });
    await p.locator('h1').first().waitFor({ timeout: 15000 });
    record('Alamat baru membuka produknya', (await p.locator('h1').first().innerText()).includes(`Uji Alamat ${CAP}`));
    await ctx.close();

    // ---------- Penyelamat cangkang lama ----------
    const konfig = fs.readFileSync(path.join(__dirname, '..', 'public', 'kasir-config.js'), 'utf8');
    const indeks = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    record('Cangkang lama dikenali untuk /toko/produk/ (data-cangkang 3)',
      /data-cangkang="3"/.test(indeks) && konfig.includes("jalur.indexOf('/toko/produk/') === 0"));
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    A.psql(`delete from public.products where parent_sku = '${INDUK}'`);
  }
  ringkas();
})();
