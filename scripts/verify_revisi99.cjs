// Verifikasi revisi client "Catatan 9.9" lewat alur pengguna nyata.
//
// Data uji dibuat lewat SQL (nota pembelian, dua pesanan yang sudah memotong
// stok), lalu setiap butir dijalankan dari layar seperti admin memakainya.
// Angka stok dicek langsung di Postgres, bukan dari teks layar.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { BASE_URL: BASE, DB_PASSWORD, trackApi, waitForApiIdle, loginAdmin } = require('./lib/harness.cjs');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
const sql = (q) =>
  execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: DB_PASSWORD },
    encoding: 'utf8',
  }).trim();
const first = (q) => sql(q).split('\n')[0].trim();
// Isi file unduhan dengan batas waktu: download.path() menunggu tanpa batas.
const bacaUnduhan = (d) =>
  Promise.race([
    d.path().then((f) => fs.readFileSync(f, 'utf8')),
    new Promise((_, tolak) => setTimeout(() => tolak(new Error('unduhan tidak selesai dalam 20 detik')), 20000)),
  ]);

const TS = Date.now().toString(36).toUpperCase();
const NOTA = `UJI99-PO-${TS}`;
const ORDER_A = `UJI99-A-${TS}`;
const ORDER_B = `UJI99-B-${TS}`;

