// Uji impor penjualan dari berkas .xlsx bergaya Shopee dan TikTok.
//
// Berkas ujinya DIBUAT SENDIRI di sini, tidak menyalin ekspor asli milik client:
// ekspor Shopee memuat nama, nomor telepon, dan alamat lengkap pembeli, dan itu
// tidak boleh ikut tersimpan di dalam repositori. Susunan kolomnya dibuat sama
// persis dengan aslinya, jadi yang diuji tetap jalur kode yang sama.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { zipSync, strToU8 } = require('fflate');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');
const { execFileSync } = require('child_process');

const BASE = 'http://localhost:5173';
const ENV = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(String.fromCharCode(10)).map((l) => l.trim());
const ADMIN_PW = (ENV.find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const DB_PW = /:\/\/[^:]+:([^@]*)@/.exec(ENV.find((l) => l.startsWith('DATABASE_URL=')) || '')?.[1];

const TAG = 'UJIMP' + Date.now().toString().slice(-6);
const NO_TT = [TAG + 'T1', TAG + 'T2'];
const NO_SP = [TAG + 'S1'];

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

// ---------- pembuat berkas xlsx ----------

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ubah 0 jadi "A", 26 jadi "AA". */
function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const sisa = (n - 1) % 26;
    s = String.fromCharCode(65 + sisa) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Tulis .xlsx paling sederhana yang masih sah: semua sel sebagai teks sebaris
 * (inlineStr), tanpa tabel string bersama. Cukup untuk menguji pembacaan.
 */
function buatXlsx(tujuan, baris) {
  const rowsXml = baris.map((kolom, r) => {
    const sel = kolom.map((v, c) =>
      v === '' ? '' : `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`,
    ).join('');
    return `<row r="${r + 1}">${sel}</row>`;
  }).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;

  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="orders" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  fs.writeFileSync(tujuan, Buffer.from(zipSync(files)));
}

/** Susunan kolom TikTok, termasuk baris keterangan yang bukan data. */
function berkasTiktok(tujuan) {
  const header = [
    'Order ID', 'Order Status', 'Seller SKU', 'Product Name', 'Quantity',
    'SKU Subtotal After Discount', 'Created Time', 'Paid Time', 'Payment Method', 'Recipient',
  ];
  const keterangan = ['', 'The order status.', '', '', '', '', '', '', '', ''];
  const baris = [
    [NO_TT[0], 'Perlu dikirim', 'UJI-SKU-A', 'Gear Set Uji A', '2', '500000',
      '02/09/2026 20:29:30', '02/09/2026 20:30:00', 'Bayar di tempat', 'B*** S***'],
    [NO_TT[0], 'Perlu dikirim', 'UJI-SKU-B', 'Rantai Uji B', '1', '150000',
      '02/09/2026 20:29:30', '02/09/2026 20:30:00', 'Bayar di tempat', 'B*** S***'],
    [NO_TT[1], 'Selesai', 'UJI-SKU-C', 'Gear Uji C', '1', '425000',
      '03/09/2026 08:51:57', '03/09/2026 08:52:00', 'Bayar di tempat', 'C*** D***'],
  ];
  buatXlsx(tujuan, [header, keterangan, ...baris]);
}

/** Susunan kolom Shopee, dengan harga bertitik ribuan. */
function berkasShopee(tujuan) {
  const header = [
    'No. Pesanan', 'Status Pesanan', 'Waktu Pesanan Dibuat', 'Waktu Pembayaran Dilakukan',
    'Metode Pembayaran', 'SKU Induk', 'Nama Produk', 'Nomor Referensi SKU', 'Jumlah',
    'Harga Setelah Diskon', 'Nama Penerima',
  ];
  const baris = [
    [NO_SP[0], 'Perlu Dikirim', '2026-09-02 19:34', '2026-09-02 19:35', 'QRIS',
      'UJI-INDUK', 'Gear Belakang Uji', 'UJI-SKU-D', '1', '195.000', 'E*** F***'],
  ];
  buatXlsx(tujuan, [header, ...baris]);
}

// ---------- pembersihan ----------

function psql(sql) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', sql],
    { env: { ...process.env, PGPASSWORD: DB_PW }, encoding: 'utf8' }).trim();
}

function bersihkan() {
  const daftar = [...NO_TT, ...NO_SP, '#CONTOH-001'].map((n) => `'${n}'`).join(',');
  psql(
    `delete from public.order_items i using public.orders o ` +
    `where o.id = i.order_id and o.order_number in (${daftar}); ` +
    `delete from public.orders where order_number in (${daftar});`,
  );
}

