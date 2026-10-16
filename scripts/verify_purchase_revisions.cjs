// Uji butir client 1.1, 1.2, 1.3, dan 1.5 pada Pembelian Supplier.
//
//   1.1 Biaya admin pengiriman uang masuk pengeluaran usaha, bukan nilai nota.
//   1.2 Nota bisa diduplikat jadi nota baru.
//   1.3 Nota USD tampil berikut nilai rupiahnya.
//   1.5 Nota yang sedang diketik tidak hilang saat pindah menu.

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

const CAP = Date.now().toString().slice(-6);
const NOTA = 'UJIREV-' + CAP;
const SALINAN = NOTA + '-2';
const DRAFT = 'UJIDRAFT-' + CAP;
const SUP = 'Uji Revisi ' + CAP;
const KURS = 16000;
const HARGA_USD = 100;
const FEE = 275000;

const psql = (q) => execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
  ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
  { env: { ...process.env, PGPASSWORD: DB_PW }, encoding: 'utf8' }).trim();

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

(async () => {
  const storeId = psql('select id from public.stores limit 1;');
  psql(
    `insert into public.suppliers(store_id, name, currency, exchange_rate, default_dp_percent, default_term_days, is_active)
     values ('${storeId}', '${SUP}', 'USD', ${KURS}, 0, 30, true);`,
  );

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1050 } })).newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const modal = () => page.locator('div.fixed.inset-0').last();

  const bukaDetail = async (nomor) => {
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    // Kotak "Cari" pertama di halaman adalah pencarian modul di sidebar.
    // Memakainya membuat tabel tidak tersaring dan Detail membuka nota lain.
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(nomor);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1800);
  };

  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 })
      .then(() => true).catch(() => false));
    await waitForApiIdle(page, { idleMs: 4500, minWaitMs: 4000 });

    // ================= 1.3 tampilan USD + IDR =================
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Nota Baru/i }).click();
    await page.waitForTimeout(1800);

    const m = modal();
    await m.locator('select').first().selectOption({ label: SUP });
    await page.waitForTimeout(1200);
    await m.getByPlaceholder('PO-2026-001').fill(NOTA);
    await m.getByPlaceholder('Nama item').first().fill('Barang Uji Revisi');
    await m.getByPlaceholder('Qty').first().fill('1');
    await m.getByPlaceholder(/^Harga/).first().fill(String(HARGA_USD));
    await page.waitForTimeout(1200);

    const ringkasan = await m.innerText();
    record('Nota USD menampilkan nilai USD', /\$\s?100|US\$\s?100|100,00|100\.00/.test(ringkasan),
      (/Subtotal item[^\n]*\n?[^\n]*/.exec(ringkasan) || ['-'])[0].replace(/\s+/g, ' ').slice(0, 45));
    record('Nota USD sekaligus menampilkan nilai rupiahnya',
      /1\.600\.000/.test(ringkasan), '1.600.000 dari 100 x 16.000');
    record('Kurs yang dipakai disebutkan', /per USD/i.test(ringkasan));

    await m.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);
    record('Nota tersimpan', psql(
      `select count(*) from public.purchases where invoice_number = '${NOTA}';`) === '1');

    // ================= 1.2 duplikat nota =================
    await bukaDetail(NOTA);
    const tombolSalin = modal().getByRole('button', { name: /Duplikat nota/i }).first();
    record('Tombol duplikat nota tersedia', await tombolSalin.count() > 0);
    await tombolSalin.click();
    await page.waitForTimeout(2000);

    const m2 = modal();
    const nomorSalinan = await m2.getByPlaceholder('PO-2026-001').inputValue();
    record('Nomor nota salinan dibuat otomatis dan berbeda',
      nomorSalinan === SALINAN, nomorSalinan);
    const namaBarangSalinan = await m2.getByPlaceholder('Nama item').first().inputValue();
    record('Isi barang ikut tersalin', namaBarangSalinan === 'Barang Uji Revisi',
      namaBarangSalinan);
    const statusSalinan = await m2.locator('select').last().inputValue().catch(() => '');
    record('Status salinan kembali draft', statusSalinan === 'draft', statusSalinan);

    await m2.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);
    const salinanDb = psql(
      `select coalesce(received_at::text,'belum')||'|'||coalesce(paid_amount,0)::bigint
         from public.purchases where invoice_number = '${SALINAN}';`);
    record('Salinan tersimpan sebagai nota baru', salinanDb !== '', salinanDb);
    record('Riwayat nota asal tidak ikut tersalin',
      salinanDb.startsWith('belum|0'), salinanDb);

    // ================= 1.1 biaya admin pembayaran =================
    const feeSebelum = Number(psql(
      `select coalesce(sum(amount),0)::bigint from public.expenses where category = 'biaya_admin';`));
    const totalSebelum = Number(psql(
      `select coalesce(total,0)::bigint from public.purchases where invoice_number = '${NOTA}';`));

    await bukaDetail(NOTA);
    const tombolBayar = modal().getByRole('button', { name: /Catat pembayaran/i }).first();
    if (await tombolBayar.count()) {
      await tombolBayar.click();
      await page.waitForTimeout(1800);
      const m3 = modal();
      const kolomFee = m3.locator('#input-biaya-admin').first();
      record('Kolom biaya admin tersedia di form pembayaran', await kolomFee.count() > 0);
      await kolomFee.fill(String(FEE));
      await page.waitForTimeout(900);
      record('Layar menjelaskan biaya itu terpisah dari nota',
        /masuk pengeluaran usaha/i.test(await m3.innerText()));
      await m3.getByRole('button', { name: /Catat pembayaran/i }).click();
      await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
      await page.waitForTimeout(2000);
    } else {
      record('Kolom biaya admin tersedia di form pembayaran', false, 'tombol Bayar tidak ada');
      record('Layar menjelaskan biaya itu terpisah dari nota', false);
    }

    const feeSesudah = Number(psql(
      `select coalesce(sum(amount),0)::bigint from public.expenses where category = 'biaya_admin';`));
    record('Biaya admin tercatat sebagai pengeluaran usaha',
      feeSesudah - feeSebelum === FEE, 'Rp ' + (feeSesudah - feeSebelum));
    const totalSesudah = Number(psql(
      `select coalesce(total,0)::bigint from public.purchases where invoice_number = '${NOTA}';`));
    record('Nilai nota TIDAK ikut naik oleh biaya admin',
      totalSesudah === totalSebelum, 'Rp ' + totalSesudah);

    // ================= 1.5 draft tidak hilang =================
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Nota Baru/i }).click();
    await page.waitForTimeout(1500);
    const m4 = modal();
    await m4.getByPlaceholder('PO-2026-001').fill(DRAFT);
    await m4.getByPlaceholder('Nama item').first().fill('Barang Draft');
    await page.waitForTimeout(1500);

    // Pindah menu tanpa menyimpan, lalu kembali.
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });

    // Spanduk draft baru muncul setelah sesi dan profil termuat. Di mesin yang
    // sedang sibuk itu bisa lebih lama dari jeda sepi API, dan membaca layar
    // seketika menghasilkan merah palsu (cek sesudahnya tetap lolos karena
    // tombol Lanjutkan ditunggu). Tunggu spanduknya, baru baca.
    await page.getByText(/belum sempat disimpan/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const teks = await page.locator('body').innerText();
    record('Draft yang belum disimpan ditawarkan lagi',
      /belum sempat disimpan/i.test(teks) && teks.includes(DRAFT), DRAFT);

    await page.getByRole('button', { name: /^Lanjutkan$/i }).first().click();
    await page.waitForTimeout(1800);
    const m5 = modal();
    const nomorDraft = await m5.getByPlaceholder('PO-2026-001').inputValue();
    const barangDraft = await m5.getByPlaceholder('Nama item').first().inputValue();
    record('Isi draft kembali utuh', nomorDraft === DRAFT && barangDraft === 'Barang Draft',
      nomorDraft + ' / ' + barangDraft);

    await m5.getByRole('button', { name: /^Batal$/i }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^Buang$/i }).first().click();
    await page.waitForTimeout(1200);
    record('Draft bisa dibuang kalau tidak jadi dipakai',
      !/belum sempat disimpan/i.test(await page.locator('body').innerText()));

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
      psql(`delete from public.expenses where description like '%${NOTA}%';
            delete from public.purchase_payments p using public.purchases pu
              where pu.id = p.purchase_id and pu.invoice_number in ('${NOTA}','${SALINAN}');
            delete from public.purchase_items i using public.purchases pu
              where pu.id = i.purchase_id and pu.invoice_number in ('${NOTA}','${SALINAN}');
            delete from public.purchases where invoice_number in ('${NOTA}','${SALINAN}');
            delete from public.suppliers where name = '${SUP}';`);
    } catch (_) { /* biarkan */ }
  }
})();
