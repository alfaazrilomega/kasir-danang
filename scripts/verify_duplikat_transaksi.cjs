// Verifikasi butir 14d PERMINTAAN-CLIENT.md: duplikat penjualan di Riwayat
// Transaksi.
//
// Kutipan client (video B, 28 Sep): "disamaan kayak produk … kalau untuk di
// produk kan bisa duplikat … Atau mulai dari checklist ini … Ataupun dari si
// sebelah sini … Ketika kondisinya casenya sudah lumayan tinggi. Jadi kan
// nggak buat satu-satu … saya tinggal duplikat si penjualannya".
//
// Yang diuji:
//   - Ikon aksi baris "Duplikat penjualan" membawa isi pesanan ke kasir:
//     barang, jumlah, harga per baris, pelanggan, channel, tempo, dan pilihan
//     pajak. Pesanan asal tidak berubah.
//   - Menyimpan di kasir membuat pesanan BARU bernomor lain dengan isi sama.
//   - Barang yang sudah tidak dijual dilewati dan disebutkan, bukan diam-diam.
//   - Barang yang stoknya kurang dari jumlah pesanan asal tetap dibawa, dengan
//     peringatan yang menyebut SKU, stok, dan jumlah pesanan asal.
//   - Promo dan diskon pesanan asal tidak disalin, dan kasir diberi tahu.
//   - Pesanan tempo yang di-park lalu di-resume tetap membawa tanggal jatuh tempo.
//   - Jatuh tempo salinan dihitung dari tanggal lokal (WIB), bukan UTC: salinan
//     yang dibuat sebelum pukul 07.00 tidak boleh meleset sehari.
//   - Bilah centang menawarkan Duplikat saat tepat satu pesanan dipilih.
//   - Detail pesanan punya tombol Duplikat.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, ADMIN_PASSWORD, DB_PASSWORD, BASE_URL } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const TAG = 'UJIDUP' + Date.now().toString().slice(-6);
const ASAL = 'ORDER ' + TAG;
const BARU = TAG + '-SALINAN';
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined ? ' — ' + ket : ''));
};