// ---------- jalannya uji ----------

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-mp-'));
  const fileTt = path.join(tmp, 'tiktok-uji.xlsx');
  const fileSp = path.join(tmp, 'shopee-uji.xlsx');
  berkasTiktok(fileTt);
  berkasShopee(fileSp);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
  trackApi(page);
  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 })
      .then(() => true).catch(() => false));
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 4000 });

    const bukaModal = async () => {
      await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
      await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
      await page.getByRole('button', { name: /Impor Penjualan/i }).click();
      await page.waitForTimeout(1200);
    };
    const modal = () => page.locator('div.fixed.inset-0').last();

    // ---- TikTok ----
    await bukaModal();
    await page.locator('input[type="file"]').setInputFiles(fileTt);
    await page.waitForTimeout(3500);
    let teks = await modal().innerText();
    record('Berkas xlsx terbaca tanpa pustaka pihak ketiga', /Terbaca sebagai/i.test(teks));
    record('Susunan TikTok dikenali', /ekspor TikTok Shop/i.test(teks));
    let n = /Impor (\d+) Pesanan/i.exec(teks);
    record('Baris keterangan kolom tidak dihitung sebagai pesanan', n && n[1] === '2',
      n ? n[1] + ' pesanan' : '-');
    record('Dua baris bernomor sama digabung jadi satu pesanan', /Baris barang\s*\n?\s*3/.test(teks),
      (/Baris barang\s*\n?\s*(\d+)/.exec(teks) || ['-'])[0].replace(/\s+/g, ' '));
    record('Harga dihitung dari total baris dibagi qty', /1\.075\.000/.test(teks));

    await page.getByRole('button', { name: /Impor \d+ Pesanan/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const simpanTt = psql(
      `select count(*) from public.orders where order_number in ('${NO_TT[0]}','${NO_TT[1]}');`);
    record('Pesanan TikTok tersimpan di server', simpanTt === '2', simpanTt + ' pesanan');
    const bayarTt = psql(`select payment_method from public.orders where order_number = '${NO_TT[0]}';`);
    record('COD dipetakan ke tunai', bayarTt === 'cash', bayarTt);
    const namaTt = psql(`select coalesce(customer_name,'(kosong)') from public.orders where order_number = '${NO_TT[1]}';`);
    record('Nama penerima tersimpan tanpa membuat pelanggan baru', namaTt === 'C*** D***', namaTt);
    const platformTt = psql(`select coalesce(external_order_no,'(kosong)') from public.orders where order_number = '${NO_TT[0]}';`);
    record('Nomor pesanan platform tersimpan', platformTt === NO_TT[0], platformTt);

    // ---- Duplikat ----
    await bukaModal();
    await page.locator('input[type="file"]').setInputFiles(fileTt);
    await page.waitForTimeout(3500);
    teks = await modal().innerText();
    record('Berkas yang sama ditolak sebagai duplikat', /2 pesanan dilewati/i.test(teks),
      (/(\d+) pesanan dilewati/i.exec(teks) || ['-'])[0]);
    // "Berkasnya tidak terbaca" dan "semuanya sudah pernah diimpor" harus
    // dibedakan; menyamakannya membuat penolakan yang benar terlihat rusak.
    const pesan = await page.locator('body').innerText();
    record('Pesan membedakan sudah pernah diimpor dari berkas tidak terbaca',
      /sudah pernah diimpor/i.test(pesan) && !/Tidak ada pesanan yang bisa diimpor/i.test(pesan),
      (/Semua \d+ pesanan[^\n]*/i.exec(pesan) || ['(tidak ada)'])[0].slice(0, 60));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // ---- Template .xlsx: diunduh lalu diunggah balik ----
    await bukaModal();
    const unduhan = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Unduh template \.xlsx/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    record('Template .xlsx tersedia untuk diunduh', !!unduhan,
      unduhan ? unduhan.suggestedFilename() : 'tidak terunduh');
    if (unduhan) {
      const berkasTemplate = path.join(tmp, 'template.xlsx');
      await unduhan.saveAs(berkasTemplate);
      await page.locator('input[type="file"]').setInputFiles(berkasTemplate);
      await page.waitForTimeout(3500);
      teks = await modal().innerText();
      // Template yang tidak bisa dibaca balik oleh aplikasinya sendiri adalah
      // template yang salah, dan itu baru ketahuan di tangan client.
      record('Template hasil unduhan bisa dibaca balik', /susunan TokoKu/i.test(teks),
        (/Terbaca sebagai[^\n]*/i.exec(teks) || ['-'])[0].slice(0, 50));
      record('Contoh di template menunjukkan satu pesanan berisi dua barang',
        /Impor 1 Pesanan/i.test(teks), (/Impor \d+ Pesanan/i.exec(teks) || ['-'])[0]);
    } else {
      record('Template hasil unduhan bisa dibaca balik', false);
      record('Contoh di template menunjukkan satu pesanan berisi dua barang', false);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // ---- Shopee ----
    await bukaModal();
    await page.locator('input[type="file"]').setInputFiles(fileSp);
    await page.waitForTimeout(3500);
    teks = await modal().innerText();
    record('Susunan Shopee dikenali', /ekspor Shopee/i.test(teks));
    record('Titik ribuan dibaca sebagai ribuan, bukan desimal', /195\.000/.test(teks) && !/Rp 195\b/.test(teks));
    record('Pilihan channel tujuan tersedia', /Channel tujuan/i.test(teks));
    n = /Impor (\d+) Pesanan/i.exec(teks);
    record('Satu pesanan Shopee terbaca', n && n[1] === '1', n ? n[1] + ' pesanan' : '-');

    await page.getByRole('button', { name: /Impor \d+ Pesanan/i }).click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const nilaiSp = psql(`select total from public.orders where order_number = '${NO_SP[0]}';`);
    record('Nilai pesanan Shopee benar', Number(nilaiSp) === 195000, 'Rp ' + nilaiSp);
    const channelSp = psql(`select sales_channel from public.orders where order_number = '${NO_SP[0]}';`);
    record('Channel terisi dari susunan berkas', channelSp === 'shopee', channelSp);
    const qrisSp = psql(`select payment_method from public.orders where order_number = '${NO_SP[0]}';`);
    record('QRIS dipetakan dengan benar', qrisSp === 'qris', qrisSp);

    // ---- Stok tidak boleh berubah ----
    const mutasi = psql(
      `select count(*) from public.stock_movements m join public.orders o on o.id = m.ref_order_id ` +
      `where o.order_number in ('${NO_TT[0]}','${NO_TT[1]}','${NO_SP[0]}');`);
    record('Impor tidak menyentuh stok', mutasi === '0', mutasi + ' mutasi stok');

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
    try { bersihkan(); } catch (_) { /* biarkan */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
