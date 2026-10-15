// Laporan klien 15 Okt 2026: admin mengizinkan member saat program affiliate
// masih mati. Daftar admin hanya menulis "Tidak berhak" dan member tidak melihat
// menu Affiliate, sehingga terlihat seperti galat. Suite ini mengunci:
//   1. selama program mati, layar admin menyebut alasannya (spanduk, lencana
//      "Program mati", catatan di dialog Ubah), dan pembeli melihat
//      "Program affiliate belum dibuka" tanpa menu Affiliate;
//   2. menyalakan program lewat layar Pengaturan (dari pengaturan kosong {},
//      seperti produksi) tersimpan, lalu member yang sama Berhak, menu Affiliate
//      muncul, dan dashboard affiliate terbuka.
// Akun uji berakhiran @contoh.id; pengaturan toko dikembalikan di akhir.

const path = require('path');
const { chromium } = require('playwright');
const { loginAdmin, trackApi, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');

const CAP = Date.now().toString().slice(-6);
const KUNCI_TOKEN = 'tokoku.customer.token.v1';
const { record, ringkas } = A.pencatat();

async function lihatPembeli(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [KUNCI_TOKEN, token]);
  const p = await ctx.newPage();
  await p.goto(`${BASE_URL}/toko/akun`, { waitUntil: 'networkidle' });
  await p.getByText('Pesanan Saya').first().waitFor({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const menu = (await p.getByRole('button', { name: /^Affiliate$/ }).count()) + (await p.getByRole('link', { name: /^Affiliate$/ }).count());
  await p.goto(`${BASE_URL}/toko/affiliate`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const teks = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  await ctx.close();
  return { menu, belumDibuka: teks.includes('Program affiliate belum dibuka'), dashboard: /Link affiliate|Ringkasan/.test(teks) && !teks.includes('belum dibuka') };
}

async function barisAdmin(p, email) {
  await p.goto(`${BASE_URL}/affiliate?tab=affiliate`, { waitUntil: 'networkidle' });
  await p.getByPlaceholder(/Cari nama, email/).fill(email);
  const baris = p.locator('tbody tr').filter({ hasText: email }).first();
  await baris.waitFor({ timeout: 15000 }).catch(() => {});
  return baris;
}

(async () => {
  const toko = A.idToko();
  const asli = A.psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const admin = await A.tokenAdmin();
  const browser = await chromium.launch();
  try {
    A.psql(`update public.stores set affiliate_settings = '{}'::jsonb where id = '${toko}'`);
    const m = await A.daftarPembeli(toko, CAP, 'mati');
    const iz = await A.izinkan(admin, m.id);
    record('Admin bisa mengizinkan member walau program mati', iz.status === 200, `${iz.status} ${iz.error || ''}`);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    trackApi(p);
    await loginAdmin(p);

    // ---------- Program mati ----------
    let baris = await barisAdmin(p, m.email);
    const spanduk = p.locator('[data-program-mati]');
    record('Program mati: spanduk di atas daftar member menyebut alasannya',
      (await spanduk.count()) === 1 && /Program affiliate masih mati/.test(await spanduk.innerText()),
      await spanduk.innerText().catch(() => 'tidak ada'));
    const teksBaris = (await baris.innerText()).replace(/\s+/g, ' ');
    record('Program mati: member Diizinkan berlencana "Program mati", bukan "Tidak berhak"',
      teksBaris.includes('Program mati') && !teksBaris.includes('Tidak berhak') && teksBaris.includes('Diizinkan'), teksBaris);
    await baris.getByRole('button', { name: /Ubah/ }).click();
    const catatan = p.locator('[data-catatan-program-mati]');
    await catatan.waitFor({ timeout: 5000 }).catch(() => {});
    record('Program mati: dialog Ubah memberi catatan saat akses Diizinkan', (await catatan.count()) === 1, await catatan.innerText().catch(() => 'tidak ada'));
    await p.keyboard.press('Escape');
    const tombol = spanduk.getByRole('button', { name: /Nyalakan di Pengaturan/ });
    const tinggi = Math.round((await tombol.boundingBox())?.height ?? 0);
    const tinggiUndang = Math.round((await p.getByRole('button', { name: /Undang affiliate/ }).boundingBox())?.height ?? -1);
    await tombol.click();
    await p.waitForTimeout(800);
    record('Tombol di spanduk membuka tab Pengaturan dan setinggi tombol Undang affiliate',
      new URL(p.url()).searchParams.get('tab') === 'pengaturan' && tinggi === tinggiUndang, `${p.url()} tinggi ${tinggi} vs ${tinggiUndang}`);

    const sebelum = await lihatPembeli(browser, m.token);
    record('Program mati: pembeli tidak melihat menu Affiliate dan halaman affiliate menyebut belum dibuka',
      sebelum.menu === 0 && sebelum.belumDibuka, JSON.stringify(sebelum));

    // ---------- Admin menyalakan program lewat layar ----------
    await p.locator('label', { hasText: 'Aktifkan program affiliate' }).click();
    const [put] = await Promise.all([
      p.waitForResponse((r) => r.url().includes('/api/admin/affiliate/settings') && r.request().method() === 'PUT', { timeout: 15000 }).catch(() => null),
      p.getByRole('button', { name: 'Simpan pengaturan' }).click(),
    ]);
    record('Menyalakan program dari pengaturan kosong {} tersimpan',
      put?.status() === 200 && A.psql(`select affiliate_settings->>'enabled' from public.stores where id = '${toko}'`) === 'true',
      `PUT ${put ? put.status() : 'tidak terkirim'}`);

    baris = await barisAdmin(p, m.email);
    const teksSesudah = (await baris.innerText()).replace(/\s+/g, ' ');
    record('Program menyala: member yang sama Berhak dan spanduk hilang',
      teksSesudah.includes('Berhak') && !teksSesudah.includes('Program mati') && (await p.locator('[data-program-mati]').count()) === 0, teksSesudah);
    const sesudah = await lihatPembeli(browser, m.token);
    record('Program menyala: pembeli melihat menu Affiliate dan dashboard affiliate terbuka',
      sesudah.menu === 1 && sesudah.dashboard, JSON.stringify(sesudah));
    await ctx.close();
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    await A.bersihkanUji(admin, `aff.mati.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    A.psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
  }
  ringkas();
})();
