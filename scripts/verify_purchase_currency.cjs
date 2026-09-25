// Verifikasi nota pembelian dalam USD, DP dari nilai barang, dua biaya
// bernama, dan unggah templat item (Task 1, 2, 3, 5 gelombang PO USD/DP).
//
//   - Nota USD ditulis dalam dolar, padanan rupiahnya baris kedua; nilai
//     yang tersimpan di database SELALU rupiah (dolar x kurs nota).
//   - DP dihitung dari subtotal (nilai barang), bukan dari total nota —
//     labelnya "DP X% dari nilai barang" harus konsisten di formulir,
//     detail, dan modal bayar.
//   - other_cost/extra_cost adalah dua biaya bernama terpisah: masuk total
//     nota tapi TIDAK ikut mengubah DP, karena DP dihitung dari subtotal.
//   - Templat item bisa diunduh dan diunggah balik; SKU yang cocok tertaut
//     ke produk katalog, SKU yang tidak dikenal tetap masuk tapi dilaporkan.

const fs = require('fs');
const os = require('os');
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

const TAG = 'UJIPOCUR' + Date.now().toString().slice(-6);
const INV_USD = TAG + '-USD';
const INV_IDR = TAG + '-IDR';
const INV_BIAYA = TAG + '-BIAYA';

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-po-currency-'));

  // SKU katalog nyata (read-only) untuk uji "SKU cocok tertaut ke produk" —
  // dipilih dinamis supaya tidak bergantung pada satu SKU tertentu yang bisa
  // saja sudah tidak ada lagi di katalog client.
  const skuKatalog = psql(
    `select sku from public.products
       where sku is not null and sku !~ '[,;]' and is_active = true
       order by created_at limit 1;`,
  ).split('\n')[0].trim();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const modal = () => page.locator('div.fixed.inset-0').last();

  try {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 })
      .then(() => true).catch(() => false));
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });

    await page.goto(BASE + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });

    // ================= Bagian 1: nota USD =================
    //
    // $1000 barang + $100 pajak, kurs 16.000 (tanpa supplier, kurs bawaan).
    // subtotal = $1.000 -> Rp16.000.000; total = $1.100 -> Rp17.600.000;
    // DP 20% dihitung dari SUBTOTAL ($1.000), bukan dari total: $200 ->
    // Rp3.200.000; sisa pelunasan = total - DP = $900 -> Rp14.400.000.
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
    let m = modal();
    await m.getByPlaceholder('PO-2026-001').fill(INV_USD);
    await m.locator('select').filter({ hasText: /Dolar AS/ }).first().selectOption('USD');
    await page.waitForTimeout(800);
    await m.locator('label:text-is("Pajak") + input').fill('100');
    await m.locator('label:text-is("DP (%)") + input').fill('20');
    await m.getByPlaceholder('Nama item').first().fill('Barang Uji USD ' + TAG);
    await m.getByPlaceholder('Qty').first().fill('1');
    await m.getByPlaceholder(/^Harga \(/).first().fill('1000');
    await page.waitForTimeout(1200);

    let ringkas = await m.innerText();
    record('Subtotal ditulis dalam dolar ($1,000.00)', /\$1,000\.00/.test(ringkas));
    record('Padanan rupiah subtotal tampil (Rp16.000.000)', /Rp\s?16\.000\.000/.test(ringkas));
    record('Total nota dolar = barang + pajak ($1,100.00)', /\$1,100\.00/.test(ringkas));
    record('Padanan rupiah total tampil (Rp17.600.000)', /Rp\s?17\.600\.000/.test(ringkas));
    record('DP 20% dihitung dari nilai barang, bukan total ($200.00)', /\$200\.00/.test(ringkas));
    record('Padanan rupiah DP tampil (Rp3.200.000)', /Rp\s?3\.200\.000/.test(ringkas));
    record('Label DP menyebut dasarnya ("dari nilai barang")', /dari nilai barang/.test(ringkas));
    record('Sisa pelunasan = total - DP ($900.00)', /\$900\.00/.test(ringkas));
    record('Padanan rupiah sisa pelunasan tampil (Rp14.400.000)', /Rp\s?14\.400\.000/.test(ringkas));

    await m.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const dbUsd = psql(
      `select subtotal::int || '|' || total::int || '|' || dp_percent::int || '|' || currency || '|' || exchange_rate::int
         from public.purchases where invoice_number = '${INV_USD}';`,
    );
    record('Nota USD tersimpan di database dalam rupiah (dolar x kurs)',
      dbUsd === '16000000|17600000|20|USD|16000', dbUsd || '(kosong)');

    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV_USD);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(2000);
    // DetailStat menulis labelnya dengan CSS "uppercase", jadi innerText
    // browser mengembalikannya HURUF BESAR walau JSX-nya campuran — regex
    // label di sini sengaja tanpa peduli besar/kecil huruf (flag "i").
    let detail = await modal().innerText();
    record('Detail: Total Nota dolar + padanan rupiah',
      /\$1,100\.00/.test(detail) && /Rp\s?17\.600\.000/.test(detail),
      (detail.match(/Total Nota[\s\S]{0,45}/i) || ['-'])[0].replace(/\n/g, ' '));
    record('Detail: Target DP dari nilai barang, dolar + padanan rupiah',
      /\$200\.00/.test(detail) && /Rp\s?3\.200\.000/.test(detail) && /dari nilai barang/i.test(detail),
      (detail.match(/Target DP[\s\S]{0,60}/i) || ['-'])[0].replace(/\n/g, ' '));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // ================= Bagian 2: DP 20% atas barang 100jt (contoh client) =================
    //
    // Dipakai juga untuk membuktikan label "DP X% dari nilai barang" muncul
    // konsisten di TIGA tempat: formulir, detail, dan modal bayar. Pajak
    // 11jt sengaja beda dari nilai barang supaya total nota != subtotal dan
    // bedanya kelihatan pada sisa pelunasan.
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill('');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
    m = modal();
    await m.getByPlaceholder('PO-2026-001').fill(INV_IDR);
    await m.getByPlaceholder('Nama item').first().fill('Barang Uji IDR ' + TAG);
    await m.getByPlaceholder('Qty').first().fill('1');
    await m.getByPlaceholder(/^Harga \(/).first().fill('100000000');
    await m.locator('label:text-is("Pajak") + input').fill('11000000');
    await m.locator('label:text-is("DP (%)") + input').fill('20');
    await page.waitForTimeout(1200);

    ringkas = await m.innerText();
    record('Formulir: DP 20% atas barang 100jt = 20jt', /Rp\s?20\.000\.000/.test(ringkas),
      (ringkas.match(/DP 20%[\s\S]{0,50}/) || ['-'])[0].replace(/\n/g, ' '));
    record('Formulir: total nota 111jt (barang + pajak)', /Rp\s?111\.000\.000/.test(ringkas));
    record('Formulir: sisa pelunasan = total - DP (91jt)', /Rp\s?91\.000\.000/.test(ringkas),
      (ringkas.match(/Sisa pelunasan[\s\S]{0,40}/) || ['-'])[0].replace(/\n/g, ' '));
    record('Nota rupiah tidak menampilkan baris dolar', !/\$/.test(ringkas));

    await m.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const dbIdr = psql(
      `select subtotal::int || '|' || total::int || '|' || dp_percent::int
         from public.purchases where invoice_number = '${INV_IDR}';`,
    );
    record('Nota IDR tersimpan sesuai formulir', dbIdr === '100000000|111000000|20', dbIdr || '(kosong)');

    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV_IDR);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(2000);
    detail = await modal().innerText();
    record('Detail: Target DP 20% dari nilai barang = Rp20.000.000',
      /dari nilai barang/i.test(detail) && /Rp\s?20\.000\.000/.test(detail),
      (detail.match(/Target DP[\s\S]{0,55}/i) || ['-'])[0].replace(/\n/g, ' '));
    record('Detail: Total Nota Rp111.000.000', /Rp\s?111\.000\.000/.test(detail));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // Modal bayar: label DP yang sama harus muncul di sini juga.
    await page.getByRole('button', { name: /^Bayar$/i }).first().click();
    await page.waitForTimeout(1500);
    const bayar = await modal().innerText();
    record('Modal bayar: Target DP 20% dari nilai barang = Rp20.000.000',
      /Target DP 20% dari nilai barang[\s\S]{0,10}Rp\s?20\.000\.000/.test(bayar.replace(/\n/g, ' ')),
      (bayar.match(/Target DP[\s\S]{0,60}/) || ['-'])[0].replace(/\n/g, ' '));
    record('Modal bayar: Total nota Rp111.000.000', /Rp\s?111\.000\.000/.test(bayar));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // ================= Bagian 3: dua biaya bernama =================
    //
    // DP 10% harus tetap 100rb (dari subtotal 1jt) walau ada 75rb biaya
    // tambahan yang menaikkan total nota jadi 1.075.000.
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill('');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
    m = modal();
    await m.getByPlaceholder('PO-2026-001').fill(INV_BIAYA);
    await m.getByPlaceholder('Nama item').first().fill('Barang Uji Biaya ' + TAG);
    await m.getByPlaceholder('Qty').first().fill('1');
    await m.getByPlaceholder(/^Harga \(/).first().fill('1000000');
    await m.locator('label:text-is("DP (%)") + input').fill('10');
    await m.locator('label:text-is("Biaya lain") + input').fill('50000');
    await m.locator('label:text-is("Nama biaya lain") + input').fill('Ongkir');
    await m.locator('label:text-is("Biaya tambahan") + input').fill('25000');
    await m.locator('label:text-is("Nama biaya tambahan") + input').fill('Bea masuk');
    await page.waitForTimeout(1200);

    ringkas = await m.innerText();
    record('Total nota memasukkan kedua biaya (Rp1.075.000)', /Rp\s?1\.075\.000/.test(ringkas),
      (ringkas.match(/Total nota[\s\S]{0,30}/) || ['-'])[0].replace(/\n/g, ' '));
    record('DP tetap 10% dari nilai barang (Rp100.000), tidak ikut naik oleh biaya',
      /Rp\s?100\.000(\D|$)/.test((ringkas.match(/DP 10%[\s\S]{0,45}/) || ['-'])[0]),
      (ringkas.match(/DP 10%[\s\S]{0,45}/) || ['-'])[0].replace(/\n/g, ' '));

    await m.getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const dbBiaya = psql(
      `select other_cost::int || '|' || coalesce(other_cost_label,'-') || '|' ||
              extra_cost::int || '|' || coalesce(extra_cost_label,'-') || '|' ||
              total::int || '|' || dp_percent::int
         from public.purchases where invoice_number = '${INV_BIAYA}';`,
    );
    record('Kedua biaya, namanya, total, dan DP tersimpan benar di database',
      dbBiaya === '50000|Ongkir|25000|Bea masuk|1075000|10', dbBiaya || '(kosong)');

    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV_BIAYA);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(2000);
    detail = await modal().innerText();
    record('Detail menampilkan nama & nilai biaya pertama (Ongkir Rp50.000)',
      /Ongkir/.test(detail) && /Rp\s?50\.000/.test(detail));
    record('Detail menampilkan nama & nilai biaya kedua (Bea masuk Rp25.000)',
      /Bea masuk/.test(detail) && /Rp\s?25\.000/.test(detail));
    record('Detail: total nota Rp1.075.000', /Rp\s?1\.075\.000/.test(detail));
    record('Detail: Target DP 10% dari nilai barang tetap Rp100.000',
      /Rp\s?100\.000(\D|$)/.test((detail.match(/Target DP[\s\S]{0,55}/i) || ['-'])[0]),
      (detail.match(/Target DP[\s\S]{0,55}/i) || ['-'])[0].replace(/\n/g, ' '));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // ================= Bagian 4: templat item — unduh & unggah =================
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill('');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
    m = modal();

    const [unduhan] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      m.getByRole('button', { name: /Unduh templat/i }).click(),
    ]);
    const tujuanTemplat = path.join(tmp, 'templat-unduhan.csv');
    await unduhan.saveAs(tujuanTemplat);
    const isiTemplat = fs.readFileSync(tujuanTemplat, 'utf8');
    // toCsv proyek ini menulis "sep=;" di baris pertama supaya Excel membuka
    // kolomnya dengan benar, jadi judul kolom ada di baris kedua.
    const barisTemplat = isiTemplat.trim().split(/\r?\n/);
    record('Templat terunduh dengan kolom yang benar',
      /^sku;nama;qty;harga_beli;catatan$/.test(barisTemplat[1] || ''), barisTemplat[1]);

    const SKU_TAK_DIKENAL_1 = 'SKU-BELUM-ADA-1-' + TAG;
    const SKU_TAK_DIKENAL_2 = 'SKU-BELUM-ADA-2-' + TAG;
    const berkasUji = path.join(tmp, 'item-po-uji.csv');
    fs.writeFileSync(
      berkasUji,
      [
        'sku,nama,qty,harga_beli,catatan',
        `${skuKatalog},Diisi dari katalog,5,150000,baris pertama`,
        `${SKU_TAK_DIKENAL_1},Gear Karangan A,2,90000,item manual`,
        `${SKU_TAK_DIKENAL_2},Gear Karangan B,,80000,tanpa qty`,
      ].join('\n'),
      'utf8',
    );
    await m.locator('input[type="file"]').setInputFiles(berkasUji);
    await page.waitForTimeout(2500);

    const teksImpor = await m.innerText();
    record('Laporan menyebut 3 baris terbaca dan 1 SKU cocok ke produk',
      /3 baris terbaca, 1 SKU\s*cocok ke produk/.test(teksImpor.replace(/\s+/g, ' ')),
      (teksImpor.match(/\d+ baris terbaca[^\n]*/) || ['-'])[0]);
    record('Baris tanpa qty dilaporkan', /1 baris tanpa qty/.test(teksImpor));
    record('Kedua SKU tak dikenal dilaporkan, tetap masuk sebagai item manual',
      teksImpor.includes(SKU_TAK_DIKENAL_1) && teksImpor.includes(SKU_TAK_DIKENAL_2)
        && /2 SKU tidak dikenal katalog/.test(teksImpor.replace(/\s+/g, ' ')));

    const jumlahBarisItem = await m.getByPlaceholder('Nama item').count();
    record('Ketiga baris masuk ke formulir', jumlahBarisItem === 3, jumlahBarisItem + ' baris');

    const namaBarisPertama = await m.getByPlaceholder('Nama item').first().inputValue();
    record('Nama dari berkas dipertahankan pada baris pertama',
      namaBarisPertama === 'Diisi dari katalog', namaBarisPertama.slice(0, 45));
    const skuBarisPertama = await m.getByPlaceholder('SKU').first().inputValue();
    record('Baris ber-SKU cocok tertaut ke SKU katalog', skuBarisPertama === skuKatalog, skuBarisPertama);

    await page.keyboard.press('Escape');

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
      psql(`delete from public.purchase_items where purchase_id in
              (select id from public.purchases where invoice_number like '${TAG}%');`, true);
      psql(`delete from public.purchase_payments where purchase_id in
              (select id from public.purchases where invoice_number like '${TAG}%');`, true);
      psql(`delete from public.purchases where invoice_number like '${TAG}%';`, true);
    } catch (_) { /* biarkan */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
