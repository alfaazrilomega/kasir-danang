// Uji penguncian kurs nota pembelian (butir client 1.4).
//
// Kurs sebuah nota adalah angka historis. Begitu barangnya diterima, biaya
// perolehannya sudah terjadi pada kurs hari itu. Memilih ulang supplier pada
// nota semacam itu pernah menarik kurs HARI INI dan menaikkan seluruh nilai
// notanya: $100 yang dibukukan Rp 1.600.000 berubah jadi Rp 1.800.000 tanpa ada
// transaksi baru.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');

const BASE = 'http://localhost:5173';
const ENV = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(String.fromCharCode(10)).map((l) => l.trim());
const ADMIN_PW = (ENV.find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const DB_PW = /:\/\/[^:]+:([^@]*)@/.exec(ENV.find((l) => l.startsWith('DATABASE_URL=')) || '')?.[1];

const NOTA = 'UJIKURS-' + Date.now().toString().slice(-6);
const SUP = 'Uji Kurs ' + Date.now().toString().slice(-5);
const KURS_AWAL = 16000;
const KURS_BARU = 18000;
const HARGA_USD = 100;

function psql(q, boleh = false) {
  try {
    return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
      ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
      { env: { ...process.env, PGPASSWORD: DB_PW }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (boleh) return 'GAGAL: ' + String(e.stderr || e.message).trim();
    throw e;
  }
}

const nilai = (kolom) => psql(
  `select coalesce(${kolom},0)::bigint from public.purchases where invoice_number = '${NOTA}';`);

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

(async () => {
  const storeId = psql('select id from public.stores limit 1;');
  psql(
    `insert into public.suppliers(store_id, name, currency, exchange_rate, default_dp_percent, default_term_days, is_active)
     values ('${storeId}', '${SUP}', 'USD', ${KURS_AWAL}, 0, 30, true);`,
  );

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1050 } })).newPage();
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

    // ---- Nota baru tetap mengambil kurs supplier ----
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Nota Baru/i }).click();
    await page.waitForTimeout(1800);

    const m = modal();
    await m.locator('select').first().selectOption({ label: SUP });
    await page.waitForTimeout(1200);
    const kursBaru = await m.locator('input[type="number"]').first().inputValue().catch(() => '');
    record('Nota baru tetap mengambil kurs supplier', Number(kursBaru) === KURS_AWAL, kursBaru);

    await m.getByPlaceholder('PO-2026-001').fill(NOTA);
    await m.getByPlaceholder('Nama item').first().fill('Barang Uji Kurs');
    await m.getByPlaceholder('Qty').first().fill('1');
    await m.getByPlaceholder(/^Harga/).first().fill(String(HARGA_USD));
    await page.waitForTimeout(900);
    await m.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const totalAwal = Number(nilai('total'));
    record('Nilai nota dibukukan pada kurs saat itu',
      totalAwal === HARGA_USD * KURS_AWAL, 'Rp ' + totalAwal);

    // ---- Terima barang ----
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByPlaceholder(/Cari/i).first().fill(NOTA);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1800);
    await modal().getByRole('button', { name: /Terima barang/i }).first().click();
    await page.waitForTimeout(1200);
    // Dialog jumlah aktual: jumlah diterima = jumlah dipesan, langsung konfirmasi.
    await modal().getByRole('button', { name: /^Terima barang$/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1800);
    record('Barang tercatat diterima',
      psql(`select case when received_at is null then 'belum' else 'sudah' end
              from public.purchases where invoice_number = '${NOTA}';`) === 'sudah');

    // ---- Kurs supplier bergerak ----
    psql(`update public.suppliers set exchange_rate = ${KURS_BARU} where name = '${SUP}';`);

    // ---- Buka lagi notanya ----
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.getByPlaceholder(/Cari/i).first().fill(NOTA);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1800);
    await modal().getByRole('button', { name: /Edit nota/i }).first().click();
    await page.waitForTimeout(2000);

    const m2 = modal();
    const kolomKurs = m2.locator('input[type="number"]').first();
    record('Nota dibuka dengan kurs historisnya',
      Number(await kolomKurs.inputValue().catch(() => 0)) === KURS_AWAL,
      await kolomKurs.inputValue().catch(() => '?'));
    record('Kolom kurs terkunci pada nota yang sudah diterima',
      !(await kolomKurs.isEnabled().catch(() => true)));
    record('Alasan penguncian dijelaskan di layar',
      /Terkunci: barang sudah diterima/i.test(await m2.innerText()));

    // Memilih ulang supplier tidak boleh menarik kurs hari ini.
    await m2.locator('select').first().selectOption({ label: SUP });
    await page.waitForTimeout(1200);
    record('Memilih ulang supplier tidak menimpa kurs nota',
      Number(await kolomKurs.inputValue().catch(() => 0)) === KURS_AWAL,
      await kolomKurs.inputValue().catch(() => '?'));

    await m2.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1800);

    record('Kurs nota tidak berubah setelah disimpan ulang',
      Number(nilai('exchange_rate')) === KURS_AWAL, nilai('exchange_rate'));
    record('Nilai nota tidak ikut naik', Number(nilai('total')) === totalAwal,
      'Rp ' + nilai('total'));

    // ---- Penjagaan di database, bukan cuma di layar ----
    const tolak = psql(
      `update public.purchases set exchange_rate = ${KURS_BARU} where invoice_number = '${NOTA}';`,
      true);
    record('Penulisan langsung ke database ikut ditolak',
      tolak.startsWith('GAGAL') && /Kurs nota tidak bisa diubah/i.test(tolak),
      tolak.startsWith('GAGAL') ? 'ditolak' : 'LOLOS TANPA PENOLAKAN');
    record('Kurs tetap utuh setelah percobaan itu',
      Number(nilai('exchange_rate')) === KURS_AWAL, nilai('exchange_rate'));

    // Kolom lain tetap boleh diubah: yang dikunci hanya nilai historisnya.
    const bolehUbah = psql(
      `update public.purchases set notes = 'catatan boleh diubah' where invoice_number = '${NOTA}';`,
      true);
    record('Kolom lain pada nota yang sama tetap bisa diubah', !bolehUbah.startsWith('GAGAL'));

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
    try {
      psql(`delete from public.purchase_items i using public.purchases pu
              where pu.id = i.purchase_id and pu.invoice_number = '${NOTA}';
            delete from public.purchases where invoice_number = '${NOTA}';
            delete from public.suppliers where name = '${SUP}';`);
    } catch (_) { /* biarkan */ }
  }
})();
