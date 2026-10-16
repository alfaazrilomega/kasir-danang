// Uji impor pencairan dana marketplace (laporan saldo Shopee & income TikTok).
//
// Berkas ujinya DIBUAT SENDIRI, tidak menyalin laporan asli milik client:
// laporan saldo memuat nomor pesanan dan nilai transaksi sungguhan, dan itu
// tidak boleh ikut tersimpan di repositori. Susunan kolomnya disamakan persis
// dengan aslinya, termasuk kop laporan Shopee sepanjang 13 baris, supaya yang
// diuji tetap jalur kode yang sama.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { zipSync, strToU8 } = require('fflate');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle } = require('./lib/harness.cjs');

const BASE = 'http://localhost:5173';
const ENV = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(String.fromCharCode(10)).map((l) => l.trim());
const ADMIN_PW = (ENV.find((l) => l.startsWith('BOOTSTRAP_ADMIN_PASSWORD=')) || '').split('=')[1];
const DB_PW = /:\/\/[^:]+:([^@]*)@/.exec(ENV.find((l) => l.startsWith('DATABASE_URL=')) || '')?.[1];

const TAG = 'UJICAIR' + Date.now().toString().slice(-6);
const SP1 = TAG + 'S1';
const SP2 = TAG + 'S2';
const TT1 = TAG + 'T1';
const HILANG = TAG + 'S9';

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

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

// ---------- pembuat berkas xlsx ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

function buatXlsx(tujuan, baris, namaSheet) {
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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(namaSheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  fs.writeFileSync(tujuan, Buffer.from(zipSync(files)));
}

/**
 * Laporan saldo Shopee: kop 13 baris dulu, baru judul kolom.
 *
 * Kopnya ditiru apa adanya — di berkas asli judul tabel ada di baris ke-14,
 * dan importer harus menemukannya lewat isi baris, bukan nomor tetap.
 */
function berkasShopeeSaldo(tujuan) {
  const kop = [
    ['Laporan'], [''], [''], [''],
    ['Info Rekening'],
    ['Username (Penjual)', 'gnnkracing'],
    ['Dari', '2026-08-15'],
    ['Ke', '2026-09-12'],
    ['** Semua perubahan yang dibuat di laporan ini'],
    ['Ringkasan', '', '', '', '$', 'Mata Uang', 'Jumlah Transaksi'],
    ['Total Saldo Masuk', '', '', '', '240000.00', 'IDR', '2'],
    ['Total Saldo Keluar', '', '', '', '0.00', 'IDR', '0'],
    ['Rincian Transaksi'],
  ];
  const header = ['Tanggal Transaksi', 'Tipe Transaksi', 'Deskripsi', 'No. Pesanan',
    'Jenis Transaksi', 'Jumlah', 'Status', 'Saldo Akhir'];
  const baris = [
    // Tengah malam: kalau tanggalnya dipotong dari ISO hasil UTC, harinya mundur ke 11.
    ['2026-09-12 00:45:45', 'Penghasilan dari Pesanan', 'Penghasilan dari Pesanan #' + SP1,
      SP1, 'Transaksi Masuk', '90000.00', 'Transaksi Selesai', '90000.00'],
    ['2026-09-12 06:29:42', 'Penghasilan dari Pesanan', 'Penghasilan dari Pesanan #' + SP2,
      SP2, 'Transaksi Masuk', '150000.00', 'Transaksi Selesai', '240000.00'],
    ['2026-09-11 10:00:00', 'Penarikan Saldo', 'Penarikan ke rekening', '',
      'Transaksi Keluar', '500000.00', 'Transaksi Selesai', '0.00'],
    ['2026-09-10 09:00:00', 'Penghasilan dari Pesanan', 'Penghasilan dari Pesanan #' + HILANG,
      HILANG, 'Transaksi Masuk', '70000.00', 'Transaksi Selesai', '70000.00'],
  ];
  buatXlsx(tujuan, [...kop, header, ...baris], 'Transaction Report');
}

/** Laporan income TikTok: judul di baris pertama, biaya bertanda minus. */
function berkasTiktokIncome(tujuan) {
  const header = ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan',
    'Waktu pembayaran pesanan', 'Mata uang', 'Jumlah penyelesaian pembayaran',
    'Total Pendapatan', 'Total Biaya', 'Biaya komisi platform',
    'Biaya layanan pre-order', 'Biaya Pembayaran', 'Ongkir'];
  const baris = [
    [TT1, 'Pesanan', '2026/09/06', '2026/09/12', 'IDR', '350710', '500000',
      '-149290', '-42050', '-15000', '-990', '-9500'],
    ['ADJ-' + TAG, 'Penggantian Biaya Logistik', '2026/09/06', '2026/09/12', 'IDR',
      '5000', '0', '0', '0', '0', '0', '0'],
  ];
  buatXlsx(tujuan, [header, ...baris], 'Detail pesanan');
}