(async () => {
  const results = [];
  const record = (n, p, d) => {
    results.push({ n, p });
    console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d !== undefined ? ' — ' + d : ''));
  };

  const S = first('select id from public.stores order by created_at limit 1;');
  const [A, NAMA_A, SKU_A] = first(
    `select id||'|'||name||'|'||sku from public.products where store_id='${S}' and sku='KAS-KOP-003';`,
  ).split('|');
  const [B, , SKU_B] = first(
    `select id||'|'||name||'|'||sku from public.products where store_id='${S}' and sku='KAS-PAS-042';`,
  ).split('|');
  const stok = (id) => Number(first(`select stock_qty from public.products where id='${id}';`));
  const modal = (id) => Number(first(`select cost_price from public.products where id='${id}';`));
  const stok0 = stok(A);
  const T0 = first('select now();');

  // Nota: 10 dipesan @ Rp1.000.
  const PO = first(`insert into public.purchases(store_id, invoice_number, status, subtotal, total)
      values ('${S}', '${NOTA}', 'ordered', 10000, 10000) returning id;`);
  sql(`insert into public.purchase_items(purchase_id, product_id, name, sku, qty, cost_price, subtotal, original_cost_price)
      values ('${PO}', '${A}', '${NAMA_A}', '${SKU_A}', 10, 1000, 10000, 1000);`);

  // Dua pesanan selesai, masing-masing 3 pcs, stok sudah terpotong.
  const buatOrder = (no) => {
    const id = first(`insert into public.orders(store_id, order_number, subtotal, tax, discount, total,
        payment_method, payment_status, order_status, points_earned, customer_name)
        values ('${S}', '${no}', 33000, 0, 0, 33000, 'cash', 'paid', 'done', 0, 'Pembeli Uji ${no.slice(6, 7)}')
        returning id;`);
    sql(`insert into public.order_items(order_id, product_id, name, qty, price, cost_price)
        values ('${id}', '${A}', '${NAMA_A}', 3, 11000, 11000);`);
    sql(`select public.apply_order_stock('${id}');`);
    return id;
  };
  const OA = buatOrder(ORDER_A);
  const OB = buatOrder(ORDER_B);
  record('Data uji: dua pesanan memotong stok 6', stok(A) === stok0 - 6, `${stok0} -> ${stok(A)}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  trackApi(page);
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console] ' + m.text().slice(0, 300));
  });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const dialogTeratas = () => page.locator('div.fixed.inset-0').last();

  try {
    await loginAdmin(page);
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {});

    // ---------- 4.4 Transfer, 4.14 qty bisa diketik ----------
    await page.goto(BASE + '/menu', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.locator('.card').filter({ hasText: /Add to Cart/i }).first()
      .getByRole('button', { name: /Add to Cart/i }).click();
    await page.waitForTimeout(800);
    const teksPos = await page.locator('body').innerText();
    record('4.4 Metode bayar Transfer tersedia', /Transfer/.test(teksPos));
    record('4.4 Debit/Credit tidak tampil lagi', !/Debit|Credit/.test(teksPos));
    const qty = page.locator('input[aria-label="Jumlah"]').first();
    await qty.click();
    await qty.fill('100');
    await qty.blur();
    await page.waitForTimeout(600);
    record('4.14 Jumlah bisa diketik langsung (100)', (await qty.inputValue()) === '100', await qty.inputValue());
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_pos_desktop.png') });

    await page.setViewportSize({ width: 400, height: 860 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const lebar = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    record('4.14 Kasir di HP tidak melebar ke samping', lebar[0] <= lebar[1] + 1, lebar.join(' vs '));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_pos_mobile.png'), fullPage: true });
    // Di HP keranjang harus bisa dipakai: tambah barang, kolom jumlah terlihat
    // di dalam layar dan bisa diketik.
    await page.locator('.card').filter({ hasText: /Add to Cart/i }).first()
      .getByRole('button', { name: /Add to Cart/i }).click();
    await page.waitForTimeout(800);
    const qtyHp = page.locator('input[aria-label="Jumlah"]').first();
    const kotak = await qtyHp.boundingBox();
    record('4.14 Kolom jumlah terlihat di layar HP',
      !!kotak && kotak.x >= 0 && kotak.x + kotak.width <= 400 && kotak.y >= 0 && kotak.y + kotak.height <= 860,
      JSON.stringify(kotak));
    await qtyHp.click();
    await qtyHp.fill('5');
    await qtyHp.blur();
    await page.waitForTimeout(500);
    record('4.14 Jumlah bisa diketik di HP', (await qtyHp.inputValue()) === '5', await qtyHp.inputValue());
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_pos_mobile_keranjang.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // ---------- 4.8 / 4.11 Harga sudah termasuk pajak ----------
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 1000 });
    await page.locator('label').filter({ hasText: 'Harga sudah termasuk pajak' }).click();
    await page.getByRole('button', { name: /^Simpan$/ }).last().click();
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    record('4.8 Setelan pajak termasuk tersimpan di server',
      first(`select coalesce(features->>'taxInclusive','') from public.stores where id='${S}';`) === 'true');
    const adaTtd = await page.getByText('Tanda tangan faktur A4').count();
    record('4.10 Pengaturan tanda tangan faktur tersedia', adaTtd > 0);
    await page.goto(BASE + '/menu', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    // Baris pajak hanya muncul saat keranjang berisi.
    await page.locator('.card').filter({ hasText: /Add to Cart/i }).first()
      .getByRole('button', { name: /Add to Cart/i }).click();
    await page.waitForTimeout(800);
    record('4.8 Kasir menampilkan "Termasuk pajak"', /Termasuk pajak/i.test(await page.locator('body').innerText()));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_pajak_termasuk.png') });

    // ---------- 1.8 Terima barang dengan jumlah aktual ----------
    await page.goto(BASE + '/purchases', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    // Kotak "Cari" pertama di halaman adalah pencarian modul di sidebar, jadi
    // baris nota dicari langsung lewat nomornya.
    await page.locator('tr', { hasText: NOTA }).getByRole('button', { name: /Detail/i }).click();
    await page.waitForTimeout(1200);
    await dialogTeratas().getByRole('button', { name: /Terima barang/i }).first().click();
    await page.waitForTimeout(1200);
    const kolomDiterima = dialogTeratas().locator(`input[aria-label="Diterima ${NAMA_A}"]`);
    record('1.8 Dialog jumlah diterima muncul', (await kolomDiterima.count()) === 1);
    await kolomDiterima.fill('12');
    await page.waitForTimeout(400);
    record('1.8 Nilai nota ikut jumlah aktual di layar', /12\.000/.test(await dialogTeratas().innerText()));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_terima_barang.png') });
    await dialogTeratas().getByRole('button', { name: /^Terima barang$/i }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    const po = first(`select status||'|'||total||'|'||(received_at is not null)::text from public.purchases where id='${PO}';`);
    const poItem = first(`select received_qty||'|'||subtotal from public.purchase_items where purchase_id='${PO}';`);
    record('1.8 Nota tercatat diterima 12, total Rp12.000',
      po.startsWith('received|12000') && poItem.startsWith('12'), `${po} / ${poItem}`);
    record('1.8 Stok bertambah 12 (bukan 10)', stok(A) === stok0 - 6 + 12, String(stok(A)));

    // ---------- 4.10 Faktur A4: SKU, kasir, tanda tangan ----------
    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    const barisA = page.locator('tbody tr').filter({ hasText: ORDER_A });
    // Iframe cetak dibuang setelah print(); simpan isinya tepat sebelum dibuang.
    await page.evaluate(() => {
      window.__cetak = [];
      const asli = document.body.removeChild.bind(document.body);
      document.body.removeChild = (n) => {
        if (n && n.tagName === 'IFRAME') window.__cetak.push(n.contentDocument?.body?.innerText || '');
        return asli(n);
      };
    });
    await barisA.locator('button[title*="Cetak faktur A4"]').click();
    await page.waitForTimeout(2500);
    const isiFaktur = await page.evaluate(() =>
      [...window.__cetak, ...[...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.body?.innerText || '')]
        .join('\n'));
    record('4.10 Faktur A4 memuat kolom SKU dan SKU produk', /SKU/.test(isiFaktur) && isiFaktur.includes(SKU_A));
    record('4.10 Faktur A4 memuat nama kasir dan blok tanda tangan', /Kasir:/.test(isiFaktur) && /Hormat kami/.test(isiFaktur));
    record('4.11 Faktur tidak menampilkan "Dine In"', !/Dine In/i.test(isiFaktur));
    const headTabel = await page.locator('thead').first().innerText();
    record('4.11 Kolom Type tidak tampil di riwayat toko sparepart', !/\bType\b/.test(headTabel));

    // ---------- 6.1 Simpan PDF dari riwayat ----------
    await barisA.locator('button[title="Detail"]').click();
    await page.waitForTimeout(1000);
    const detail = await dialogTeratas().innerText();
    record('6.1 Detail riwayat punya cetak/PDF thermal dan A4',
      /Cetak Thermal \/ PDF/.test(detail) && /Cetak Faktur A4 \/ PDF/.test(detail));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_detail_riwayat.png') });
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(600);

    // ---------- Ekspor dana cair ----------
    const [unduh] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Export Dana Cair/i }).click(),
    ]);
    const csv = await bacaUnduhan(unduh);
    record('Ekspor dana cair berisi harga tayang, potongan, dana cair',
      /Harga Tayang/.test(csv) && /Potongan/.test(csv) && /Dana Cair/.test(csv) && csv.includes(ORDER_A));

    // ---------- 6.2 / 4.1 Centang lalu batal / hapus ----------
    await page.locator(`input[aria-label="Pilih ${ORDER_A}"]`).check();
    await page.waitForTimeout(400);
    const bar = page.locator('div').filter({ hasText: /pesanan dipilih/ }).last();
    record('6.2 Bar aksi massal muncul setelah dicentang', await bar.isVisible());
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_centang_riwayat.png') });
    await bar.getByRole('button', { name: /^Batalkan$/ }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    record('6.2 Pesanan dibatalkan', first(`select order_status from public.orders where id='${OA}';`) === 'canceled');
    record('6.2 Stok pesanan batal kembali (+3)', stok(A) === stok0 - 6 + 12 + 3, String(stok(A)));

    await page.locator(`input[aria-label="Pilih ${ORDER_B}"]`).check();
    await page.waitForTimeout(400);
    await page.locator('div').filter({ hasText: /pesanan dipilih/ }).last()
      .getByRole('button', { name: /^Hapus$/ }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    record('4.1 Pesanan terhapus', first(`select count(*) from public.orders where id='${OB}';`) === '0');
    record('4.1 Stok pesanan terhapus kembali (+3)', stok(A) === stok0 + 12, `${stok0} + 12 = ${stok(A)}`);
    const tabelSetelah = await page.locator('tbody').first().innerText();
    record('4.1 Pesanan terhapus hilang dari tabel', !tabelSetelah.includes(ORDER_B));

    // ---------- 3.2 Lacak SKU ke pembeli ----------
    await page.goto(BASE + '/stock-mutation', { waitUntil: 'networkidle' });
    // Perangkat baru: seeder demo lokal masih menulis mutasi sambil pull
    // berjalan. Tunggu reda lalu muat ulang agar data server yang tampil.
    await page.waitForTimeout(20000);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    const tanggal = page.locator('input[type="date"]');
    await tanggal.nth(0).fill('2020-01-01');
    await tanggal.nth(1).fill('2030-12-31');
    await page.getByPlaceholder(/Cari produk/i).fill(SKU_A);
    await page.waitForTimeout(2500);
    const teksMutasi = await page.locator('body').innerText();
    record('3.2 Kartu lacak SKU tampil (awal, masuk, keluar, sisa)',
      /Lacak/.test(teksMutasi) && /Stok awal periode/.test(teksMutasi) && /Sisa akhir periode/.test(teksMutasi));
    record('3.2 Terlihat terjual ke siapa', /Terjual ke/.test(teksMutasi) && /Pembeli Uji A/.test(teksMutasi));
    // Header tabel memakai CSS uppercase, jadi innerText-nya huruf kapital.
    record('3.2 Kolom pesanan tampil di tabel mutasi', /Pesanan \/ Pembeli/i.test(teksMutasi) && teksMutasi.includes(ORDER_A));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_lacak_sku.png') });
    // Di perangkat baru seeder demo lokal masih membebani halaman, jadi beri
    // waktu lebih longgar untuk ekspor dari halaman ini.
    const [unduhMutasi] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ]);
    const csvMutasi = await bacaUnduhan(unduhMutasi);
    record('3.2 Ekspor mutasi memuat nomor pesanan dan pelanggan',
      /No\. Pesanan/.test(csvMutasi) && /Pelanggan/.test(csvMutasi) && csvMutasi.includes('Pembeli Uji A'));

    // ---------- 3.1 Opname: centang setelah mencari ----------
    await page.goto(BASE + '/stock-opname', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    if ((await page.locator('input[aria-label^="Centang semua"]').count()) === 0) {
      await page.getByRole('button', { name: /Mulai Sesi Baru/i }).click();
      await page.waitForTimeout(800);
      await dialogTeratas().getByRole('button', { name: /^Mulai$/ }).click();
      await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    }
    await page.getByPlaceholder('Cari nama / SKU / barcode').fill(SKU_A);
    await page.waitForTimeout(800);
    const baris = page.locator('tbody tr').filter({ hasText: SKU_A }).first();
    await baris.locator('input[type="checkbox"]').check();
    await page.waitForTimeout(400);
    const sistem = (await baris.locator('td').nth(2).innerText()).replace(/\D/g, '');
    const hitung = await baris.locator('input[type="number"]').inputValue();
    record('3.1 Centang mengisi hitung fisik = stok sistem', hitung !== '' && hitung === sistem, `${hitung} vs ${sistem}`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_opname_centang.png') });

    // ---------- 2.1 Impor dari halaman Produk, 2.2 modal set otomatis ----------
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByRole('button', { name: /Impor Produk/i }).click();
    await page.waitForTimeout(800);
    record('2.1 Tombol impor di halaman Produk membuka modal impor',
      /Impor \/ Ekspor Data Produk/.test(await dialogTeratas().innerText()));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: /Tambah Produk/i }).first().click();
    await page.waitForTimeout(800);
    const form = dialogTeratas();
    const hargaJual = await page.evaluate(() => {
      const l = [...document.querySelectorAll('label')].find((x) => /Harga jual/.test(x.textContent || ''));
      return l?.parentElement?.querySelector('input')?.value ?? null;
    });
    record('2.2 Harga jual produk baru kosong, bukan angka 0', hargaJual === '', JSON.stringify(hargaJual));
    await form.getByRole('button', { name: /Tambah isi set/i }).click();
    await form.getByRole('button', { name: /Tambah isi set/i }).click();
    await page.waitForTimeout(500);
    const cariIsi = () => form.getByPlaceholder(/Cari barang isi set/i);
    await cariIsi().first().click();
    await cariIsi().first().fill(SKU_A);
    await page.waitForTimeout(400);
    await form.locator('button').filter({ hasText: SKU_A }).first().click();
    await cariIsi().last().click();
    await cariIsi().last().fill(SKU_B);
    await page.waitForTimeout(400);
    await form.locator('button').filter({ hasText: SKU_B }).first().click();
    await page.waitForTimeout(600);
    const modalInput = await page.evaluate(() => {
      const l = [...document.querySelectorAll('label')].find((x) => /Harga modal/.test(x.textContent || ''));
      const i = l?.parentElement?.querySelector('input');
      return i ? { value: i.value, disabled: i.disabled } : null;
    });
    const harapan = modal(A) + modal(B);
    record('2.2 Modal set otomatis = jumlah modal isi, tidak bisa diubah manual',
      !!modalInput && modalInput.disabled && Number(modalInput.value) === harapan,
      `${JSON.stringify(modalInput)} vs ${harapan}`);
    const teksForm = await form.innerText();
    record('2.2 Blok stok khusus disembunyikan untuk set',
      /Set tidak punya stok sendiri/.test(teksForm) && !/Stok awal/.test(teksForm));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_form_set.png') });
  } catch (e) {
    record('Skrip berjalan tanpa error', false, e.message.split('\n').slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(SHOT_DIR, 'r99_gagal.png') }).catch(() => {});
  } finally {
    // Kembalikan toko ke setelan semula dan buang data uji.
    sql(`update public.stores set features = features - 'taxInclusive' where id='${S}';`);
    sql(`delete from public.stock_opname_items where opname_id in (select id from public.stock_opnames
          where store_id='${S}' and status='draft' and started_at >= '${T0}');`);
    sql(`delete from public.stock_opnames where store_id='${S}' and status='draft' and started_at >= '${T0}';`);
    sql(`delete from public.orders where order_number like 'UJI99-%';`);
    sql(`delete from public.purchase_items where purchase_id in
          (select id from public.purchases where invoice_number like 'UJI99-PO-%');`);
    sql(`delete from public.purchases where invoice_number like 'UJI99-PO-%';`);
    await browser.close();
    const gagal = results.filter((r) => !r.p).length;
    console.log(`\n${results.length - gagal}/${results.length} lulus`);
    process.exit(gagal ? 1 : 0);
  }
})();
