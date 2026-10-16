// Uji butir client 2.1, 2.2, dan 4.6.
//
//   2.1 Impor produk massal membawa foto dari URL.
//   2.2 Produk set: gabungan barang satuan, stoknya ikut satuan.
//   4.6 Penjualan set memotong stok isinya, bukan stok set.

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

const CAP = Date.now().toString().slice(-6);
const SKU_A = 'UJISET-A-' + CAP;   // isi set, dipakai 1x per set
const SKU_B = 'UJISET-B-' + CAP;   // isi set, dipakai 2x per set
const SKU_SET = 'UJISET-S-' + CAP; // produknya sendiri
const FOTO = 'https://contoh.gnnkracing.id/foto/uji-' + CAP + '.jpg';
const STOK_A = 10;
const STOK_B = 30;

const psql = (q, boleh = false) => {
  try {
    return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
      ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
      { env: { ...process.env, PGPASSWORD: DB_PW }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (boleh) return 'GAGAL: ' + String(e.stderr || e.message).trim();
    throw e;
  }
};

const stokDari = (sku) => Number(psql(
  `select coalesce(stock_qty,0)::bigint from public.products where sku = '${sku}';`));

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-set-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
  const page = await ctx.newPage();
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

    // ================= 2.1 impor produk + foto dari URL =================
    const NL = String.fromCharCode(13, 10);
    const berkas = path.join(tmp, 'produk.csv');
    const header = 'sep=;' + NL +
      'sku;barcode;nama_produk;kategori;deskripsi;url_foto;harga_jual;harga_modal;stok;' +
      'stok_minimum;lacak_stok;aktif;sku_shopee;sku_tiktok;sku_tokopedia;sku_website';
    const baris = [
      `${SKU_A};;Gear Depan Uji;Gear & Rantai;;${FOTO};175000;120000;${STOK_A};2;ya;ya;;;;`,
      `${SKU_B};;Rantai Uji;Gear & Rantai;;;125000;82000;${STOK_B};5;ya;ya;;;;`,
      `${SKU_SET};;Gear Set Uji;Gear & Rantai;;;450000;320000;0;0;tidak;ya;;;;`,
    ];
    fs.writeFileSync(berkas, [header, ...baris].join(NL), 'utf8');

    // Impor produk ada di Store Settings, bukan di halaman Produk.
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Impor \/ Ekspor Data/i }).first().click();
    await page.waitForTimeout(1500);
    // Modalnya bertanya dulu mau impor atau ekspor.
    await page.getByText('Impor dari berkas').first().click();
    await page.waitForTimeout(1200);
    // Mode bawaan "Ganti total" akan menghapus seluruh katalog. Uji ini hanya
    // menambah tiga produk, jadi pindah dulu ke mode gabung per SKU.
    await page.getByRole('button', { name: /Gabung per SKU/i }).click();
    await page.waitForTimeout(900);
    await page.locator('input[type="file"]').first().setInputFiles(berkas);
    await page.waitForTimeout(4000);

    const teksImpor = await page.locator('body').innerText();
    record('Berkas produk terbaca', /3/.test(teksImpor),
      (/(\d+) produk/i.exec(teksImpor) || ['-'])[0]);
    await page.getByRole('button', { name: /Jalankan Impor/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 180000 });
    await page.waitForTimeout(2000);

    const fotoDb = psql(`select coalesce(image_url,'(kosong)') from public.products where sku = '${SKU_A}';`);
    record('Foto dari URL ikut tersimpan', fotoDb === FOTO, fotoDb.slice(0, 46));
    record('Ketiga produk masuk', psql(
      `select count(*) from public.products where sku in ('${SKU_A}','${SKU_B}','${SKU_SET}');`) === '3');

    // ================= 2.2 susun isi set =================
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.locator('main input[type="text"], input[placeholder*="Cari"]')
      .last().fill(SKU_SET);
    await page.waitForTimeout(2000);
    // Baris produk kini juga punya ikon riwayat & label, jadi tombol Edit dipilih lewat judulnya.
    // Baris teratas bisa berupa baris induk kelompok varian yang tanpa tombol Edit.
    await page.locator('tbody tr')
      .filter({ has: page.locator('button[title="Edit"]') })
      .first()
      .locator('button[title="Edit"]')
      .click();
    await page.waitForTimeout(2000);

    const form = modal();
    record('Bagian Produk Set ada di editor produk',
      /Produk Set/i.test(await form.innerText()));

    await form.getByRole('button', { name: /Tambah isi set/i }).click();
    await page.waitForTimeout(700);
    await form.getByRole('button', { name: /Tambah isi set/i }).click();
    await page.waitForTimeout(700);

    // Isi set dipilih lewat kolom cari (nama/SKU), bukan dropdown biasa.
    // Setelah terpilih, placeholder berganti jadi nama produknya, jadi kolom
    // yang masih kosong selalu yang terakhir cocok dengan placeholder ini.
    const cariIsi = () => form.getByPlaceholder(/Cari barang isi set/i);
    await cariIsi().first().click();
    await cariIsi().first().fill(SKU_A);
    await page.waitForTimeout(500);
    await form.locator('button').filter({ hasText: SKU_A }).first().click();
    await page.waitForTimeout(600);
    await cariIsi().last().click();
    await cariIsi().last().fill(SKU_B);
    await page.waitForTimeout(500);
    await form.locator('button').filter({ hasText: SKU_B }).first().click();
    await page.waitForTimeout(600);

    // Takaran isi kedua: 2 batang per set.
    const kolomTakaran = form.locator('input[type="number"].w-20');
    await kolomTakaran.last().fill('2');
    await page.waitForTimeout(800);

    const teksSet = await form.innerText();
    const bisaDirakit = /Bisa dirakit:\s*(\d+)/.exec(teksSet);
    // Stok A 10 (1 per set) dan B 30 (2 per set) -> paling sedikit 10.
    record('Jumlah set yang bisa dirakit dihitung dari isinya',
      bisaDirakit && Number(bisaDirakit[1]) === 10, bisaDirakit ? bisaDirakit[1] + ' set' : '-');

    await form.getByRole('button', { name: /^Simpan$/i }).first().click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    const jumlahIsi = psql(
      `select count(*) from public.product_components c
         join public.products p on p.id = c.parent_product_id
        where p.sku = '${SKU_SET}';`);
    record('Isi set tersimpan', jumlahIsi === '2', jumlahIsi + ' isi');

    // Aturan satu tingkat ditegakkan database, bukan cuma disembunyikan layar.
    const idSet = psql(`select id from public.products where sku = '${SKU_SET}';`);
    const idA = psql(`select id from public.products where sku = '${SKU_A}';`);
    const storeId = psql('select id from public.stores limit 1;');
    const tolakBertingkat = psql(
      `insert into public.product_components(store_id, parent_product_id, component_product_id, qty)
       values ('${storeId}', '${idA}', '${idSet}', 1);`, true);
    record('Set di dalam set ditolak database',
      tolakBertingkat.startsWith('GAGAL'),
      tolakBertingkat.startsWith('GAGAL') ? 'ditolak' : 'LOLOS TANPA PENOLAKAN');

    // ================= 4.6 jual set, stok isinya berkurang =================
    const aSebelum = stokDari(SKU_A);
    const bSebelum = stokDari(SKU_B);

    await page.goto(BASE + '/menu', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.getByPlaceholder(/Cari menu/i).first().fill(SKU_SET);
    await page.waitForTimeout(2000);

    const kartu = page.locator('.card').filter({ hasText: /Gear Set Uji/ }).first();
    record('Set tampil di POS dengan jumlah siap rakit',
      /Set siap 10/.test(await kartu.innerText().catch(() => '')),
      (/Set siap \d+/.exec(await kartu.innerText().catch(() => '')) || ['-'])[0]);

    await kartu.getByRole('button', { name: /Add to Cart/i }).click();
    await page.waitForTimeout(1500);
    await page.locator('#btn-place-order').click();
    await waitForApiIdle(page, { idleMs: 4500, minWaitMs: 3500, timeoutMs: 180000 });
    await page.waitForTimeout(2500);

    const aSesudah = stokDari(SKU_A);
    const bSesudah = stokDari(SKU_B);
    record('Stok isi pertama berkurang 1', aSebelum - aSesudah === 1, `${aSebelum} -> ${aSesudah}`);
    record('Stok isi kedua berkurang 2 sesuai takarannya',
      bSebelum - bSesudah === 2, `${bSebelum} -> ${bSesudah}`);
    record('Stok set sendiri tidak dipakai', stokDari(SKU_SET) === 0, String(stokDari(SKU_SET)));

    const mutasi = psql(
      `select count(*) from public.stock_movements m
         join public.products p on p.id = m.product_id
        where p.sku in ('${SKU_A}','${SKU_B}') and m.reason = 'POS sale (isi set)';`);
    record('Mutasi stok mencatat asalnya dari penjualan set', Number(mutasi) >= 2, mutasi + ' baris');

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
      psql(`delete from public.stock_movements m using public.products p
              where p.id = m.product_id and p.sku in ('${SKU_A}','${SKU_B}','${SKU_SET}');
            delete from public.order_items i using public.products p
              where p.id = i.product_id and p.sku in ('${SKU_A}','${SKU_B}','${SKU_SET}');
            delete from public.product_components c using public.products p
              where (p.id = c.parent_product_id or p.id = c.component_product_id)
                and p.sku in ('${SKU_A}','${SKU_B}','${SKU_SET}');
            delete from public.products where sku in ('${SKU_A}','${SKU_B}','${SKU_SET}');`);
    } catch (_) { /* biarkan */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