// ---------- persiapan data ----------

function buatPesananUji(storeId) {
  const baris = [
    [SP1, 'shopee', 100000],
    [SP2, 'shopee', 200000],
    [TT1, 'tiktok', 500000],
  ];
  for (const [nomor, kanal, total] of baris) {
    psql(`insert into public.orders (id, store_id, order_number, external_order_no, subtotal, tax,
            discount, total, payment_method, payment_status, order_status, order_type,
            sales_channel, created_at)
          values (gen_random_uuid(), '${storeId}', '${nomor}', '${nomor}', ${total}, 0, 0, ${total},
            'other', 'paid', 'done', 'take_away', '${kanal}', now());`);
  }
}

const angka = (v) => Number(String(v || '0').replace(/[^0-9.-]/g, ''));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-pencairan-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
  const page = await ctx.newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const modal = () => page.locator('div.fixed.inset-0').last();

  async function bukaModePencairan(berkas) {
    await page.getByRole('button', { name: /Impor Penjualan/i }).click();
    await page.waitForTimeout(900);
    await modal().getByRole('button', { name: /^Pencairan$/i }).click();
    await page.waitForTimeout(600);
    await page.locator('input[type="file"]').first().setInputFiles(berkas);
    await page.waitForTimeout(2500);
    return modal().innerText();
  }

  try {
    const storeId = psql('select id from public.stores order by created_at limit 1;').split('\n')[0].trim();
    buatPesananUji(storeId);

    const berkasSp = path.join(tmp, 'saldo-shopee.xlsx');
    const berkasTt = path.join(tmp, 'income-tiktok.xlsx');
    berkasShopeeSaldo(berkasSp);
    berkasTiktokIncome(berkasTt);

    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PW);
    await page.click('button[type="submit"]');
    record('Login admin', await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 })
      .then(() => true).catch(() => false));
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000 });

    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });

    // ---------- 1. Laporan saldo Shopee ----------
    let teks = await bukaModePencairan(berkasSp);
    record('Kop 13 baris dilewati, susunan Shopee dikenali', /saldo Shopee/i.test(teks),
      teks.replace(/\n/g, ' | ').slice(0, 120));
    record('Nomor pesanan yang tidak ada di aplikasi dilaporkan', teks.includes(HILANG), HILANG);
    record('Baris bukan pendapatan pesanan dilewati', /dilewati|bukan pendapatan/i.test(teks));

    await modal().getByRole('button', { name: /Terapkan \d+ Pencairan/i }).click();
    await page.waitForTimeout(2500);

    const sp1 = psql(`select marketplace_fee, net_settled, settlement_date, total
                        from public.orders where order_number = '${SP1}';`).split('|');
    record('Dana cair & potongan tersimpan (Shopee)',
      angka(sp1[0]) === 10000 && angka(sp1[1]) === 90000, `potongan=${sp1[0]} cair=${sp1[1]}`);
    record('Total pesanan TIDAK diubah impor pencairan', angka(sp1[3]) === 100000, sp1[3]);
    record('Pencairan tengah malam tetap tanggal 12, bukan mundur ke 11',
      (sp1[2] || '').startsWith('2026-09-12'), sp1[2]);

    const sp2 = psql(`select marketplace_fee, net_settled from public.orders where order_number = '${SP2}';`).split('|');
    record('Potongan dihitung dari selisih total (Shopee tidak merinci)',
      angka(sp2[0]) === 50000 && angka(sp2[1]) === 150000, `potongan=${sp2[0]} cair=${sp2[1]}`);

    // ---------- 2. Laporan income TikTok ----------
    teks = await bukaModePencairan(berkasTt);
    record('Susunan TikTok dikenali', /TikTok/i.test(teks), teks.replace(/\n/g, ' | ').slice(0, 100));
    await modal().getByRole('button', { name: /Terapkan \d+ Pencairan/i }).click();
    await page.waitForTimeout(2500);

    const tt = psql(`select marketplace_fee, net_settled, total, coalesce(fee_detail::text, '-')
                       from public.orders where order_number = '${TT1}';`).split('|');
    record('Potongan TikTok dari Total Biaya', angka(tt[0]) === 149290, tt[0]);
    record('Dana cair TikTok tersimpan', angka(tt[1]) === 350710, tt[1]);
    record('Total pesanan TikTok tidak berubah', angka(tt[2]) === 500000, tt[2]);
    const rincian = tt[3] || '';
    record('Rincian biaya TikTok tersimpan',
      /42050/.test(rincian) && /15000/.test(rincian) && /9500/.test(rincian), rincian.slice(0, 80));

    // ---------- 3. Impor ulang tidak menggandakan ----------
    teks = await bukaModePencairan(berkasSp);
    record('Impor ulang menyebut pesanan yang sudah pernah dicairkan',
      /sudah|diperbarui|ditimpa/i.test(teks), teks.replace(/\n/g, ' | ').slice(0, 120));
    await modal().getByRole('button', { name: /Terapkan \d+ Pencairan/i }).click();
    await page.waitForTimeout(2500);
    const jumlahSp1 = psql(`select count(*)::int from public.orders where order_number = '${SP1}';`);
    record('Impor ulang tidak membuat pesanan baru', Number(jumlahSp1) === 1, jumlahSp1 + ' baris');

    // ---------- 4. Detail pesanan memperlihatkan pencairan ----------
    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    const cari = page.locator('tbody tr').filter({ hasText: SP1 }).first();
    await cari.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    record('Pesanan uji tampil di Riwayat Transaksi', await cari.count() > 0);
    await cari.locator('button[title="Detail"]').click();
    await page.waitForTimeout(1200);
    const detail = await modal().innerText();
    record('Detail pesanan menampilkan blok Pencairan', /Pencairan/i.test(detail));
    record('Detail memuat dana cair dan potongan',
      /90\.000/.test(detail) && /10\.000/.test(detail), detail.replace(/\n/g, ' | ').slice(0, 160));

    // ---------- 5. Potongan muncul sebagai biaya di Laba Rugi ----------
    //
    // Inti permintaan client: angka sebelum dan sesudah potong dua-duanya
    // terlihat. Kalau potongan hanya tersimpan di kolom tapi tidak pernah
    // mengurangi laba, laporannya tetap menipu.
    await page.goto(BASE + '/reports', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    await page.getByRole('button', { name: /Laba Rugi/i }).first().click();
    await page.waitForTimeout(2500);
    // Konsol admin tidak memakai <main>; isinya dibaca dari body.
    const lapor = await page.locator('body').innerText();
    record('Laba Rugi memuat baris potongan marketplace',
      /Potongan Marketplace/i.test(lapor),
      (lapor.split(String.fromCharCode(10)).find((b) => /Potongan Marketplace/i.test(b)) || '(tidak ada)').slice(0, 80));

    // Halaman Laporan memuat label yang mirip di beberapa tempat (legenda grafik
    // "Laba kotor", kartu ringkasan, lalu tabel laba rugi). Yang dipakai adalah
    // kemunculan TERAKHIR yang benar-benar diikuti angka rupiah.
    const angkaPnl = (judul) => {
      const baris = lapor.split(String.fromCharCode(10)).map((b) => b.trim());
      let nilai = null;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i].toLowerCase() !== judul) continue;
        for (let j = i; j < Math.min(i + 3, baris.length); j++) {
          if (baris[j].includes('Rp')) {
            const digit = baris[j].replace(/[^0-9]/g, '');
            if (digit) nilai = Number(digit);
            break;
          }
        }
      }
      return nilai;
    };
    const kotor = angkaPnl('laba kotor');
    const bersih = angkaPnl('laba bersih');
    record('Laba Bersih lebih kecil dari Laba Kotor setelah ada potongan',
      kotor != null && bersih != null && bersih < kotor, `kotor=${kotor} bersih=${bersih}`);

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
      psql(`delete from public.order_items where order_id in
              (select id from public.orders where order_number like '${TAG}%');`, true);
      psql(`delete from public.orders where order_number like '${TAG}%';`, true);
    } catch (_) { /* biarkan */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
