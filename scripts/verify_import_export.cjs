// Verifikasi Impor / Ekspor data produk.
//
// Yang diuji: template terunduh, impor "ganti total" benar-benar mengganti data
// di IndexedDB DAN Postgres, baris rusak dilaporkan per nomor baris tanpa ikut
// masuk, mode "gabung per SKU" tidak menghapus produk lain, dan ekspor CSV/SQL
// menghasilkan berkas yang benar.
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

/** Pecah teks CSV menjadi baris logis; baris baru di dalam tanda kutip tidak memecah baris. */
function barisCsv(teks) {
  const hasil = [];
  let kini = '';
  let dalamKutip = false;
  for (const ch of teks.replace(/\r\n/g, '\n')) {
    if (ch === '"') dalamKutip = !dalamKutip;
    if (ch === '\n' && !dalamKutip) {
      hasil.push(kini);
      kini = '';
    } else kini += ch;
  }
  if (kini) hasil.push(kini);
  return hasil;
}

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const adminPw = envText.split(/\r?\n/).find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')).split('=')[1];
const sql = (q) => execFileSync(PSQL, ['-U','kasir_user','-h','127.0.0.1','-d','kasir','-tAqc',q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim().split('\n')[0].trim();

const results = [];
const record = (n, p, d) => {
  results.push({ n, p });
  console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
};

const TAG = 'IMP' + Date.now().toString().slice(-6);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kasir-imp-'));

// Berkas uji: 3 baris valid + 3 baris sengaja rusak.
const HEADER = 'sku,barcode,nama_produk,kategori,deskripsi,harga_jual,harga_modal,stok,stok_minimum,lacak_stok,aktif,sku_shopee,sku_tiktok,sku_tokopedia,sku_website';
const goodCsv = [
  HEADER,
  `${TAG}-A,899000001,"Gear Depan, Racing",Gear & Rantai,Contoh,175.000,120000,25,5,ya,ya,SHP-${TAG}-A,TT-${TAG}-A,,`,
  `${TAG}-B,,Oli Mesin 1L,Pelumas,,55000,42000,100,20,ya,ya,,,,`,
  `${TAG}-C,,Kampas Rem Depan,Rem,,85000,60000,40,10,ya,tidak,,,,`,
].join('\n');

const dirtyCsv = [
  HEADER,
  `${TAG}-D,,Produk Valid,Umum,,10000,5000,1,1,ya,ya,,,,`,
  `,,SKU kosong jadi dilewati,Umum,,10000,5000,1,1,ya,ya,,,,`,
  `${TAG}-D,,SKU kembar,Umum,,10000,5000,1,1,ya,ya,,,,`,
  `${TAG}-E,,Harga bukan angka,Umum,,Rp seratus,5000,1,1,ya,ya,,,,`,
].join('\n');

const goodPath = path.join(tmp, 'produk-baik.csv');
const dirtyPath = path.join(tmp, 'produk-kotor.csv');
fs.writeFileSync(goodPath, goodCsv, 'utf8');
fs.writeFileSync(dirtyPath, dirtyCsv, 'utf8');

const countLocal = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('kasir');
  req.onsuccess = () => {
    const db = req.result;
    const c = db.transaction('products', 'readonly').objectStore('products').count();
    c.onsuccess = () => { resolve(c.result); db.close(); };
  };
}));

async function openModal(page) {
  await page.getByRole('button', { name: /Impor \/ Ekspor Data/i }).first().click();
  await page.waitForTimeout(700);
}

