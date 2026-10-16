// Sisa temuan QC gelombang 12 dan hardening (17 Okt 2026):
// R1  ganti varian ke/dari varian flash sale tidak menggeser tombol di bawah harga.
// R2  checkout HP (tanpa kaki halaman) tetap punya pilihan tampilan terang/gelap.
// R3  tombol sentuh 44px: varian di lembar HP, kategori pengeluaran, aksi User HP.
// A17 endpoint laporan CSP menerima laporan browser dan mencatatnya.
// Produk UJIQC-*, sesi flash, dan akun aff.qcs.* dibuat lalu dihapus di suite ini.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle, loginAdmin, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const INDUK = `UJIQC-${CAP}`;
const NAMA = `Uji QC Sisa ${CAP} Gear Set`;
const DESK = { viewport: { width: 1440, height: 900 } };
const HP = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const LOG_API = process.env.KASIR_API_LOG || 'C:/Users/ASUS/AppData/Local/Temp/claude/d--Kasir-Danang/ae7517e5-06e9-4a2f-bd02-bd977e3dd9d2/scratchpad/api3000.log';

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const browser = await chromium.launch();
  let sesiFlash = null;
  try {
    psql(`insert into public.products (store_id, name, base_price, parent_sku, sku, variant_name, variant_label, is_active, track_stock, stock_qty, image_url)
          values ('${toko}', '${NAMA}', 100000, '${INDUK}', '${INDUK}-A', '13T', 'Ukuran', true, true, 30, '/apple-touch-icon.png'),
                 ('${toko}', '${NAMA}', 120000, '${INDUK}', '${INDUK}-B', '14T', 'Ukuran', true, true, 30, '/apple-touch-icon.png')`);
    const slug = psql(`select min(slug) from public.products where parent_sku = '${INDUK}'`);
    const idA = psql(`select id from public.products where sku = '${INDUK}-A'`);
    sesiFlash = psql(`insert into public.flash_sales (store_id, name, starts_at, ends_at, is_active) values ('${toko}', 'Uji QC ${CAP}', now() - interval '1 hour', now() + interval '1 hour', true) returning id`).split(/\s/)[0];
    psql(`insert into public.flash_sale_items (store_id, flash_sale_id, product_id, flash_price, quota_qty) values ('${toko}', '${sesiFlash}', '${idA}', 80000, 20)`);

    // ---------- R1 desktop: posisi tombol varian tetap saat ganti varian flash ----------
    {
      const ctx = await browser.newContext(DESK);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/produk/${slug}?varian=${INDUK}-B`, { waitUntil: 'networkidle' });
      const tombol13 = p.getByRole('button', { name: '13T', exact: true }).first();
      await tombol13.waitFor({ timeout: 20000 });
      const posisi = () => p.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '14T' && x.getBoundingClientRect().height > 0);
        return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null;
      });
      const lencana = () => p.locator('span', { hasText: /^Flash Sale$/ }).filter({ visible: true }).count();
      const y0 = await posisi();
      const terlihat0 = await lencana();
      await tombol13.click();
      await p.waitForURL((u) => u.searchParams.get('varian') === `${INDUK}-A`, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(1200);
      const y1 = await posisi();
      const terlihat1 = await lencana();
      await p.getByRole('button', { name: '14T', exact: true }).first().click();
      await p.waitForTimeout(1200);
      const y2 = await posisi();
      record('R1 desktop: lencana Flash Sale hanya terlihat di varian flash', terlihat0 === 0 && terlihat1 >= 1, `bukan flash ${terlihat0}, flash ${terlihat1}`);
      record('R1 desktop: tombol varian tidak bergeser saat ganti ke dan dari varian flash', y0 !== null && y0 === y1 && y1 === y2, `${y0} -> ${y1} -> ${y2}`);
      await ctx.close();
    }

    // ---------- R1 HP + R3 tombol varian di lembar Pilihan Produk ----------
    {
      const ctx = await browser.newContext(HP);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/produk/${slug}?varian=${INDUK}-B`, { waitUntil: 'networkidle' });
      const baris = p.getByText('Pilihan Produk').first();
      await baris.waitFor({ timeout: 20000 });
      const atas = () => baris.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
      const y0 = await atas();
      await baris.click();
      const lembar = p.locator('div.fixed.inset-0.z-40');
      await lembar.waitFor({ timeout: 5000 });
      const ukuran = await lembar.getByRole('button', { name: /^1[34]T$/ }).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      record('R3 HP: tombol varian di lembar Pilihan Produk minimal 44px', ukuran.length === 2 && ukuran.every((h) => h >= 44), ukuran.join(','));
      await lembar.getByRole('button', { name: '13T', exact: true }).click();
      await p.waitForURL((u) => u.searchParams.get('varian') === `${INDUK}-A`, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(1200);
      await lembar.getByRole('button', { name: 'Tutup' }).click();
      await p.waitForTimeout(400);
      const y1 = await atas();
      record('R1 HP: baris Pilihan Produk tidak bergeser saat ganti ke varian flash', y0 === y1, `${y0} -> ${y1}`);

      // C5: ikon hati dan bagikan sejajar dengan harga, juga di varian tanpa lencana.
      await p.goto(`${BASE_URL}/toko/produk/${slug}?varian=${INDUK}-B`, { waitUntil: 'networkidle' });
      await p.locator('button[aria-label="Favorit"]:visible').first().waitFor({ timeout: 15000 });
      const selisih = await p.evaluate(() => {
        const hati = [...document.querySelectorAll('button[aria-label="Favorit"]')].find((b) => b.getBoundingClientRect().height > 0);
        const harga = [...document.querySelectorAll('div.text-2xl')].find((d) => d.getBoundingClientRect().height > 0);
        if (!hati || !harga) return null;
        const t = (r) => r.top + r.height / 2;
        return Math.round(Math.abs(t(hati.getBoundingClientRect()) - t(harga.getBoundingClientRect())));
      });
      record('C5 HP: ikon hati sejajar dengan baris harga (selisih tengah maksimal 4px)', selisih !== null && selisih <= 4, `${selisih}px`);
      await ctx.close();
    }

    // ---------- C1: lembar varian dengan puluhan varian, tombol beli tetap terlihat ----------
    {
      const INDUK2 = `${INDUK}-BANYAK`;
      const nilai = Array.from({ length: 30 }, (_, i) => `('${toko}', '${NAMA} Banyak', ${100000 + i * 1000}, '${INDUK2}', '${INDUK2}-${i}', 'Gb-415-${30 + i}F-Black', 'Ukuran', true, true, 30, '/apple-touch-icon.png')`).join(',');
      psql(`insert into public.products (store_id, name, base_price, parent_sku, sku, variant_name, variant_label, is_active, track_stock, stock_qty, image_url) values ${nilai}`);
      const slug2 = psql(`select min(slug) from public.products where parent_sku = '${INDUK2}'`);
      const ctx = await browser.newContext(HP);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/produk/${slug2}`, { waitUntil: 'networkidle' });
      await p.getByText('Pilihan Produk').first().click();
      const tombol = p.locator('[data-tombol-beli-lembar]');
      await tombol.waitFor({ timeout: 10000 });
      const ukur = await tombol.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const b = [...el.querySelectorAll('button')].map((x) => Math.round(x.getBoundingClientRect().height));
        const lembar = el.parentElement;
        return { atas: Math.round(r.top), bawah: Math.round(r.bottom), layar: window.innerHeight, tombol: b, isi: lembar.scrollHeight, tampak: lembar.clientHeight };
      });
      record('C1 HP: 30 varian, tombol Beli Sekarang dan + Keranjang terlihat di dasar lembar (44px)',
        ukur.isi > ukur.tampak && ukur.atas >= 0 && ukur.bawah <= ukur.layar && ukur.tombol.length === 2 && ukur.tombol.every((h) => h >= 44), JSON.stringify(ukur));
      await p.screenshot({ path: path.join(path.dirname(LOG_API), 'qcs_lembar_30_varian.png') });
      await ctx.close();
      psql(`delete from public.products where parent_sku = '${INDUK2}'`);
    }

    // ---------- R2: pilihan tema di checkout HP ----------
    const pembeli = await A.daftarPembeli(toko, CAP, 'qcs');
    const keranjang = JSON.stringify({ state: { lines: [{ product_id: idA, name: NAMA, price: 80000, qty: 1, image_url: '/apple-touch-icon.png' }], buyNow: null }, version: 0 });
    for (const [nama, opsi] of [['HP', HP], ['desktop', DESK]]) {
      const ctx = await browser.newContext(opsi);
      await ctx.addInitScript(([isi, t]) => { localStorage.setItem('tokoku.public_cart.v1', isi); localStorage.setItem('tokoku.customer.token.v1', t); }, [keranjang, pembeli.token]);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/checkout`, { waitUntil: 'networkidle' });
      await p.getByText('Metode Pembayaran').first().waitFor({ timeout: 20000 });
      const tema = p.locator('[data-tema-checkout]');
      if (opsi === HP) {
        await tema.scrollIntoViewIfNeeded();
        const tinggi = await tema.getByRole('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
        await tema.getByRole('button', { name: /Gelap/ }).click();
        await p.waitForTimeout(400);
        const gelap = await p.evaluate(() => document.documentElement.classList.contains('dark'));
        const ukur = await p.evaluate(() => {
          const t = document.querySelector('[data-tema-checkout]').getBoundingClientRect();
          const bilah = [...document.querySelectorAll('div.fixed.inset-x-0.bottom-0')].find((el) => el.getBoundingClientRect().height > 0);
          return { bawahTema: Math.round(t.bottom), atasBilah: bilah ? Math.round(bilah.getBoundingClientRect().top) : null, geser: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
        await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
        await p.waitForTimeout(300);
        const diBawah = await p.evaluate(() => {
          const t = document.querySelector('[data-tema-checkout]').getBoundingClientRect();
          const bilah = [...document.querySelectorAll('div.fixed.inset-x-0.bottom-0')].find((el) => el.getBoundingClientRect().height > 0);
          return { bawahTema: Math.round(t.bottom), atasBilah: bilah ? Math.round(bilah.getBoundingClientRect().top) : null };
        });
        record('R2 HP: checkout punya pilihan tema 44px dan "Gelap" mengubah tampilan',
          tinggi.length === 2 && tinggi.every((h) => h >= 44) && gelap && !ukur.geser, `tinggi ${tinggi.join(',')} gelap=${gelap}`);
        record('C10 HP: pilihan tema checkout berlabel "Tampilan" dan jalurnya bergaris tepi',
          (await tema.getByText('Tampilan', { exact: true }).count()) === 1 && /ring-1/.test((await tema.locator('[data-pilih-tema-toko]').getAttribute('class')) || ''));
        record('R2 HP: pilihan tema tidak tertutup bilah bayar saat digulir ke bawah',
          diBawah.atasBilah !== null && diBawah.bawahTema <= diBawah.atasBilah, `bawah tema ${diBawah.bawahTema}, atas bilah ${diBawah.atasBilah}`);
        await tema.getByRole('button', { name: /Terang/ }).click();
      } else {
        record('R2 desktop: pilihan tema checkout tidak tampil (desktop memakai tombol di header)', !(await tema.isVisible()));
      }
      await ctx.close();
    }

    // ---------- R3 admin: kategori pengeluaran dan aksi User di 393px ----------
    {
      const ctx = await browser.newContext(DESK);
      const p = await ctx.newPage();
      trackApi(p);
      await loginAdmin(p);
      await p.setViewportSize({ width: 393, height: 852 });
      await p.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
      const bagian = p.locator('#section-expense-categories');
      await bagian.waitFor({ timeout: 15000 });
      const kolom = await bagian.locator('#kategori-pengeluaran-baru').boundingBox();
      const tambah = await bagian.getByRole('button', { name: 'Tambah' }).boundingBox();
      record('R3 393: kolom kategori dan tombol Tambah minimal 44px', kolom && tambah && kolom.height >= 44 && tambah.height >= 44, `${kolom?.height} / ${tambah?.height}`);
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/users`, { waitUntil: 'networkidle' });
      await p.locator('tbody tr').first().waitFor({ timeout: 20000 });
      const ukurUser = await p.evaluate(() => {
        const tombol = [...document.querySelectorAll('tbody tr td:last-child button')].filter((b) => b.getBoundingClientRect().height > 0);
        const tabel = document.querySelector('table');
        const wadah = tabel?.parentElement;
        return {
          jumlah: tombol.length,
          kecil: tombol.filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).length,
          tabel: tabel ? Math.round(tabel.getBoundingClientRect().width) : null,
          wadah: wadah ? Math.round(wadah.clientWidth) : null,
          peranTerlihat: [...document.querySelectorAll('tbody tr')].filter((tr) => /Admin|Kasir|Gudang|Pelanggan/i.test(tr.querySelector('td')?.innerText || '')).length,
        };
      });
      record('R3 393: semua tombol aksi User 44px dan tabel muat di wadahnya',
        ukurUser.jumlah > 0 && ukurUser.kecil === 0 && ukurUser.tabel <= ukurUser.wadah, JSON.stringify(ukurUser));
      record('R3 393: peran user tetap terlihat (pindah ke bawah nama)', ukurUser.peranTerlihat > 0, `${ukurUser.peranTerlihat} baris`);
      await ctx.close();
    }

    // ---------- A17: endpoint laporan CSP ----------
    const tanda = `https://uji-csp-${CAP}.contoh/x.js`;
    const r = await fetch(`${BASE_URL}/api/csp-laporan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'document-uri': `${BASE_URL}/toko?rahasia=1`, 'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem', 'blocked-uri': tanda } }),
    });
    await new Promise((s) => setTimeout(s, 500));
    const log = fs.existsSync(LOG_API) ? fs.readFileSync(LOG_API, 'utf8') : '';
    const baris = log.split(/\r?\n/).find((l) => l.includes(tanda)) || '';
    record('A17: laporan CSP diterima (204) dan dicatat tanpa query string halaman', r.status === 204 && baris.includes('[csp] script-src-elem diblokir') && !baris.includes('rahasia=1'), `${r.status} | ${baris.slice(0, 140)}`);

    // C3/C4: isi laporan tidak bisa memalsukan baris log, badan rusak dijawab rapi.
    const palsu = `PALSU-${CAP}`;
    const kirim = (body, type = 'application/csp-report') => fetch(`${BASE_URL}/api/csp-laporan`, { method: 'POST', headers: { 'Content-Type': type, 'X-Forwarded-For': `198.18.77.${CAP % 200}` }, body });
    const rBaris = await kirim(JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': `https://a.contoh\n[auth] admin masuk ${palsu}`, 'document-uri': BASE_URL } }));
    const rObjek = await kirim(JSON.stringify({ 'csp-report': { 'effective-directive': { x: 1 }, 'blocked-uri': ['a'], 'document-uri': 5 } }));
    const rBesar = await kirim(JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(20000) } }));
    const rRusak = await kirim('{bukan json');
    await new Promise((s) => setTimeout(s, 500));
    const log2 = fs.existsSync(LOG_API) ? fs.readFileSync(LOG_API, 'utf8') : '';
    const barisPalsu = log2.split(/\r?\n/).filter((l) => l.includes(palsu));
    const masihHidup = (await fetch(`${BASE_URL}/api/public/flash-sale?store_id=${toko}`)).status;
    record('C3: baris baru di laporan tidak membuat baris log palsu', rBaris.status === 204 && barisPalsu.length === 1 && barisPalsu[0].includes('[csp]'), barisPalsu.map((l) => l.slice(0, 120)).join(' || '));
    record('C4: field objek 204, badan >16KB 413, JSON rusak 400, server tetap menjawab',
      rObjek.status === 204 && rBesar.status === 413 && rRusak.status === 400 && masihHidup === 200 && !/PayloadTooLargeError/.test(log2.slice(-4000)),
      `${rObjek.status}/${rBesar.status}/${rRusak.status} lalu ${masihHidup}`);
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    try { await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`); } catch (e) { console.log('bersih: ' + e.message); }
    if (sesiFlash) psql(`delete from public.flash_sale_items where flash_sale_id = '${sesiFlash}'; delete from public.flash_sales where id = '${sesiFlash}'`);
    try { psql(`delete from public.products where parent_sku = '${INDUK}'`); } catch { psql(`update public.products set is_active = false where parent_sku = '${INDUK}'`); }
  }
  ringkas();
})();
