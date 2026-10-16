// Regresi: katalog supplier yang sudah tersimpan harus tampil saat modal dibuka.
//
// Bug asli: efek pengisian draft hanya bergantung pada id supplier, jadi jalan
// ketika live query Dexie masih `undefined`. Katalog tersimpan selalu tampil
// "Belum ada barang terdaftar", dan menekan Simpan dari layar itu menghapus
// seluruh katalog.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();

const results = [];
const record = (n, p, d) => { results.push({ n, p }); console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : '')); };

const TAG = 'KAT' + Date.now().toString().slice(-6);

async function openCatalog(page, supplierName) {
  // Saring dulu lewat kotak cari supaya hanya satu kartu yang tersisa.
  const cari = page.getByPlaceholder(/Cari nama, kontak/i);
  await cari.fill(supplierName);
  await page.waitForTimeout(1200);
  // Nama harus persis: tombol header "Export Katalog" juga cocok dengan /Katalog/.
  await page.getByRole('button', { name: 'Katalog', exact: true }).first().click();
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  trackApi(page);
  let supplierName = '';
  let supplierId = '';
  let snapshot = '[]';
  try {
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 }).then(() => true).catch(() => false));

    // Pakai supplier yang sudah punya katalog di database.
    const baris = sql(`select s.id || '|' || s.name from public.suppliers s
      join public.supplier_product_mappings m on m.supplier_id = s.id
      group by s.id, s.name order by count(*) desc limit 1;`);
    supplierId = baris.split('|')[0];
    supplierName = baris.slice(supplierId.length + 1);
    const jumlah = Number(sql(`select count(*) from public.supplier_product_mappings
      where supplier_id = '${supplierId}';`));
    // Uji ini menekan Simpan sungguhan, jadi katalognya dicadangkan dulu dan
    // dipulihkan di blok finally apa pun hasilnya.
    snapshot = sql(`select coalesce(json_agg(row_to_json(m))::text, '[]')
      from public.supplier_product_mappings m where m.supplier_id = '${supplierId}';`);
    record('Ada supplier berkatalog untuk diuji', jumlah > 0, `${supplierName} (${jumlah} barang)`);

    await page.goto('http://localhost:5173/suppliers', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2500 });

    await openCatalog(page, supplierName);
    const teks = await page.locator("div.fixed.inset-0.z-50").innerText();
    record('Modal katalog terbuka', /Katalog Barang/i.test(teks));
    record('Katalog tersimpan TIDAK tampil kosong', !/Belum ada barang terdaftar/i.test(teks));

    const barisKode = await page.locator('div.fixed.inset-0.z-50 input').count();
    record('Baris katalog ter-render', barisKode > 0, barisKode + ' input');

    const contohSku = sql(`select supplier_sku from public.supplier_product_mappings
      where supplier_id = '${supplierId}' limit 1;`);
    const nilai = await page.locator('div.fixed.inset-0.z-50 input').evaluateAll(
      (els) => els.map((e) => e.value));
    record('Kode supplier tersimpan muncul di salah satu kolom',
      nilai.includes(contohSku), contohSku);

    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '38_katalog_supplier.png') });

    // Menyimpan tanpa mengubah apa pun tidak boleh menghapus katalog.
    await page.getByRole('button', { name: /Simpan Katalog/i }).click();
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    const setelah = Number(sql(`select count(*) from public.supplier_product_mappings
      where supplier_id = '${supplierId}';`));
    record('Simpan tanpa perubahan tidak menghapus katalog', setelah === jumlah, `${jumlah} -> ${setelah}`);

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.p).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '96_katalog_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    // Pulihkan katalog yang mungkin terhapus saat menguji tombol Simpan.
    try {
      if (supplierId && snapshot && snapshot !== '[]') {
        sql(`insert into public.supplier_product_mappings
          select * from json_populate_recordset(null::public.supplier_product_mappings,
          '${snapshot.replace(/'/g, "''")}') on conflict (id) do nothing;`);
      }
    } catch (e) { console.log('Gagal memulihkan katalog: ' + e.message); }
    await browser.close();
  }
})();