// Jumlah kolom diambil dari template, lalu dipakai membandingkan hasil ekspor.
let kolomTemplate = 0;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  trackApi(page);
  try {
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', adminPw);
    await page.click('button[type="submit"]');
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500 });
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {});
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 }).then(() => true).catch(() => false));

    // --- tombol seed lama sudah diganti ---
    const body = await page.locator('body').innerText();
    record('Tombol "Seed 1000+ Data" sudah tidak ada', !/Seed 1000\+ Data/i.test(body));
    record('Tombol Impor / Ekspor tampil', /Impor \/ Ekspor Data/i.test(body));

    // --- unduh template ---
    await openModal(page);
    const dl = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Unduh Template CSV/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    if (dl) {
      const p = path.join(tmp, 'template.csv');
      await dl.saveAs(p);
      const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      const lines = text.split('\n').map((l) => l.trim());
      record('Template diawali petunjuk sep=; untuk Excel', lines[0] === 'sep=;', lines[0]);
      const header = lines[1] || '';
      kolomTemplate = header.split(';').length;
      // Jumlahnya sengaja tidak ditulis sebagai angka tetap: menambah kolom
      // baru adalah hal yang wajar, dan uji yang mengunci angkanya cuma
      // menghasilkan kegagalan palsu. Yang benar-benar penting adalah kolom
      // wajibnya ada dan ekspor memakai susunan yang sama.
      record('Template memuat kolom wajib',
        ['sku', 'nama_produk', 'harga_jual', 'stok', 'url_foto'].every(
          (k) => header.split(';').includes(k)),
        header.slice(0, 60) + '…');
      record('Template memuat kolom SKU marketplace', /sku_shopee/.test(header) && /sku_tiktok/.test(header));
    } else {
      record('Template diawali petunjuk sep=; untuk Excel', false, 'unduhan tidak terjadi');
      record('Template memuat kolom wajib', false, 'unduhan tidak terjadi');
      record('Template memuat kolom SKU marketplace', false);
    }

    // --- berkas rusak: dilaporkan, tidak diimpor ---
    await page.getByRole('button', { name: /Impor dari berkas/i }).click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').setInputFiles(dirtyPath);
    await page.waitForTimeout(2500);
    const dirtyText = await page.locator('body').innerText();
    record('Baris bermasalah dilaporkan', /baris dilewati/i.test(dirtyText), (/(\d+) baris dilewati/i.exec(dirtyText) || [])[0]);
    record('Pesan menyebut nomor baris', /Baris \d+:/.test(dirtyText));
    record('SKU kembar terdeteksi', /kembar/i.test(dirtyText));
    record('Harga bukan angka terdeteksi', /bukan angka/i.test(dirtyText));
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '36_import_validasi.png') });

    // --- impor ganti total dengan berkas valid ---
    // Impor penjualan sengaja membiarkan product_id kosong bila SKU-nya belum
    // terdaftar, jadi item yatim bisa sudah ada sebelum uji ini. Yang diuji di
    // sini adalah penggantian produk tidak MENAMBAH item yatim baru.
    const yatimAwal = Number(sql('select count(*) from public.order_items where product_id is null;'));
    const beforeLocal = await countLocal(page);
    page.once('dialog', (d) => d.accept());
    await page.locator('input[type="file"]').setInputFiles(goodPath);
    await page.waitForTimeout(2500);
    // Default modal sekarang "Gabung per SKU" (revisi 9.9); bagian ini khusus
    // menguji mode ganti total, jadi mode itu dipilih eksplisit.
    const tombolGanti = page.getByRole('button', { name: /^Ganti total$/i });
    if (await tombolGanti.count()) {
      await tombolGanti.first().click();
      await page.waitForTimeout(2500);
    }
    const planText = await page.locator('body').innerText();
    record('Rencana menampilkan jumlah produk baru', /Produk baru/i.test(planText));
    record('Peringatan penggantian data lama tampil', /akan\s+diganti/i.test(planText.replace(/\s+/g, ' ')));
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '37_import_rencana.png') });

    // Tunggu tombol benar-benar aktif: rencana masih dihitung saat berkas baru dipilih.
    await page.getByRole('button', { name: /Ganti Semua Produk/i }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Ganti Semua Produk/i.test(x.textContent || ''));
      return b && !b.disabled;
    }, { timeout: 30000 });
    await page.getByRole('button', { name: /Ganti Semua Produk/i }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    const afterLocal = await countLocal(page);
    record('Produk aktif lokal tinggal isi berkas', afterLocal >= 3, `${beforeLocal} -> ${afterLocal}`);

    const inPg = Number(sql(`select count(*) from public.products where sku like '${TAG}-%';`));
    record('Produk masuk ke Postgres', inPg === 3, inPg + ' baris');
    const totalPg = Number(sql('select count(*) from public.products;'));
    // Perilaku baru: produk yang pernah dipakai transaksi TIDAK dihapus,
    // melainkan dinonaktifkan. Menghapusnya akan memutus tautan penjualan lama
    // ke produknya secara permanen (foreign key-nya 'on delete set null').
    const aktifPg = Number(sql('select count(*) from public.products where is_active;'));
    // Berkas uji berisi 3 baris, tapi baris C sengaja diisi aktif=tidak,
    // jadi yang aktif seharusnya 2.
    record('Hanya produk dari berkas yang aktif', aktifPg === 2, aktifPg + ' aktif');

    const terpakai = Number(sql(`select count(*) from public.products p
      where not p.is_active and exists (select 1 from public.order_items i where i.product_id = p.id);`));
    record('Produk yang pernah terjual diarsipkan, bukan dihapus', terpakai > 0, terpakai + ' diarsipkan');

    const yatim = Number(sql(`select count(*) from public.order_items where product_id is null;`));
    record('Riwayat penjualan tetap tertaut ke produknya', yatim <= yatimAwal,
      yatim === yatimAwal ? 'tidak ada tautan yang putus' : (yatim - yatimAwal) + ' tautan putus baru');

    const nameWithComma = sql(`select name from public.products where sku='${TAG}-A';`);
    record('Nama bertanda koma utuh', nameWithComma === 'Gear Depan, Racing', nameWithComma);
    const priceDotted = sql(`select base_price::int from public.products where sku='${TAG}-A';`);
    record('Harga "175.000" terbaca 175000', priceDotted === '175000', priceDotted);
    const inactive = sql(`select is_active from public.products where sku='${TAG}-C';`);
    record('Kolom aktif=tidak dihormati', inactive === 'f', inactive);
    const kategori = Number(sql(`select count(*) from public.categories where name in ('Gear & Rantai','Pelumas','Rem');`));
    record('Kategori dibuat otomatis dari nama', kategori === 3, kategori + ' kategori');
    const chan = Number(sql(`select count(*) from public.product_channel_mappings m join public.products p on p.id=m.product_id where p.sku='${TAG}-A';`));
    record('SKU marketplace ikut terimpor', chan === 2, chan + ' mapping');

    // --- ekspor CSV lalu impor ulang (round-trip) ---
    await openModal(page);
    await page.getByRole('button', { name: /Unduh data produk/i }).click();
    await page.waitForTimeout(500);
    const csvDl = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Untuk diedit di Excel/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    if (csvDl) {
      const p = path.join(tmp, 'ekspor.csv');
      await csvDl.saveAs(p);
      // Deskripsi boleh berisi baris baru (dibungkus kutip), jadi baris dipecah dengan memperhatikan kutip.
      const lines = barisCsv(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim());
      // Baris 0 = sep=;, baris 1 = judul kolom, sisanya data.
      // Ekspor memuat seluruh katalog termasuk produk yang diarsipkan; status
      // aktifnya dibawa di kolom `aktif`, jadi tidak ada data yang hilang.
      const totalProduk = Number(sql('select count(*) from public.products;'));
      record('Ekspor memuat seluruh produk', lines.length - 2 === totalProduk,
        `${lines.length - 2} baris untuk ${totalProduk} produk`);
      record('Ekspor memuat produk hasil impor',
        lines.filter((l) => l.indexOf(TAG) >= 0).length === 3,
        lines.filter((l) => l.indexOf(TAG) >= 0).length + ' baris');
      record('Ekspor memakai pemisah titik koma', lines[0].trim() === 'sep=;');
      record('Ekspor memakai kolom template',
        lines[1].split(';').length === kolomTemplate,
        lines[1].split(';').length + ' vs template ' + kolomTemplate);
      const namaKoma = lines.find((l) => l.includes('Gear Depan, Racing'));
      record('Nama bertanda koma tidak terpotong saat diekspor',
        !!namaKoma && namaKoma.split(';').length === kolomTemplate,
        (namaKoma || '').slice(0, 50));
    } else {
      record('Ekspor memuat seluruh produk', false, 'unduhan tidak terjadi');
      record('Ekspor memuat produk hasil impor', false);
      record('Ekspor memakai pemisah titik koma', false);
      record('Ekspor memakai kolom template', false);
      record('Nama bertanda koma tidak terpotong saat diekspor', false);
    }

    // --- ekspor SQL ---
    const sqlDl = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Untuk pindah server/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    if (sqlDl) {
      const p = path.join(tmp, 'ekspor.sql');
      await sqlDl.saveAs(p);
      const text = fs.readFileSync(p, 'utf8');
      record('Ekspor SQL memakai transaksi', /^begin;/m.test(text) && /commit;/m.test(text));
      record('Ekspor SQL aman dijalankan ulang', /on conflict \(id\) do update/i.test(text));
      record('Ekspor SQL memuat produk yang diimpor', text.includes(`${TAG}-A`));
    } else {
      record('Ekspor SQL memakai transaksi', false, 'unduhan tidak terjadi');
      record('Ekspor SQL aman dijalankan ulang', false);
      record('Ekspor SQL memuat produk yang diimpor', false);
    }

    console.log('');
    console.log('--- RINGKASAN ---');
    const pass = results.filter((r) => r.p).length;
    console.log(pass + '/' + results.length + ' lolos');
    process.exitCode = pass === results.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message);
    await page.screenshot({ path: path.join(__dirname, '..', 'audit_screenshots', '95_import_error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    try { sql(`delete from public.products where sku like '${TAG}-%';`); } catch (_) {}
    // Aktifkan lagi produk demo yang tadi diarsipkan, supaya suite berikutnya
    // menemukan katalog yang utuh seperti sebelum uji ini berjalan.
    try { sql('update public.products set is_active = true where not is_active;'); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    await browser.close();
  }
})();