(async () => {
  const STORE = psql('select id from public.stores order by created_at limit 1;');
  const [P1, P2, P3, CUST, ORDER] = Array.from({ length: 5 }, () => psql('select gen_random_uuid();'));
  const tarifAwal = psql(`select tax_rate from public.stores where id = '${STORE}';`);
  psql(`update public.stores set tax_rate = 10 where id = '${STORE}';`);
  psql(`insert into public.products (id, store_id, name, sku, base_price, cost_price, stock_qty, track_stock, is_active) values
    ('${P1}', '${STORE}', 'Gear Honda Crf150 Red ${TAG}', 'C1-${TAG}', 700000, 400000, 100, true, true),
    ('${P2}', '${STORE}', 'Gear Kawasaki Klx150 Blue ${TAG}', 'C2-${TAG}', 700000, 400000, 3, true, true),
    ('${P3}', '${STORE}', 'Gear lama tidak dijual ${TAG}', 'C3-${TAG}', 500000, 300000, 100, true, false);`);
  psql(`insert into public.customers (id, store_id, name, phone, joined_date, is_active, points, created_at)
        values ('${CUST}', '${STORE}', 'Aldo Garage ${TAG}', '0800${TAG.slice(-6)}', current_date, true, 0, now());`);
  // Pesanan asal: harga baris ditimpa manual (655.000, bukan 700.000), tempo 60 hari, pajak 10%.
  psql(`insert into public.orders (id, store_id, customer_id, order_number, subtotal, tax, discount, total, payment_method,
          payment_status, order_status, order_type, sales_channel, payment_term, due_date, tax_inclusive, promo_code, created_at)
        values ('${ORDER}', '${STORE}', '${CUST}', '${ASAL}', 13600000, 1350000, 100000, 14850000, 'cash',
          'unpaid', 'done', 'take_away', 'offline', 'tempo', current_date + 60, false, 'UJIPROMO', now() - interval '1 hour');`);
  psql(`insert into public.order_items (id, order_id, product_id, name, size, qty, price, cost_price, note) values
    (gen_random_uuid(), '${ORDER}', '${P1}', 'Gear Honda Crf150 Red ${TAG}', null, 10, 655000, 400000, null),
    (gen_random_uuid(), '${ORDER}', '${P2}', 'Gear Kawasaki Klx150 Blue ${TAG}', null, 10, 655000, 400000, 'warna biru'),
    (gen_random_uuid(), '${ORDER}', '${P3}', 'Gear lama tidak dijual ${TAG}', null, 1, 50000, 30000, null);`);

  // Dua pesanan tempo 60 hari untuk uji tanggal lokal. Tanggal dihitung dalam
  // WIB secara eksplisit supaya suite tidak bergantung pada jam mesin.
  const HARI = 86400000;
  const wibHariIni = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const geser = (iso, hari) => new Date(Date.parse(iso) + hari * HARI).toISOString().slice(0, 10);
  const tglBuat = geser(wibHariIni, -2);
  // Nomornya sengaja tidak memuat nomor pesanan asal, supaya pencarian baris asal tidak ikut mengenainya.
  const SIANG = 'TEMPO SIANG ' + TAG;
  const MALAM = 'TEMPO MALAM ' + TAG;
  for (const [nomor, dibuatUtc] of [
    [SIANG, tglBuat + 'T03:00:00Z'],              // 10.00 WIB
    [MALAM, geser(tglBuat, -1) + 'T18:30:00Z'],   // 01.30 WIB, tanggal UTC-nya sehari sebelumnya
  ]) {
    const id = psql('select gen_random_uuid();');
    psql(`insert into public.orders (id, store_id, customer_id, order_number, subtotal, tax, discount, total, payment_method,
            payment_status, order_status, order_type, sales_channel, payment_term, due_date, tax_inclusive, created_at)
          values ('${id}', '${STORE}', '${CUST}', '${nomor}', 655000, 0, 0, 655000, 'cash',
            'unpaid', 'done', 'take_away', 'offline', 'tempo', '${geser(tglBuat, 60)}', false, '${dibuatUtc}');`);
    psql(`insert into public.order_items (id, order_id, product_id, name, size, qty, price, cost_price, note)
          values (gen_random_uuid(), '${id}', '${P1}', 'Gear Honda Crf150 Red ${TAG}', null, 1, 655000, 400000, null);`);
  }

  // Produk set: tidak punya stok dan modal sendiri, keduanya dihitung dari isinya
  // (2 x produk P1 bermodal 400.000). Dipakai untuk menguji Duplikat pada set.
  const PSET = psql('select gen_random_uuid();');
  const ORDER_SET = psql('select gen_random_uuid();');
  const NOMOR_SET = 'PAKET ' + TAG;
  const SALINAN_SET = TAG + '-PAKETSALIN';
  psql(`insert into public.products (id, store_id, name, sku, base_price, cost_price, stock_qty, track_stock, is_active)
        values ('${PSET}', '${STORE}', 'Paket Gear Set ${TAG}', 'SET-${TAG}', 900000, 0, 0, true, true);`);
  psql(`insert into public.product_components (store_id, parent_product_id, component_product_id, qty) values ('${STORE}', '${PSET}', '${P1}', 2);`);
  psql(`insert into public.orders (id, store_id, order_number, subtotal, tax, discount, total, payment_method,
          payment_status, order_status, order_type, sales_channel, payment_term, tax_inclusive, created_at)
        values ('${ORDER_SET}', '${STORE}', '${NOMOR_SET}', 1800000, 0, 0, 1800000, 'cash', 'paid', 'done', 'take_away', 'offline', 'cash', false, now() - interval '50 minutes');`);
  psql(`insert into public.order_items (id, order_id, product_id, name, size, qty, price, cost_price, note)
        values (gen_random_uuid(), '${ORDER_SET}', '${PSET}', 'Paket Gear Set ${TAG}', null, 2, 900000, 800000, null);`);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const toasts = [];
  async function bukaRiwayat() {
    await page.goto(BASE_URL + '/orders', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByPlaceholder(/Cari ID/i).first().fill(TAG);
    await page.waitForTimeout(1200);
  }
  const barisAsal = () => page.locator('tbody tr').filter({ hasText: ASAL }).first();
  async function isiKeranjang() {
    // Baris keranjang dibaca dari panel pesanan: nama, jumlah, harga satuan.
    // Hanya panel pesanan kasir; tanpa panel (bukan di /menu) hasilnya kosong,
    // supaya nama pelanggan di tabel Riwayat tidak ikut terbaca.
    return page.evaluate(() => {
      const panel = document.querySelector('#input-order-id')?.closest('.card');
      return panel ? panel.innerText : '';
    });
  }

  try {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.goto(BASE_URL + '/menu', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });

    // ---------- 1. Ikon aksi baris ----------
    await bukaRiwayat();
    const ikon = barisAsal().getByTitle(/Duplikat penjualan/i);
    record('Baris pesanan punya ikon "Duplikat penjualan"', (await ikon.count()) === 1);
    if (await ikon.count()) {
      page.on('console', () => {});
      await ikon.click();
      // Notifikasi dibaca segera: umurnya hanya beberapa detik, lebih pendek
      // dari waktu menunggu kasir selesai memuat.
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('[data-sonner-toast]')).some((t) => /disalin ke kasir|tidak dijual\.|tidak ditemukan/.test(t.textContent || '')),
        null, { timeout: 20000 },
      ).catch(() => {});
      await page.waitForTimeout(400);
      toasts.push(...(await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])));
      await page.waitForURL((u) => u.pathname === '/menu', { timeout: 15000 }).catch(() => {});
      await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 1500 });
    }
    record('Duplikat membuka kasir', new URL(page.url()).pathname === '/menu', page.url());
    const keranjang = await isiKeranjang();
    record('Keranjang berisi dua barang yang masih dijual',
      keranjang.includes('Gear Honda Crf150 Red ' + TAG) && keranjang.includes('Gear Kawasaki Klx150 Blue ' + TAG));
    record('Barang yang sudah tidak dijual tidak ikut masuk',
      keranjang.includes('Gear Honda Crf150 Red ' + TAG) && !keranjang.includes('Gear lama tidak dijual ' + TAG));
    record('Notifikasi menyebut 1 barang dilewati beserta namanya',
      toasts.some((t) => /1 barang dilewati/i.test(t) && t.includes('Gear lama tidak dijual ' + TAG)), toasts.join(' | ').slice(0, 200));
    // Gear Kawasaki stoknya 3, pesanan asal 10: barangnya tetap dibawa, tapi kasir diberi tahu.
    record('Peringatan stok menyebut SKU, stok, dan jumlah pesanan asal',
      toasts.some((t) => /1 barang stoknya kurang/i.test(t) && t.includes('C2-' + TAG) && /stok 3, pesanan 10/.test(t)), toasts.join(' | ').slice(0, 320));
    // Promo dan diskon pesanan asal tidak ikut disalin; kasir harus diberi tahu
    // karena total pesanan baru jadi lebih tinggi.
    record('Peringatan menyebut promo dan diskon pesanan asal yang tidak ikut disalin',
      toasts.some((t) => t.includes('UJIPROMO') && /Rp\s?100\.000/.test(t.replace(/\u00a0/g, ' ')) && /tidak ikut disalin/i.test(t)), toasts.join(' | ').slice(0, 420));
    // Tiga catatan itu harus berada di SATU pemberitahuan. Sebagai pemberitahuan
    // terpisah mereka bertumpuk, dan yang di belakang hanya terbaca seperempat
    // detik sebelum tertutup (temuan QC: pesan "barang dilewati" tidak pernah terlihat).
    const satuToast = toasts.filter((t) => /1 barang dilewati/i.test(t) && /1 barang stoknya kurang/i.test(t) && /tidak ikut disalin/i.test(t));
    record('Barang dilewati, stok kurang, dan promo disebut dalam satu pemberitahuan, tidak bertumpuk',
      toasts.length === 1 && satuToast.length === 1, `${toasts.length} pemberitahuan, ${satuToast.length} memuat ketiganya`);
    const hargaBaris = await page.locator('#input-order-id').locator('xpath=ancestor::div[contains(@class,"card")][1]')
      .locator('input[type="number"]').evaluateAll((els) => els.map((e) => e.value));
    record('Harga satuan baris ikut harga pesanan asal (655000), bukan harga master',
      hargaBaris.filter((v) => v === '655000').length === 2, hargaBaris.join(','));
    record('Pelanggan ikut tersalin', keranjang.includes('Aldo Garage ' + TAG));
    record('Pembayaran tempo ikut tersalin', await page.getByText(/Jatuh tempo/i).first().isVisible().catch(() => false));
    record('Centang pajak ikut pesanan asal (berpajak)', await page.locator('#cek-pajak').isChecked().catch(() => false));

    // Park lalu Resume: dulu tanggal jatuh tempo dikosongkan, dan Place Order
    // menolak pesanan tempo tanpa tanggal.
    const tempoPanel = () => page.locator('#input-order-id').locator('xpath=ancestor::div[contains(@class,"card")][1]').locator('input[type="date"]');
    const tempoSebelum = await tempoPanel().first().inputValue().catch(() => '');
    await page.locator('#btn-park-order').click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /parked/i }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Resume/i }).first().click();
    await page.waitForTimeout(1000);
    const tempoSesudah = await tempoPanel().first().inputValue().catch(() => '');
    record('Park lalu Resume: tanggal jatuh tempo tetap terisi', !!tempoSebelum && tempoSesudah === tempoSebelum, `${tempoSebelum} -> ${tempoSesudah || '(kosong)'}`);

    // ---------- 2. Simpan sebagai pesanan baru ----------
    await page.locator('#input-order-id').fill(BARU);
    await page.locator('#btn-place-order').click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500, timeoutMs: 120000 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape').catch(() => {});
    const baru = psql(`select o.customer_id || '|' || o.payment_term || '|' || (o.tax > 0)::text || '|' ||
                         string_agg(i.product_id || ':' || i.qty::int || ':' || i.price::int, ',' order by i.name)
                       from public.orders o join public.order_items i on i.order_id = o.id
                      where o.order_number = '${BARU}' group by o.id;`);
    record('Pesanan baru tersimpan dengan isi, pelanggan, tempo, dan pajak yang sama',
      baru === `${CUST}|tempo|true|${P1}:10:655000,${P2}:10:655000`, baru || '(tidak tersimpan)');
    const asal = psql(`select count(*) from public.order_items where order_id = '${ORDER}';`);
    record('Pesanan asal tidak berubah (tetap 3 baris)', asal === '3', asal);

    // ---------- 3. Bilah centang ----------
    await bukaRiwayat();
    await barisAsal().locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(500);
    const tombolBilah = page.getByRole('button', { name: /^Duplikat$/ }).first();
    record('Bilah centang menawarkan Duplikat untuk satu pesanan', await tombolBilah.isVisible().catch(() => false));
    const barisBaru = page.locator('tbody tr').filter({ hasText: BARU }).first();
    if (await barisBaru.count()) {
      await barisBaru.locator('input[type="checkbox"]').first().check();
      await page.waitForTimeout(500);
      record('Dua pesanan dipilih: Duplikat tidak ditawarkan', !(await tombolBilah.isVisible().catch(() => false)));
    } else {
      record('Dua pesanan dipilih: Duplikat tidak ditawarkan', false, 'pesanan salinan tidak tampil');
    }

    // ---------- 4. Detail pesanan ----------
    await bukaRiwayat();
    await barisAsal().getByTitle('Detail').click();
    await page.waitForTimeout(1000);
    const modal = page.locator('div.fixed.inset-0').last();
    record('Detail pesanan punya tombol Duplikat', (await modal.getByRole('button', { name: /Duplikat/i }).count()) >= 1);

    // ---------- 5. Kasir di perangkat baru ----------
    // Admin mendapat katalog dari Dashboard. Kasir langsung mendarat di POS,
    // dan dulu POS tidak menarik katalog sendiri: di perangkat baru isinya
    // "0 Item" dan duplikat menyimpulkan semua barang sudah tidak dijual.
    const ctxKasir = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const kasir = await ctxKasir.newPage();
    trackApi(kasir);
    kasir.on('dialog', (d) => d.accept().catch(() => {}));
    await kasir.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await kasir.fill('input[type="email"]', 'kasir@example.com');
    await kasir.fill('input[type="password"]', 'kasir12345');
    await kasir.click('button[type="submit"]');
    await kasir.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await kasir.locator('.card').filter({ hasText: /Add to Cart/i }).first().waitFor({ timeout: 30000 }).catch(() => {});
    const kartuKasir = await kasir.locator('.card').filter({ hasText: /Add to Cart/i }).count();
    record('Kasir di perangkat baru: POS langsung berisi produk', new URL(kasir.url()).pathname === '/menu' && kartuKasir > 0,
      `${new URL(kasir.url()).pathname}, ${kartuKasir} kartu produk`);

    // Katalog lokal dikosongkan untuk meniru perangkat yang belum memuatnya,
    // lalu pindah ke Riwayat lewat menu (tanpa muat ulang halaman).
    await waitForApiIdle(kasir, { idleMs: 2500, minWaitMs: 2000 });
    await kasir.evaluate(() => new Promise((selesai) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = () => {
        const tx = req.result.transaction('products', 'readwrite');
        tx.objectStore('products').clear();
        tx.oncomplete = () => { req.result.close(); selesai(true); };
      };
    }));
    await kasir.getByRole('link', { name: /^Orders$/ }).first().click();
    await kasir.waitForURL((u) => u.pathname === '/orders', { timeout: 15000 }).catch(() => {});
    await waitForApiIdle(kasir, { idleMs: 2500, minWaitMs: 2000 });
    await kasir.getByPlaceholder(/Cari ID/i).first().fill(TAG);
    await kasir.waitForTimeout(1200);
    await kasir.locator('tbody tr').filter({ hasText: ASAL }).first().getByTitle(/Duplikat penjualan/i).click();
    await kasir.waitForURL((u) => u.pathname === '/menu', { timeout: 20000 }).catch(() => {});
    await kasir.waitForTimeout(1500);
    const panelKasir = await kasir.evaluate(() => {
      const panel = document.querySelector('#input-order-id')?.closest('.card');
      return panel ? panel.innerText : '';
    });
    record('Kasir tanpa katalog lokal: duplikat menarik katalog dulu, barang tetap terbawa',
      panelKasir.includes('Gear Honda Crf150 Red ' + TAG) && panelKasir.includes('Gear Kawasaki Klx150 Blue ' + TAG),
      new URL(kasir.url()).pathname + ' | ' + panelKasir.replace(/\s+/g, ' ').slice(0, 120));
    await kasir.locator('#btn-cancel-order').click().catch(() => {});
    await ctxKasir.close();

    // ---------- 6. Jatuh tempo salinan memakai tanggal lokal ----------
    // Zona waktu peramban dikunci ke WIB dan jamnya dibekukan, supaya dua tepi
    // hari teruji: salinan dibuat dini hari, dan pesanan asal dibuat dini hari.
    const ctxWib = await browser.newContext({ viewport: { width: 1500, height: 1000 }, timezoneId: 'Asia/Jakarta' });
    const wib = await ctxWib.newPage();
    trackApi(wib);
    wib.on('dialog', (d) => d.accept().catch(() => {}));
    await wib.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await wib.fill('input[type="email"]', 'admin@example.com');
    await wib.fill('input[type="password"]', ADMIN_PASSWORD);
    await wib.click('button[type="submit"]');
    await wib.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(wib, { idleMs: 3500, minWaitMs: 3000 });
    const jatuhTempoSalinan = async (nomor, jamBekuUtc) => {
      await wib.goto(BASE_URL + '/orders', { waitUntil: 'domcontentloaded' });
      await waitForApiIdle(wib, { idleMs: 3000, minWaitMs: 2500 });
      await wib.getByPlaceholder(/Cari ID/i).first().fill(nomor);
      await wib.waitForTimeout(1200);
      await wib.clock.setFixedTime(new Date(jamBekuUtc));
      await wib.locator('tbody tr').filter({ hasText: nomor }).first().getByTitle(/Duplikat penjualan/i).click();
      await wib.waitForURL((u) => u.pathname === '/menu', { timeout: 20000 }).catch(() => {});
      await wib.waitForTimeout(1200);
      const nilai = await wib.locator('#input-order-id').locator('xpath=ancestor::div[contains(@class,"card")][1]')
        .locator('input[type="date"]').first().inputValue().catch(() => '');
      pajakSalinanTanpaPajak = await wib.locator('#cek-pajak').isChecked().catch(() => 'tak ada');
      await wib.locator('#btn-cancel-order').click().catch(() => {});
      await wib.waitForTimeout(400);
      return nilai;
    };
    let pajakSalinanTanpaPajak = null;
    const harapan = geser(wibHariIni, 60);
    // Salinan dibuat pukul 01.30 WIB: tanggal UTC-nya masih kemarin.
    const tempoDiniHari = await jatuhTempoSalinan(SIANG, geser(wibHariIni, -1) + 'T18:30:00Z');
    record('Salinan dibuat pukul 01.30 WIB: jatuh tempo 60 hari dari tanggal lokal', tempoDiniHari === harapan,
      `${tempoDiniHari || '(kosong)'}, seharusnya ${harapan}`);
    // Pesanan asal dibuat pukul 01.30 WIB: lama temponya tetap 60 hari, bukan 61.
    const tempoAsalDiniHari = await jatuhTempoSalinan(MALAM, wibHariIni + 'T03:00:00Z');
    record('Pesanan asal dibuat pukul 01.30 WIB: lama tempo tetap 60 hari', tempoAsalDiniHari === harapan,
      `${tempoAsalDiniHari || '(kosong)'}, seharusnya ${harapan}`);
    // Pesanan asal tanpa pajak, toko bertarif 10% dengan bawaan tercentang:
    // salinannya harus TANPA centang. Pesanan asal berpajak tidak membuktikan
    // apa-apa, karena bawaan toko memang sudah tercentang.
    record('Pesanan asal tanpa pajak: salinannya tidak mencentang pajak walau bawaan toko tercentang',
      pajakSalinanTanpaPajak === false, 'centang=' + pajakSalinanTanpaPajak);

    // ---------- 7. Produk set ----------
    // Set tidak punya stok dan modal sendiri. Kasir menghitung keduanya dari
    // isinya; Duplikat harus sama, kalau tidak peringatan stoknya palsu dan
    // modal salinannya nol.
    await wib.clock.setFixedTime(new Date());
    await wib.goto(BASE_URL + '/orders', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(wib, { idleMs: 3000, minWaitMs: 2500 });
    await wib.getByPlaceholder(/Cari ID/i).first().fill(NOMOR_SET);
    await wib.waitForTimeout(1200);
    await wib.locator('tbody tr').filter({ hasText: NOMOR_SET }).first().getByTitle(/Duplikat penjualan/i).click();
    await wib.waitForURL((u) => u.pathname === '/menu', { timeout: 20000 }).catch(() => {});
    await wib.waitForTimeout(1500);
    const toastSet = (await wib.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
    const panelSet = await wib.evaluate(() => document.querySelector('#input-order-id')?.closest('.card')?.innerText || '');
    record('Set yang isinya cukup: Duplikat tidak memberi peringatan stok kurang',
      panelSet.includes('Paket Gear Set ' + TAG) && !/stoknya kurang/i.test(toastSet), toastSet.slice(0, 160) || '(tanpa peringatan)');
    await wib.locator('#input-order-id').fill(SALINAN_SET);
    await wib.locator('#btn-place-order').click();
    await wib.waitForTimeout(1200);
    const toastSimpanSet = (await wib.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
    // Pesanan disimpan lewat antrean lokal. Kalau sinkronisasi lain sedang
    // berjalan, antrean baru dikirim di putaran berikutnya, jadi database
    // ditunggu sampai barisnya ada, bukan dibaca seketika.
    const bacaModal = () => psql(`select coalesce(string_agg(i.cost_price::int::text, ','), '') from public.order_items i join public.orders o on o.id = i.order_id where o.order_number = '${SALINAN_SET}';`);
    let modalSalinan = '';
    for (let i = 0; i < 45 && !modalSalinan; i += 1) {
      await wib.waitForTimeout(1000);
      modalSalinan = bacaModal();
    }
    const antreanLokal = modalSalinan ? 0 : await wib.evaluate(async () => {
      const dbx = await new Promise((res, rej) => { const r = indexedDB.open('kasir'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      return new Promise((res) => { const t = dbx.transaction('pending').objectStore('pending').count(); t.onsuccess = () => res(t.result); t.onerror = () => res(-1); });
    }).catch(() => -1);
    record('Salinan set memakai modal isinya saat ini (2 x 400.000), bukan modal tersimpan produk setnya',
      modalSalinan === '800000', modalSalinan || `(tidak tersimpan dalam 45 detik; antrean lokal ${antreanLokal}; pemberitahuan: ${toastSimpanSet.slice(0, 160) || 'tidak ada'})`);
    await ctxWib.close();

    console.log('');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + String(e.message || e).slice(0, 300));
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + Math.max(hasil.length, 25) + ' lolos');
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`update public.products p set stock_qty = p.stock_qty + s.q
              from (select i.product_id, sum(i.qty) as q from public.order_items i join public.orders o on o.id = i.order_id
                     where o.order_number = '${BARU}' and i.product_id is not null group by i.product_id) s
             where p.id = s.product_id and p.track_stock;`);
      psql(`delete from public.stock_movements m using public.orders o where o.id = m.ref_order_id and o.order_number in ('${ASAL}', '${BARU}', 'TEMPO SIANG ${TAG}', 'TEMPO MALAM ${TAG}', '${NOMOR_SET}', '${SALINAN_SET}');`);
      psql(`delete from public.order_items i using public.orders o where o.id = i.order_id and o.order_number in ('${ASAL}', '${BARU}', 'TEMPO SIANG ${TAG}', 'TEMPO MALAM ${TAG}', '${NOMOR_SET}', '${SALINAN_SET}');`);
      psql(`delete from public.orders where order_number in ('${ASAL}', '${BARU}', 'TEMPO SIANG ${TAG}', 'TEMPO MALAM ${TAG}', '${NOMOR_SET}', '${SALINAN_SET}');`);
      psql(`delete from public.product_components where parent_product_id = '${PSET}';`);
      psql(`delete from public.stock_movements where product_id in ('${P1}','${P2}','${P3}','${PSET}');`);
      psql(`delete from public.products where id in ('${P1}','${P2}','${P3}','${PSET}');`);
      psql(`update public.stores set tax_rate = ${Number(tarifAwal) || 0} where id = '${STORE}';`);
      psql(`delete from public.customers where id = '${CUST}';`);
    } catch (e) {
      console.log('Pembersihan gagal: ' + String(e.message || e).slice(0, 200));
    }
  }
})();
