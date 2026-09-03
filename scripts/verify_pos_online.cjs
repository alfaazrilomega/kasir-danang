// Uji perapian POS untuk toko online (butir client 4.2, 4.4, 4.5, 4.8).
//
// Yang diuji: sisa bentuk kerja restoran hilang dari layar, Order ID menempati
// baris bekasnya, dan jumlah dana yang benar-benar diterima bisa diketik untuk
// metode bayar apa pun — bukan cuma tunai.

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

const TAG = 'UJIPOS' + Date.now().toString().slice(-6);
const ORDER_ID = '#' + TAG;
const TERIMA = 328508; // dana masuk setelah potongan admin marketplace

const psql = (q) =>
  execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PW }, encoding: 'utf8' }).trim();

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  trackApi(page);
  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 })
      .then(() => true).catch(() => false));
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 4000 });

    // ---- Pengaturan: hanya Toko Online yang ditawarkan ----
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    const teksSet = await page.locator('body').innerText();
    record('Jenis usaha Toko Online tersedia', /Toko Online/i.test(teksSet));
    record('Pilihan bentuk usaha lain tidak ditawarkan',
      !/F&B \/ Cafe|Bakery \/ Roti|Salon|Warung \/ Retail/i.test(teksSet));

    // ---- POS: sisa bentuk restoran hilang ----
    await page.goto(BASE + '/menu', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    const teksPos = await page.locator('body').innerText();
    record('Dine In / Take Away hilang dari POS', !/Dine In|Take Away/i.test(teksPos));
    record('Kolom nomor meja hilang dari POS', !/No\. meja/i.test(teksPos));

    // ---- Order ID menempati baris bekasnya ----
    // Panel pesanan baru muncul utuh setelah ada barang di keranjang, jadi
    // barangnya dimasukkan dulu sebelum isi panel diperiksa.
    await page.locator('.card').filter({ hasText: /Add to Cart/i }).first()
      .getByRole('button', { name: /Add to Cart/i }).click();
    await page.waitForTimeout(1500);

    const kolomOrderId = page.locator('#input-order-id');
    record('Kolom Order ID ada di panel pesanan', await kolomOrderId.count() > 0);
    const petunjuk = await page.locator('body').innerText();
    record('Petunjuk nomor otomatis terbaca',
      /Dikosongkan berarti pakai nomor otomatis/i.test(petunjuk));

    await kolomOrderId.fill(ORDER_ID);
    await page.waitForTimeout(800);
    record('Order ID bisa diketik', (await kolomOrderId.inputValue()) === ORDER_ID, ORDER_ID);
    const setelahKetik = await page.locator('body').innerText();
    record('Petunjuk berubah saat nomor diketik sendiri',
      /Nomor manual dipakai/i.test(setelahKetik));

    // ---- Dana riil diterima untuk metode non-tunai ----
    await page.getByRole('button', { name: /^E-wallet$/i }).first().click();
    await page.waitForTimeout(800);
    // Marketplace default tempo; dana riil hanya masuk akal saat dibayar sekarang.
    const bayarSekarang = page.getByRole('button', { name: /Bayar Sekarang/i }).first();
    if (await bayarSekarang.count()) {
      await bayarSekarang.click();
      await page.waitForTimeout(600);
    }

    const kolomBayar = page.locator('input[type="number"]').filter({ hasNot: page.locator('x') }).last();
    const labelBayar = await page.locator('body').innerText();
    record('Kolom dana diberi label "Total riil diterima"', /Total riil diterima/i.test(labelBayar));
    record('Kolom dana tidak terkunci untuk metode non-tunai',
      await kolomBayar.isEnabled().catch(() => false));

    await kolomBayar.fill(String(TERIMA));
    await page.waitForTimeout(1000);
    const setelahIsi = await page.locator('body').innerText();
    record('Selisih terhadap total ditampilkan', /Selisih terhadap total/i.test(setelahIsi),
      (/Selisih terhadap total\s*\n?\s*([^\n]*)/.exec(setelahIsi) || ['-'])[0].replace(/\s+/g, ' ').slice(0, 45));

    const kolomAlasan = page.getByPlaceholder(/Alasan, cth/i).first();
    record('Kolom alasan penyesuaian muncul', await kolomAlasan.count() > 0);
    if (await kolomAlasan.count()) await kolomAlasan.fill('Potongan admin marketplace');

    await page.locator('#btn-place-order').click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    // ---- Bukti tersimpan ----
    const baris = psql(
      `select coalesce(total,0)::bigint || '|' || coalesce(original_total,0)::bigint || '|' ||
              coalesce(adjustment_amount,0)::bigint || '|' || coalesce(adjustment_note,'') || '|' ||
              case when adjusted_at is null then 'tanpa-waktu' else 'ada-waktu' end
         from public.orders where order_number = '${ORDER_ID}';`);
    const [total, awal, selisih, alasan, waktu] = baris.split('|');
    record('Pesanan tersimpan dengan Order ID yang diketik', baris !== '', ORDER_ID);
    record('Total memakai dana yang benar-benar diterima', Number(total) === TERIMA, 'Rp ' + total);
    record('Total awal tetap tersimpan', Number(awal) > 0 && Number(awal) !== TERIMA, 'Rp ' + awal);
    record('Selisih tercatat', Number(selisih) === TERIMA - Number(awal), selisih);
    record('Alasan tersimpan', alasan === 'Potongan admin marketplace', alasan || '(kosong)');
    record('Waktu penyesuaian tercatat', waktu === 'ada-waktu');

    // ---- Jejaknya terlihat di Riwayat Transaksi ----
    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByPlaceholder(/Cari ID/i).fill(TAG);
    await page.waitForTimeout(2000);
    const ketemu = await page.locator('tbody tr').count();
    record('Pesanan tampil di Riwayat Transaksi', ketemu > 0, ketemu + ' baris');
    if (ketemu > 0) {
      // Detail dibuka lewat tombol mata di kolom Aksi; mengeklik barisnya saja
      // tidak membuka apa pun.
      await page.locator('tbody tr').first().locator('button[title="Detail"]').click();
      const dialog = page.locator('div.fixed.inset-0').last();
      await dialog.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const detail = await dialog.innerText().catch(() => page.locator('body').innerText());
      record('Detail menyebut penyesuaian beserta total awalnya',
        /Total awal/i.test(detail) && /Potongan admin marketplace/i.test(detail),
        (/Total awal[^\n]*/i.exec(detail) || ['(tidak ada)'])[0].slice(0, 60));
    } else {
      record('Detail menyebut penyesuaian beserta total awalnya', false);
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
    try {
      psql(
        `delete from public.stock_movements m using public.orders o ` +
        `where o.id = m.ref_order_id and o.order_number = '${ORDER_ID}'; ` +
        `delete from public.order_items i using public.orders o ` +
        `where o.id = i.order_id and o.order_number = '${ORDER_ID}'; ` +
        `delete from public.orders where order_number = '${ORDER_ID}';`,
      );
    } catch (_) { /* biarkan */ }
  }
})();
