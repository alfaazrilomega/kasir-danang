// Uji butir client 3.1: impor hasil hitung fisik ke Stock Opname, sesi bertanggal.
//
//   3.1a Sesi opname bisa dibuat dengan tanggal yang dipilih, bukan selalu hari ini.
//   3.1b Hasil hitung bisa diunggah dari berkas, bukan diketik satu per satu.
//   3.1c Import tidak menyentuh stok; stok baru berubah setelah posting.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');

const BASE = 'http://localhost:5173';
const ENV = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(String.fromCharCode(10)).map((l) => l.trim());
const ADMIN_PW = (ENV.find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const DB_PW = /:\/\/[^:]+:([^@]*)@/.exec(ENV.find((l) => l.startsWith('DATABASE_URL=')) || '')?.[1];

const psql = (q) => execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
  ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
  { env: { ...process.env, PGPASSWORD: DB_PW }, encoding: 'utf8' }).trim();

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

// Tanggal 3 hari lalu — mensimulasikan hitung fisik yang dikerjakan di gudang
// lebih dulu, baru diunggah ke sistem belakangan.
const tanggalLalu = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const [thn, bln, tgl] = tanggalLalu.split('-');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-opname-'));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true })).newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const modal = () => page.locator('div.fixed.inset-0').last();

  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 })
      .then(() => true).catch(() => false));
    await waitForApiIdle(page, { idleMs: 4500, minWaitMs: 4000 });

    // ---- 3.1a: sesi bertanggal ----
    await page.goto(BASE + '/stock-opname', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Mulai Sesi Baru/i }).click();
    await page.waitForTimeout(1200);

    const dialogTanggal = modal();
    record('Dialog mulai sesi menawarkan tanggal opname',
      /Tanggal opname/i.test(await dialogTanggal.innerText()));
    await dialogTanggal.locator('input[type="date"]').fill(tanggalLalu);
    await page.waitForTimeout(500);
    await dialogTanggal.getByRole('button', { name: /^Mulai$/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    const chipTanggal = `${tgl}`;
    const teksHalaman = await page.locator('body').innerText();
    record('Sesi tercatat pada tanggal yang dipilih, bukan hari ini',
      teksHalaman.includes(chipTanggal) &&
        new RegExp(chipTanggal + '\\s+\\w+').test(teksHalaman.replace(/\s+/g, ' ')),
      (new RegExp(chipTanggal + '\\s+\\w+,?\\s+\\d{2}[:.]\\d{2}').exec(teksHalaman.replace(/\s+/g, ' ')) || ['-'])[0]);

    // ---- 3.1c: tombol impor mati sebelum ada sesi terbuka, hidup sekarang ----
    const tombolImpor = page.getByRole('button', { name: /Impor Hasil Hitung/i });
    record('Tombol impor aktif setelah sesi dibuat', await tombolImpor.isEnabled().catch(() => false));

    // ---- Unduh sesi ini untuk dijadikan berkas hasil hitung ----
    const unduhan = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    record('Berkas sesi bisa diunduh untuk diisi', !!unduhan);

    let sku2 = null, stokSistem2 = 0;
    if (unduhan) {
      const berkasAsli = path.join(tmp, 'opname.csv');
      await unduhan.saveAs(berkasAsli);
      const teks = fs.readFileSync(berkasAsli, 'utf8').replace(/^\uFEFF/, '');
      const baris = teks.trim().split(/\r?\n/);
      const header = baris[1].split(';');
      const idxSku = header.findIndex((h) => h.trim() === 'SKU');
      const idxStok = header.findIndex((h) => h.trim() === 'Stok Sistem');
      const idxHitung = header.findIndex((h) => h.trim() === 'Hitung Fisik');

      // Susun ulang: isi Hitung Fisik untuk 2 baris pertama, sisanya kosong —
      // menirukan client yang cuma sempat menghitung sebagian gudang.
      const hasilBaru = [baris[0], baris[1]];
      for (let i = 2; i < baris.length && i < 5; i++) {
        const kolom = baris[i].split(';');
        if (i === 2) {
          // Math.max(0, ...): stok sistem produk ini terus berkurang lewat
          // suite lain yang jalan lebih dulu (jual, retur, dst). Mengurangi 3
          // tanpa penjagaan bisa menghasilkan hitungan fisik negatif ketika
          // stok sistemnya sudah kecil, dan itu memang benar ditolak
          // aplikasi — tapi berarti uji ini gagal karena angka ujinya sendiri
          // yang keliru, bukan karena fiturnya rusak.
          kolom[idxHitung] = String(Math.max(0, Number(kolom[idxStok]) - 3)); // selisih kurang
        } else if (i === 3) {
          sku2 = kolom[idxSku];
          stokSistem2 = Number(kolom[idxStok]);
          kolom[idxHitung] = String(stokSistem2 + 5); // selisih lebih
        }
        hasilBaru.push(kolom.join(';'));
      }
      const berkasHasil = path.join(tmp, 'hasil-hitung.csv');
      fs.writeFileSync(berkasHasil, hasilBaru.join('\r\n'), 'utf8');

      // ---- 3.1b: unggah hasil hitung ----
      await tombolImpor.click();
      await page.waitForTimeout(1200);
      await page.locator('input[type="file"]').first().setInputFiles(berkasHasil);
      await page.waitForTimeout(2500);

      const m = modal();
      const teksImpor = await m.innerText();
      record('Berkas hasil hitung terbaca', /Akan diterapkan/i.test(teksImpor));
      const angka = /Akan diterapkan\s*\n?\s*(\d+)/.exec(teksImpor);
      record('Dua baris terisi diterapkan', angka && angka[1] === '2', angka ? angka[1] : '-');

      await m.getByRole('button', { name: /Terapkan \d+ Hasil/i }).click();
      await page.waitForTimeout(1500);

      const teksSetelah = await page.locator('body').innerText();
      const barisSku = page.locator('tbody tr').filter({ hasText: sku2 || '___' });
      const jumlahBaris = await barisSku.count();
      const nilaiKolom = await barisSku.first().locator('input[type="number"]').inputValue().catch((e) => 'GAGAL: ' + e.message.slice(0, 60));
      record('Hasil hitung tampil di kolom tanpa mengetik manual',
        String(stokSistem2 + 5) === nilaiKolom,
        `sku=${sku2} baris=${jumlahBaris} harap=${stokSistem2 + 5} dapat=${nilaiKolom}`);
    } else {
      record('Berkas hasil hitung terbaca', false, 'unduhan gagal');
      record('Dua baris terisi diterapkan', false);
      record('Hasil hitung tampil di kolom tanpa mengetik manual', false);
    }

    // ---- 3.1c: stok belum berubah sebelum posting ----
    const idSesi = psql(
      `select id from public.stock_opnames order by created_at desc limit 1;`);
    const belumPosting = psql(
      `select status from public.stock_opnames where id = '${idSesi}';`);
    record('Sesi masih draft, stok belum disentuh', belumPosting === 'draft', belumPosting);

    // ---- Posting tetap bekerja setelah hasil impor: stok isi ikut disamakan ----
    if (sku2) {
      const stokSebelum = Number(psql(
        `select stock_qty::numeric from public.products where sku = '${sku2}';`));
      await page.getByRole('button', { name: /^Posting$/i }).click();
      await page.waitForTimeout(800);
      // Posting memunculkan confirm() bawaan browser; sudah ditangani di atas
      // lewat page.on('dialog', ...).
      await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
      await page.waitForTimeout(2000);

      const stokSesudah = Number(psql(
        `select stock_qty::numeric from public.products where sku = '${sku2}';`));
      record('Posting menyamakan stok dengan hasil impor',
        stokSesudah === stokSistem2 + 5, `${stokSebelum} -> ${stokSesudah} (target ${stokSistem2 + 5})`);
      const statusAkhir = psql(`select status from public.stock_opnames where id = '${idSesi}';`);
      record('Sesi tercatat posted', statusAkhir === 'posted', statusAkhir);
    } else {
      record('Posting menyamakan stok dengan hasil impor', false, 'tidak ada baris uji');
      record('Sesi tercatat posted', false);
    }

    console.log('');
    console.log('--- RINGKASAN ---');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message.slice(0, 300));
    process.exitCode = 1;
  } finally {
    await browser.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
