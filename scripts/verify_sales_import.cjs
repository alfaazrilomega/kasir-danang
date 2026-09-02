// Verifikasi Impor Penjualan Massal.
//
// Permintaan client: memasukkan penjualan lama yang datanya diambil dari nomor
// pesanan, berisi SKU dan harga barang. Satu pesanan bisa berisi 10-15 barang.
//
// Yang dikunci uji ini:
//  - kolomnya sama dengan hasil ekspor Riwayat Transaksi, jadi berkas ekspor
//    bisa dipakai balik sebagai berkas impor;
//  - baris bernomor pesanan sama digabung jadi SATU pesanan;
//  - baris rusak dilaporkan per nomor baris dan tidak ikut masuk;
//  - nomor pesanan yang sudah ada dilewati, bukan diduplikasi;
//  - stok TIDAK berubah, karena ini pencatatan penjualan lama.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();

const results = [];
const record = (n, p, d) => {
  results.push({ n, p });
  console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
};

const TAG = 'IMPJUAL' + Date.now().toString().slice(-6);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kasir-jual-'));
const NL = String.fromCharCode(13, 10);

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  trackApi(page);
  try {
    // Bersihkan sisa run sebelumnya supaya hitungan tidak tercampur.
    sql("delete from public.order_items where order_id in (select id from public.orders where notes = 'Impor penjualan massal');");
    sql("delete from public.orders where notes = 'Impor penjualan massal';");

    // Ambil produk nyata supaya baris impor tertaut ke katalog.
    const produk = sql("select sku || '|' || name || '|' || stock_qty::int from public.products where sku is not null and is_active order by sku limit 15;")
      .split(String.fromCharCode(10))
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => { const [sku, nama, stok] = r.split('|'); return { sku, nama, stok: Number(stok) }; });
    record('Ada produk untuk diuji', produk.length >= 3, produk.length + ' produk');

    // Berkas uji: satu pesanan berisi 12 barang (kasus yang diminta client),
    // satu pesanan biasa, plus tiga baris sengaja rusak.
    const header = 'sep=;' + NL +
      'No. Pesanan;No. Pesanan Platform;Tanggal;Channel;SKU;Barcode;Nama Produk;Qty;Harga Satuan;Subtotal;Status Bayar;Status Order';
    const besar = produk.slice(0, 12).map((p, i) =>
      `#${TAG}-A;SHP${TAG};15/07/2026 10:30;Shopee;${p.sku};;${p.nama};${i + 1};25000;;Lunas;Selesai`);
    const kecil = [
      `#${TAG}-B;;20/08/2026;Offline;${produk[0].sku};;${produk[0].nama};2;30000;;Lunas;Selesai`,
      `#${TAG}-B;;20/08/2026;Offline;${produk[1].sku};;${produk[1].nama};1;45000;;Lunas;Selesai`,
    ];
    const rusak = [
      `;;20/08/2026;Offline;${produk[0].sku};;${produk[0].nama};1;10000;;Lunas;Selesai`,
      `#${TAG}-C;;tanggal-ngawur;Offline;${produk[0].sku};;${produk[0].nama};1;10000;;Lunas;Selesai`,
      `#${TAG}-D;;21/08/2026;Offline;${produk[0].sku};;${produk[0].nama};0;10000;;Lunas;Selesai`,
    ];
    const berkas = [header, ...besar, ...kecil, ...rusak].join(NL);
    const jalur = path.join(tmp, 'penjualan.csv');
    fs.writeFileSync(jalur, berkas, 'utf8');

    const stokAwal = Number(sql(`select stock_qty::int from public.products where sku='${produk[0].sku}';`));

    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    record('Login admin', !page.url().includes('/login'));

    await page.goto('http://localhost:5173/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2500 });

    await page.getByRole('button', { name: /Impor Penjualan/i }).click();
    await page.waitForTimeout(900);
    const modal = await page.locator('div.fixed.inset-0.z-50').innerText();
    record('Modal impor penjualan terbuka', /Impor Penjualan Massal/i.test(modal));
    record('Peringatan stok tidak berubah tampil', /tidak mengubah stok/i.test(modal));

    await page.locator('input[type="file"]').setInputFiles(jalur);
    await page.waitForTimeout(2500);
    const rencana = await page.locator('div.fixed.inset-0.z-50').innerText();
    console.log('--- ISI MODAL ---');
    console.log(rencana.replace(/\s+/g, ' ').slice(0, 800));
    console.log('--- /ISI MODAL ---');
    // Tombolnya nonaktif kalau rencananya kosong, jadi ini penanda paling jujur
    // bahwa berkasnya benar-benar terbaca.
    const tombolImpor = page.getByRole('button', { name: /Impor \d+ Pesanan/i }).first();
    const tombolAktif = await tombolImpor.isEnabled().catch(() => false);
    record('Tombol impor aktif (rencana tidak kosong)', tombolAktif);
    record('Baris bermasalah dilaporkan per nomor baris', /Baris \d+:/.test(rencana));
    record('Tanggal ngawur terdeteksi', /tidak dikenali/i.test(rencana));
    record('Qty nol terdeteksi', /bukan angka lebih dari nol/i.test(rencana));

    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '47_impor_penjualan.png') });

    await page.getByRole('button', { name: /Impor \d+ Pesanan/i }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.waitForTimeout(1500);

    const jumlahOrder = Number(sql(`select count(*) from public.orders where order_number like '%${TAG}%';`));
    record('Dua pesanan tersimpan di Postgres', jumlahOrder === 2, jumlahOrder + ' pesanan');

    const itemBesar = Number(sql(`select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.order_number = '#${TAG}-A';`));
    record('Pesanan 12 barang digabung jadi satu pesanan', itemBesar === 12, itemBesar + ' baris barang');

    const platform = sql(`select coalesce(external_order_no,'') from public.orders where order_number = '#${TAG}-A';`);
    record('Nomor pesanan platform ikut tersimpan', platform === 'SHP' + TAG, platform);

    const channel = sql(`select sales_channel from public.orders where order_number = '#${TAG}-A';`);
    record('Channel dikenali dari namanya', channel === 'shopee', channel);

    // 25000 * (1+2+...+12) = 25000 * 78
    const totalA = Number(sql(`select total::int from public.orders where order_number = '#${TAG}-A';`));
    record('Total pesanan dijumlah dari barisnya', totalA === 25000 * 78, 'Rp ' + totalA);

    const tertaut = Number(sql(`select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.order_number like '%${TAG}%' and i.product_id is not null;`));
    record('Baris impor tertaut ke produk katalog', tertaut === 14, tertaut + ' dari 14 baris');

    const stokAkhir = Number(sql(`select stock_qty::int from public.products where sku='${produk[0].sku}';`));
    record('Stok TIDAK berubah', stokAkhir === stokAwal, `${stokAwal} -> ${stokAkhir}`);

    const mutasi = Number(sql(`select count(*) from public.stock_movements where reason like '%${TAG}%';`));
    record('Tidak ada mutasi stok dibuat', mutasi === 0, mutasi + ' mutasi');

    // Impor ulang berkas yang sama: nomornya sudah ada, harus dilewati.
    await page.reload({ waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Impor Penjualan/i }).click();
    await page.waitForTimeout(900);
    await page.locator('input[type="file"]').setInputFiles(jalur);
    await page.waitForTimeout(2500);
    const ulang = await page.locator('div.fixed.inset-0.z-50').innerText();
    record('Impor ulang melewati pesanan yang sudah ada', /pesanan dilewati/i.test(ulang));

    const setelahUlang = Number(sql(`select count(*) from public.orders where order_number like '%${TAG}%';`));
    record('Tidak ada pesanan ganda', setelahUlang === 2, setelahUlang + ' pesanan');

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.p).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '98_impor_jual_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    try {
      sql("delete from public.order_items where order_id in (select id from public.orders where notes = 'Impor penjualan massal');");
      sql("delete from public.orders where notes = 'Impor penjualan massal';");
    } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    await browser.close();
  }
})();
