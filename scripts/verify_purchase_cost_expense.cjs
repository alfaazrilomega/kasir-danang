// Verifikasi: biaya nota PO ("Biaya lain" & "Biaya tambahan") tercatat
// otomatis sebagai baris `expenses` bertanggal dan berkategori sendiri.
//
//   - Tiap biaya bernominal > 0 dikunci ke satu baris expenses lewat pasangan
//     (purchase_id, purchase_cost_slot) -- simpan ulang nota memperbarui
//     baris itu, tidak pernah menggandakannya.
//   - Nominal 0/kosong menghapus baris pengeluarannya.
//   - Menghapus nota ikut menghapus pengeluaran otomatisnya (ON DELETE
//     CASCADE pada expenses.purchase_id).
//   - Nota USD: nominal pengeluaran SELALU disimpan dalam rupiah (dolar x
//     kurs nota), sama seperti subtotal/total nota.
//   - Layar Pengeluaran memberi lencana "dari nota PO" hanya pada baris yang
//     purchase_id-nya terisi; baris yang diketik manual tidak diberi lencana.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');

const BASE = 'http://localhost:5173';
const ENV = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim());
const ADMIN_PW = (ENV.find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const DB_PW = /:\/\/[^:]+:([^@]*)@/.exec(ENV.find((l) => l.startsWith('DATABASE_URL=')) || '')?.[1];

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

const TAG = 'UJIPOCOST' + Date.now().toString().slice(-6);
const INV = TAG;
const INV_USD = TAG + '-USD';

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

// Tanggal beda dari tanggal nota supaya kasus "tersimpan pada tanggal yang
// diisi, bukan tanggal nota" benar-benar teruji.
const hariLokal = (mundur) => {
  const d = new Date(Date.now() - mundur * 86400000);
  const l = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return l.toISOString().slice(0, 10);
};
const TGL_ONGKIR = hariLokal(5);
const TGL_KEMAS = hariLokal(2);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const modal = () => page.locator('div.fixed.inset-0').last();

  try {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.goto(BASE + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });

    // ================= Kasus 1: dua biaya, dua tanggal berbeda =================
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
    let m = modal();
    await m.getByPlaceholder('PO-2026-001').fill(INV);
    await m.getByPlaceholder('Nama item').first().fill('Barang Uji ' + TAG);
    await m.getByPlaceholder('Qty').first().fill('1');
    await m.getByPlaceholder(/^Harga \(/).first().fill('1000000');
    await m.locator('label:text-is("Biaya lain") + input').fill('50000');
    await m.locator('label:text-is("Nama biaya lain") + input').fill('Ongkir masuk ' + TAG);
    await m.locator('label:text-is("Biaya tambahan") + input').fill('25000');
    await m.locator('label:text-is("Nama biaya tambahan") + input').fill('Pengemasan ' + TAG);
    const tanggal = m.locator('label:text-is("Tanggal pengeluaran") + input');
    await tanggal.nth(0).fill(TGL_ONGKIR);
    await tanggal.nth(1).fill(TGL_KEMAS);
    await m.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const notaId = psql(`select id from public.purchases where invoice_number = '${INV}';`);
    record('Nota tersimpan', !!notaId, notaId || '(kosong)');

    let baris = psql(`select purchase_cost_slot || '|' || amount::int || '|' || expense_date || '|' || category
                        from public.expenses where purchase_id = '${notaId}' order by purchase_cost_slot;`)
      .split('\n').map((r) => r.trim()).filter(Boolean);
    record('Dua baris biaya menghasilkan dua baris pengeluaran', baris.length === 2, baris.join(' , '));
    record('Biaya tambahan: slot "extra", nominal, tanggal, kategori benar',
      baris[0] === `extra|25000|${TGL_KEMAS}|perlengkapan`, baris[0] || '-');
    record('Biaya lain: slot "other", nominal, tanggal, kategori benar',
      baris[1] === `other|50000|${TGL_ONGKIR}|transport`, baris[1] || '-');

    // ================= Kasus 2: simpan nota dua kali tidak menggandakan =================
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(2000);
    await modal().getByRole('button', { name: /Edit nota/i }).click();
    await page.waitForTimeout(2500);
    await modal().getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const jumlahUlang = psql(`select count(*)::int from public.expenses where purchase_id = '${notaId}';`);
    record('Menyimpan nota dua kali tidak menggandakan pengeluaran', jumlahUlang === '2', jumlahUlang + ' baris');

    // ================= Kasus 3: mengosongkan satu biaya menghapus baris itu =================
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(2000);
    await modal().getByRole('button', { name: /Edit nota/i }).click();
    await page.waitForTimeout(2500);
    await modal().locator('label:text-is("Biaya tambahan") + input').fill('0');
    await modal().getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const sisa = psql(`select coalesce(string_agg(purchase_cost_slot, ','), '(kosong)')
                       from public.expenses where purchase_id = '${notaId}';`);
    record('Mengosongkan biaya tambahan menghapus baris pengeluarannya, sisakan "other"',
      sisa === 'other', sisa);

    // ================= Kasus 4: hapus nota ikut menghapus pengeluaran (cascade) =================
    psql(`delete from public.purchases where id = '${notaId}';`);
    const setelahHapus = psql(`select count(*)::int from public.expenses where purchase_id = '${notaId}';`);
    record('Menghapus nota ikut menghapus pengeluaran otomatisnya (ON DELETE CASCADE)',
      setelahHapus === '0', setelahHapus + ' baris');

    // ================= Kasus 5: nota USD, nominal pengeluaran dalam rupiah =================
    await page.goto(BASE + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
    const mu = modal();
    await mu.getByPlaceholder('PO-2026-001').fill(INV_USD);
    await mu.locator('select').filter({ hasText: /Dolar AS/ }).first().selectOption('USD');
    await page.waitForTimeout(800);
    await mu.getByPlaceholder('Nama item').first().fill('Barang USD ' + TAG);
    await mu.getByPlaceholder('Qty').first().fill('1');
    await mu.getByPlaceholder(/^Harga \(/).first().fill('1000');
    await mu.locator('label:text-is("Biaya lain") + input').fill('10');
    await mu.locator('label:text-is("Nama biaya lain") + input').fill('Ongkir laut ' + TAG);
    await mu.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const dataUsd = psql(`select e.amount::int || '|' || p.exchange_rate::int || '|' || p.store_id
                          from public.expenses e join public.purchases p on p.id = e.purchase_id
                          where p.invoice_number = '${INV_USD}' and e.purchase_cost_slot = 'other';`);
    const [nilaiUsd, kursUsd, storeIdUsd] = (dataUsd || '').split('|');
    record('Nota USD: biaya $10 tersimpan dalam rupiah sesuai kurs nota',
      !!kursUsd && nilaiUsd === String(Math.round(10 * Number(kursUsd))),
      dataUsd || '(kosong)');

    // ================= Kasus 6: lencana "dari nota PO" di layar Pengeluaran =================
    // Satu baris otomatis (dari nota USD di atas) dan satu baris diketik
    // manual, supaya lencana kelihatan bedanya.
    if (storeIdUsd) {
      psql(`insert into public.expenses (id, store_id, category, description, amount, expense_date,
              payment_method, shift_id, created_by, created_at)
            values (gen_random_uuid(), '${storeIdUsd}', 'lainnya', 'Pengeluaran manual ${TAG}', 30000,
              current_date, 'cash', null, null, now());`);
    }

    await page.goto(BASE + '/expenses', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    await page.waitForSelector('tbody tr', { timeout: 60000 });

    const barisNota = page.locator('tbody tr').filter({ hasText: 'Ongkir laut ' + TAG }).first();
    const barisManual = page.locator('tbody tr').filter({ hasText: 'Pengeluaran manual ' + TAG }).first();
    record('Layar Pengeluaran: baris dari nota diberi lencana "dari nota PO"',
      (await barisNota.getByText('dari nota PO').count()) === 1);
    record('Layar Pengeluaran: baris yang diketik manual TIDAK diberi lencana',
      (await barisManual.getByText('dari nota PO').count()) === 0);

    console.log('');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + String(e.message || e).slice(0, 300));
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`delete from public.expenses where description like '%${TAG}%';`, true);
      psql(`delete from public.purchase_items where purchase_id in
              (select id from public.purchases where invoice_number like '${TAG}%');`, true);
      psql(`delete from public.purchases where invoice_number like '${TAG}%';`, true);
    } catch (_) { /* biarkan */ }
  }
})();
