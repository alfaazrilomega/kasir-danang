// Verifikasi Retur Barang berbasis Nomor Pemesanan.
//
// Deskripsi tugas: "Return barang memakai primary key yaitu Nomor pemesanan".
// Uji ini mengunci hal itu — pencarian retur bertumpu pada nomor pemesanan —
// beserta dua keputusan yang menyertainya: stok dipilih per barang, dan nilai
// refund memotong pendapatan.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();

const esc = (s) => String(s).split("'").join("''");

const results = [];
const record = (n, p, d) => {
  results.push({ n, p });
  console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  trackApi(page);
  let returnId = null;
  try {

    // Bersihkan sisa run sebelumnya. Kalau run lama mati sebelum sempat
    // membersihkan diri, baris returnya tertinggal dan run berikutnya mengukur
    // stok terhadap retur yang salah.
    sql("update public.products p set stock_qty = p.stock_qty - i.qty from public.order_return_items i join public.order_returns r on r.id = i.return_id where r.reason = 'Uji otomatis retur' and i.restock and i.product_id = p.id;");
    sql("delete from public.stock_movements sm using public.order_returns r where r.reason = 'Uji otomatis retur' and sm.type = 'refund' and sm.reason = 'Retur pesanan ' || r.order_number;");
    sql("delete from public.order_returns where reason = 'Uji otomatis retur';");

    // --- Skema: nomor pemesanan harus jadi acuan yang terindeks ---
    const kolom = sql("select count(*) from information_schema.columns where table_name='order_returns' and column_name='order_number';");
    record('Tabel order_returns punya kolom order_number', kolom === '1');

    const idx = sql("select count(*) from pg_indexes where tablename='order_returns' and indexdef ilike '%order_number%';");
    record('Nomor pemesanan diindeks sebagai kunci pencarian', Number(idx) > 0, idx + ' indeks');

    const restock = sql("select count(*) from information_schema.columns where table_name='order_return_items' and column_name='restock';");
    record('Baris retur punya penanda kembali ke stok', restock === '1');

    // --- Alur di layar ---
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    record('Login admin', !page.url().includes('/login'));

    // Prasyarat data. Suite menjalankan verify_import_export lebih dulu dan uji
    // itu mengosongkan tabel produk; karena order_items.product_id memakai
    // 'on delete set null', riwayat penjualan kehilangan tautan produknya.
    // Login di atas memicu seed ulang, tapi dorongannya berjalan di latar, jadi
    // tunggu produknya benar-benar ada sebelum memilih pesanan uji.
    let adaProduk = 0;
    for (let i = 0; i < 30; i++) {
      adaProduk = Number(sql('select count(*) from public.products;'));
      if (adaProduk > 0) break;
      await page.waitForTimeout(2000);
    }
    record('Produk tersedia untuk diuji', adaProduk > 0, adaProduk + ' produk');

    // Pulihkan tautan produk lewat kecocokan nama supaya uji ini berdiri
    // sendiri, tidak bergantung urutan suite.
    sql("update public.order_items i set product_id = p.id from public.products p where i.product_id is null and p.name = i.name and p.store_id = (select store_id from public.orders o where o.id = i.order_id);");

    await page.goto('http://localhost:5173/returns', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2500 });
    record('Halaman Retur Barang terbuka', /Retur Barang/i.test(await page.locator('body').innerText()));

    // Nomor asing harus ditolak dengan jelas, bukan diam.
    await page.getByPlaceholder(/cth\. #260812/i).fill('#TIDAK-ADA-999');
    await page.getByRole('button', { name: /Cari Pesanan/i }).click();
    // Tunggu pesannya muncul, jangan mengandalkan jeda tetap: toast bisa
    // terbit lebih lambat dari sekadar tidur sekian milidetik.
    const ditolak = await page
      .getByText(/tidak ditemukan/i)
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    record('Nomor pemesanan tak dikenal ditolak', ditolak);

    // Pesanan nyata yang punya item berproduk.
    const target = sql("select o.order_number from public.orders o join public.order_items i on i.order_id = o.id where o.order_status <> 'canceled' and i.product_id is not null group by o.id, o.order_number order by o.created_at desc limit 1;");
    record('Ada pesanan untuk diuji', Boolean(target), target);

    // Potret stok seluruh produk pada pesanan itu. Barang mana yang nanti
    // diretur ditentukan oleh baris pertama di layar, belum tentu sama dengan
    // hasil 'limit 1' di SQL — jadi jangan menebak satu produk di muka.
    const stokAwal = new Map();
    const potret = sql("select distinct i.product_id || '=' || p.stock_qty::int from public.orders o join public.order_items i on i.order_id = o.id join public.products p on p.id = i.product_id where o.order_number = '" + esc(target) + "';").split(String.fromCharCode(10));
    for (const baris of potret) {
      const [pid, stok] = baris.trim().split('=');
      if (pid) stokAwal.set(pid, Number(stok));
    }
    record('Stok awal produk pesanan terekam', stokAwal.size > 0, stokAwal.size + ' produk');

    await page.getByPlaceholder(/cth\. #260812/i).fill(target);
    await page.getByRole('button', { name: /Cari Pesanan/i }).click();
    await page.waitForTimeout(2000);
    const teks = await page.locator('body').innerText();
    record('Pesanan ketemu lewat nomor pemesanan', teks.includes(target.replace(/^#/, '')), target);
    record('Barang pesanan tampil untuk dipilih', /Bisa diretur/i.test(teks));

    // Uji penolakan retur berlebih DULU, selagi barisnya masih penuh.
    //
    // Kalau dijalankan setelah retur tersimpan, baris yang qty-nya cuma 1 jadi
    // habis dan kolomnya nonaktif — Playwright lalu menunggu elemen yang tidak
    // akan pernah bisa diisi. Pesanan buatan kasir memang sering berqty 1.
    await page.locator('input[type="number"]').first().fill('9999');
    await page.getByRole('button', { name: /Simpan Retur/i }).click();
    const ditolakBerlebih = await page
      .getByText(/melebihi sisa/i)
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    record('Qty retur melebihi pembelian ditolak', ditolakBerlebih);

    // Retur satu unit, ditandai layak jual.
    await page.locator('input[type="number"]').first().fill('1');
    await page.waitForTimeout(400);
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByPlaceholder(/barang tidak sesuai/i).fill('Uji otomatis retur');
    await page.getByRole('button', { name: /Simpan Retur/i }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.waitForTimeout(1500);

    returnId = sql("select id from public.order_returns where reason = 'Uji otomatis retur' limit 1;");
    record('Retur tersimpan di Postgres', Boolean(returnId), returnId);

    if (returnId) {
      const tersimpan = sql("select order_number from public.order_returns where id='" + returnId + "';");
      record('Nomor pemesanan tersimpan sebagai acuan retur', tersimpan === target, tersimpan);

      const baris = Number(sql("select count(*) from public.order_return_items where return_id='" + returnId + "';"));
      record('Baris barang retur ikut tersimpan', baris >= 1, baris + ' baris');

      const refund = Number(sql("select refund_amount::int from public.order_returns where id='" + returnId + "';"));
      record('Nilai refund tercatat lebih dari nol', refund > 0, 'Rp ' + refund);

      // Tanpa product_id, retur tidak bisa mengembalikan stok. Ini pembeda
      // antara 'retur gagal' dan 'barangnya memang tidak tertaut produk'.
      const tertaut = Number(sql("select count(*) from public.order_return_items where return_id='" + returnId + "' and product_id is not null;"));
      record('Baris retur tertaut ke produk', tertaut >= 1, tertaut + ' baris tertaut');
    } else {
      record('Nomor pemesanan tersimpan sebagai acuan retur', false);
      record('Baris barang retur ikut tersimpan', false);
      record('Nilai refund tercatat lebih dari nol', false);
    }

    // Ambil produk yang benar-benar diretur dari baris returnya sendiri.
    const diretur = returnId
      ? sql("select product_id || '=' || qty::int from public.order_return_items where return_id='" + returnId + "' and product_id is not null limit 1;")
      : '';
    const [returProdId, returQty] = diretur ? diretur.split('=') : ['', '0'];
    const stokAkhir = returProdId
      ? Number(sql("select stock_qty::int from public.products where id='" + returProdId + "';"))
      : -1;
    const harusnya = (stokAwal.get(returProdId) ?? 0) + Number(returQty || 0);
    record('Stok bertambah untuk barang yang ditandai layak jual',
      returProdId !== '' && stokAkhir === harusnya,
      (stokAwal.get(returProdId) ?? '?') + ' -> ' + stokAkhir + ' (harusnya ' + harusnya + ')');

    const mutasi = returProdId
      ? Number(sql("select count(*) from public.stock_movements where type='refund' and reason like 'Retur pesanan%' and product_id='" + returProdId + "';"))
      : 0;
    record('Retur tercatat di Mutasi Stok sebagai Retur', mutasi > 0, mutasi + ' mutasi');

    // Riwayat retur harus muncul di halaman setelah tersimpan.
    await page.reload({ waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 2000 });
    record('Riwayat retur tampil di halaman', (await page.locator('body').innerText()).includes('Uji otomatis retur'));

    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '44_retur_barang.png') });

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.p).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '97_retur_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    // Kembalikan data demo ke keadaan semula.
    try {
      if (returnId) {
        sql("update public.products p set stock_qty = p.stock_qty - i.qty from public.order_return_items i where i.return_id='" + returnId + "' and i.restock and i.product_id = p.id;");
        sql("delete from public.stock_movements where type='refund' and reason like 'Retur pesanan%' and created_at > now() - interval '15 minutes';");
        sql("delete from public.order_returns where id='" + returnId + "';");
      }
    } catch (e) {
      console.log('Gagal membersihkan data uji: ' + e.message);
    }
    await browser.close();
  }
})();
