// Uji lima butir tambahan dari client (2.3, 3.3, 4.10, 4.12, 5.1).
//
//   2.3  Duplikat produk.
//   3.3  Ekspor mutasi stok dengan kolom Channel & No. Pesanan Platform.
//   4.10 Cetak faktur A4, terpisah dari struk thermal.
//   4.12 Laporan disaring per channel (termasuk tab Harian per tanggal).
//   5.1  Impor & ekspor massal pelanggan.

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

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-tambahan-'));
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

    // ================= 2.3: duplikat produk =================
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    // Baris tbody paling atas bisa jadi baris INDUK kelompok bervarian (Task 4)
    // yang tidak punya tombol Duplikat sendiri -- jadi dicari baris pertama
    // yang benar-benar punya tombol itu, bukan diasumsikan baris pertama.
    const barisDuplikat = page.locator('tbody tr').filter({ has: page.locator('button[title="Duplikat"]') }).first();
    const namaAsal = await barisDuplikat.locator('td').nth(0).innerText();
    await barisDuplikat.locator('button[title="Duplikat"]').click();
    await page.waitForTimeout(2000);

    const form23 = modal();
    const namaBaru = await form23.locator('input').first().inputValue();
    record('Nama produk salinan otomatis diberi tanda (Salinan)',
      namaBaru.includes('(Salinan)') && namaBaru.includes(namaAsal.split('\n')[0].trim()),
      namaBaru);
    const skuKosong = await form23.locator('input[placeholder]').filter({ hasText: '' }).count();
    record('Bagian editor produk terbuka untuk salinan', await form23.getByRole('button', { name: /^Simpan$/i }).count() > 0);

    const skuBaru = 'UJIDUP-' + CAP;
    // Kolom SKU: cari input yang value-nya kosong dan ada di dekat label SKU.
    const skuInput = form23.locator('label:has-text("SKU")').locator('xpath=following::input[1]').first();
    await skuInput.fill(skuBaru).catch(async () => {
      // fallback: input kedua di formulir biasanya SKU
      await form23.locator('input').nth(1).fill(skuBaru);
    });
    await form23.getByRole('button', { name: /^Simpan$/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    const produkBaru = psql(`select name||'|'||stock_qty::numeric from public.products where sku = '${skuBaru}';`);
    const [namaTersimpan, stokTersimpan] = produkBaru.split('|');
    record('Produk salinan tersimpan sebagai produk baru dengan stok 0',
      (namaTersimpan || '').includes('(Salinan)') && Number(stokTersimpan) === 0, produkBaru);

    // ================= Pengelompokan daftar produk per varian (kunciKelompok) =================
    //
    // Bug yang pernah diprotes client: dua produk BERNAMA SAMA PERSIS tapi
    // dengan SKU Induk (parent_sku) berbeda malah digabung jadi satu baris.
    // kunciKelompok mengelompokkan lewat parent_sku dulu, baru jatuh ke nama
    // kalau parent_sku kosong — jadi dua parent_sku berbeda WAJIB tetap dua
    // baris induk terpisah walau namanya identik.
    const storeIdKelompok = psql('select id from public.stores order by created_at limit 1;').split('\n')[0].trim();
    const namaKelompokUji = `Produk Uji Kelompok ${CAP}`;
    const indukA = `UJIKEL-A-${CAP}`;
    const indukB = `UJIKEL-B-${CAP}`;
    psql(`insert into public.products(store_id, name, sku, parent_sku, base_price, is_active, track_stock)
          values ('${storeIdKelompok}', '${namaKelompokUji}', 'UJIKEL-A1-${CAP}', '${indukA}', 50000, true, false),
                 ('${storeIdKelompok}', '${namaKelompokUji}', 'UJIKEL-A2-${CAP}', '${indukA}', 55000, true, false),
                 ('${storeIdKelompok}', '${namaKelompokUji}', 'UJIKEL-B1-${CAP}', '${indukB}', 60000, true, false),
                 ('${storeIdKelompok}', '${namaKelompokUji}', 'UJIKEL-B2-${CAP}', '${indukB}', 65000, true, false);`);

    // Halaman produk memuat gambar dari domain client dan bisa berat; ditunggu
    // lewat kesepian API + selektor baris, bukan networkidle.
    await page.goto(BASE + '/products', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.waitForSelector('tbody tr', { timeout: 60000 });
    const cariKelompok = page.getByPlaceholder(/Cari nama/i).first();
    await cariKelompok.fill(namaKelompokUji);
    await page.waitForTimeout(2000);

    const teksKelompok = await page.locator('tbody').innerText();
    const barisIndukKelompok = page.locator('tbody tr').filter({ hasText: /varian/ });
    record('Kelompok bervarian tampil sebagai satu baris induk (2 varian)',
      (teksKelompok.match(/2 varian/g) || []).length === 2,
      (teksKelompok.match(/\d+ varian/g) || []).join(', '));
    record('Nama sama, SKU Induk berbeda tetap jadi DUA baris induk terpisah',
      await barisIndukKelompok.count() === 2, (await barisIndukKelompok.count()) + ' baris induk');

    await cariKelompok.fill('');
    await page.waitForTimeout(800);

    // ================= 3.3: kolom channel & no. pesanan di ekspor mutasi =================
    await page.goto(BASE + '/stock-mutation', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    const dates33 = page.locator('input[type="date"]');
    await dates33.nth(0).fill('2020-01-01');
    await dates33.nth(1).fill('2030-12-31');
    await page.waitForTimeout(1500);
    await page.locator('select').first().selectOption('sale');
    await page.waitForTimeout(1200);

    const unduhanMutasi = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    record('Ekspor mutasi jenis Penjualan menghasilkan berkas', !!unduhanMutasi);
    if (unduhanMutasi) {
      const berkas = path.join(tmp, 'mutasi.csv');
      await unduhanMutasi.saveAs(berkas);
      const teks = fs.readFileSync(berkas, 'utf8').replace(/^\uFEFF/, '');
      const header = teks.trim().split(/\r?\n/)[1];
      record('Kolom Channel ada di berkas ekspor mutasi', /Channel/i.test(header), header.slice(0, 90));
      record('Kolom No. Pesanan Platform ada di berkas ekspor mutasi', /No\. Pesanan Platform/i.test(header));
      const baris = teks.trim().split(/\r?\n/).slice(2);
      const adaChannelTerisi = baris.some((b) => {
        const kolom = b.split(';');
        return kolom[7] && kolom[7].trim() && kolom[7].trim() !== '""';
      });
      record('Setidaknya satu baris penjualan punya nilai Channel terisi', adaChannelTerisi);
    } else {
      record('Kolom Channel ada di berkas ekspor mutasi', false);
      record('Kolom No. Pesanan Platform ada di berkas ekspor mutasi', false);
      record('Setidaknya satu baris penjualan punya nilai Channel terisi', false);
    }

    // ================= 4.10: cetak faktur A4 terpisah dari thermal =================
    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.locator('tbody tr').first().locator('button[title^="Cetak ulang struk thermal"]').count()
      .then((n) => record('Tombol cetak thermal tersedia di baris Riwayat Transaksi', n > 0));
    await page.locator('tbody tr').first().locator('button[title*="Cetak faktur A4"]').count()
      .then((n) => record('Tombol cetak Faktur A4 tersedia terpisah di baris Riwayat Transaksi', n > 0));

    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1500);
    const detailModal = modal();
    const adaThermalBtn = await detailModal.getByRole('button', { name: /Cetak Thermal/i }).count();
    const adaA4Btn = await detailModal.getByRole('button', { name: /Cetak Faktur A4/i }).count();
    record('Detail pesanan menawarkan dua opsi cetak terpisah', adaThermalBtn > 0 && adaA4Btn > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // ================= 4.12: laporan disaring per channel =================
    await page.goto(BASE + '/reports', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    const dates412 = page.locator('input[type="date"]');
    await dates412.nth(0).fill('2020-01-01');
    await dates412.nth(1).fill('2030-12-31');
    await page.waitForTimeout(2000);

    const totalSemua = await page.locator('text=Total Penjualan').locator('xpath=../..').innerText().catch(() => '');
    const selectChannel = page.locator('select').filter({ hasText: 'Semua channel' });
    record('Dropdown saring channel tersedia di Laporan', await selectChannel.count() > 0);

    const opsi = await selectChannel.locator('option').allTextContents();
    const pilihanKedua = opsi.find((o) => o !== 'Semua channel');
    record('Dropdown channel berisi pilihan channel nyata', !!pilihanKedua, opsi.join(', ').slice(0, 80));

    if (pilihanKedua) {
      await selectChannel.selectOption({ label: pilihanKedua });
      await page.waitForTimeout(2000);
      const totalSetelahFilter = await page.locator('text=Total Penjualan').locator('xpath=../..').innerText().catch(() => '');
      record('Angka Total Penjualan berubah setelah disaring per channel',
        totalSetelahFilter !== totalSemua && totalSemua !== '',
        `sebelum≠sesudah: ${totalSemua !== totalSetelahFilter}`);

      // Tab Harian ikut tersaring — ini inti butir 4.12.
      await page.getByRole('button', { name: /^Harian$/i }).click();
      await page.waitForTimeout(1500);
      const unduhanHarian = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.getByRole('button', { name: /Export CSV/i }).click(),
      ]).then((r) => r[0]).catch(() => null);
      record('Export CSV pada tab Harian saat channel disaring menghasilkan berkas', !!unduhanHarian);
      if (unduhanHarian) {
        record('Nama berkas menyebut channel yang sedang disaring',
          /channel|-[a-z0-9-]+_/i.test(unduhanHarian.suggestedFilename()),
          unduhanHarian.suggestedFilename());
      } else {
        record('Nama berkas menyebut channel yang sedang disaring', false);
      }
    } else {
      record('Angka Total Penjualan berubah setelah disaring per channel', false, 'tidak ada channel lain untuk diuji');
      record('Export CSV pada tab Harian saat channel disaring menghasilkan berkas', false);
      record('Nama berkas menyebut channel yang sedang disaring', false);
    }

    // ================= 5.1: impor & ekspor massal pelanggan =================
    const NL = String.fromCharCode(13, 10);
    const berkasPelanggan = path.join(tmp, 'pelanggan.csv');
    const namaA = 'Pelanggan Uji A ' + CAP;
    const namaB = 'Pelanggan Uji B ' + CAP;
    const hpA = '0811' + CAP;
    fs.writeFileSync(
      berkasPelanggan,
      [
        'sep=;',
        'Nama;Phone;Email;Lokasi;Aktif',
        `${namaA};${hpA};uji.a@contoh.com;Jakarta;ya`,
        `${namaB};;uji.b@contoh.com;Bandung;ya`,
      ].join(NL),
      'utf8',
    );

    // Impor pelanggan ada di Dashboard > Impor / Ekspor Data > Pelanggan.
    const bukaImporPelanggan = async () => {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
      await page.getByRole('button', { name: /Impor \/ Ekspor Data/i }).click();
      await page.waitForTimeout(800);
      await modal().getByRole('button', { name: 'Pelanggan', exact: true }).click();
    };
    await bukaImporPelanggan();
    await page.waitForTimeout(1200);
    await page.locator('input[type="file"]').first().setInputFiles(berkasPelanggan);
    // Tunggu rencana impor tampil, bukan menebak lamanya menarik data.
    await modal().getByText(/Baris terbaca/i).waitFor({ timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(500);

    const teksImporPelanggan = await modal().innerText();
    record('Berkas pelanggan terbaca', /Pelanggan baru/i.test(teksImporPelanggan));
    record('Dua pelanggan baru terdeteksi', /Pelanggan baru\s*\n?\s*2/.test(teksImporPelanggan.replace(/\s+/g, ' ')),
      teksImporPelanggan.replace(/\s+/g, ' ').slice(0, 120));

    await modal().getByRole('button', { name: /Impor \d+ Pelanggan/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    const jumlahPelangganUji = psql(
      `select count(*) from public.customers where name in ('${namaA}','${namaB}');`);
    record('Kedua pelanggan tersimpan di server', jumlahPelangganUji === '2', jumlahPelangganUji + ' baris');

    // Impor ulang berkas yang sama dengan HP sama tapi nama diedit -> harus UPDATE, bukan duplikat.
    const namaA2 = namaA + ' (Update)';
    fs.writeFileSync(
      berkasPelanggan,
      [
        'sep=;',
        'Nama;Phone;Email;Lokasi;Aktif',
        `${namaA2};${hpA};uji.a@contoh.com;Jakarta;ya`,
      ].join(NL),
      'utf8',
    );
    await bukaImporPelanggan();
    await page.waitForTimeout(1200);
    await page.locator('input[type="file"]').first().setInputFiles(berkasPelanggan);
    // Tunggu rencana impor tampil, bukan menebak lamanya menarik data.
    await modal().getByText(/Baris terbaca/i).waitFor({ timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(500);
    const teksUpdate = (await modal().innerText()).replace(/\s+/g, ' ');
    record('Nomor HP yang sama dikenali sebagai pembaruan, bukan duplikat',
      /Diperbarui\s*1/.test(teksUpdate), teksUpdate.slice(0, 120));
    await modal().getByRole('button', { name: /Impor \d+ Pelanggan/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(2000);

    const totalDenganHpItu = psql(
      `select count(*) from public.customers where phone = '${hpA}';`);
    record('Impor ulang tidak menggandakan pelanggan dengan HP yang sama',
      totalDenganHpItu === '1', totalDenganHpItu + ' baris untuk HP ' + hpA);

    // ---- 7.1 Impor pengeluaran massal (Dashboard > Impor / Ekspor Data > Pengeluaran) ----
    const berkasPengeluaran = path.join(tmp, 'pengeluaran.csv');
    fs.writeFileSync(
      berkasPengeluaran,
      [
        'sep=;',
        'Tanggal;Kategori;Keterangan;Jumlah;Metode Bayar',
        `2026-07-05;Sewa;Sewa gudang uji ${CAP};Rp 3.500.000;transfer`,
        `06/07/2026;Listrik & Air;Token listrik uji ${CAP};450000;cash`,
        `2026-07-07;KategoriNgawur;Biaya uji ${CAP};125.000;dompet digital`,
      ].join(NL),
      'utf8',
    );

    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByRole('button', { name: /Impor \/ Ekspor Data/i }).click();
    await page.waitForTimeout(800);
    await modal().getByRole('button', { name: 'Pengeluaran', exact: true }).click();
    await page.locator('input[type="file"]').first().setInputFiles(berkasPengeluaran);
    await modal().getByText(/Baris terbaca/i).waitFor({ timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(500);

    const teksPengeluaran = (await modal().innerText()).replace(/\s+/g, ' ');
    record('Tiga baris pengeluaran terbaca', /Baris terbaca 3/.test(teksPengeluaran),
      teksPengeluaran.slice(teksPengeluaran.indexOf('Baris terbaca'), teksPengeluaran.indexOf('Baris terbaca') + 120));
    record('Total nilai pengeluaran dihitung dari berkas', /4\.075\.000/.test(teksPengeluaran),
      'harusnya Rp 4.075.000 (3.500.000 + 450.000 + 125.000)');
    record('Kategori di luar daftar ditandai, bukan menggagalkan baris',
      /tidak dikenal/i.test(teksPengeluaran));

    await modal().getByRole('button', { name: /Impor \d+ Pengeluaran/i }).click();
    await waitForApiIdle(page, { idleMs: 4000, minWaitMs: 3000, timeoutMs: 120000 });
    await page.waitForTimeout(1500);

    const tersimpan = psql(
      `select count(*) from public.expenses where description like '%uji ${CAP}%';`);
    record('Ketiga pengeluaran tersimpan di server', tersimpan === '3', tersimpan + ' baris');
    const jumlahSewa = psql(
      `select amount::int from public.expenses where description = 'Sewa gudang uji ${CAP}';`);
    record('Jumlah "Rp 3.500.000" terbaca sebagai angka', jumlahSewa === '3500000', jumlahSewa);
    const tanggalToken = psql(
      `select expense_date::text from public.expenses where description = 'Token listrik uji ${CAP}';`);
    record('Tanggal 06/07/2026 terbaca sebagai 2026-07-06', tanggalToken === '2026-07-06', tanggalToken);
    const kategoriNgawur = psql(
      `select category from public.expenses where description = 'Biaya uji ${CAP}';`);
    record('Kategori tak dikenal jatuh ke Lainnya', kategoriNgawur === 'lainnya', kategoriNgawur);

    // Ekspor
    await page.goto(BASE + '/customers', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByPlaceholder(/Cari nama/i).fill(CAP);
    await page.waitForTimeout(1500);
    const unduhanPelanggan = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ]).then((r) => r[0]).catch(() => null);
    record('Export CSV pelanggan (hasil pencarian) menghasilkan berkas', !!unduhanPelanggan);
    if (unduhanPelanggan) {
      const berkasEkspor = path.join(tmp, 'ekspor-pelanggan.csv');
      await unduhanPelanggan.saveAs(berkasEkspor);
      const teks = fs.readFileSync(berkasEkspor, 'utf8').replace(/^\uFEFF/, '');
      const jumlahBaris = teks.trim().split(/\r?\n/).length - 2;
      record('Ekspor pelanggan mengikuti hasil pencarian, bukan seluruh data',
        jumlahBaris === 2, jumlahBaris + ' baris (harusnya 2)');
    } else {
      record('Ekspor pelanggan mengikuti hasil pencarian, bukan seluruh data', false);
    }

    // ========== Order ID pesanan tersimpan bisa diubah ==========
    //
    // Client menjual juga di Shopee/TikTok dan nomor pesanan di sana sering baru
    // diketahui setelah struk tercetak. Uji memakai pesanan buatan sendiri,
    // bukan pesanan client, lalu menghapusnya lagi di bagian bersih-bersih.
    const tokoUji = psql("select id from public.stores order by created_at limit 1;").split(String.fromCharCode(10))[0].trim();
    const nomorAwal = 'UJI-ORD-' + CAP;
    const nomorBaru = 'UJI-ORD-' + CAP + '-SHOPEE';
    psql(`insert into public.orders (id, store_id, order_number, subtotal, tax, discount, total,
            payment_method, payment_status, order_status, order_type, sales_channel, created_at)
          values (gen_random_uuid(), '${tokoUji}', '${nomorAwal}', 10000, 0, 0, 10000,
            'cash', 'paid', 'done', 'take_away', 'offline', now());`);

    await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2000 });
    const barisUji = page.locator('tbody tr').filter({ hasText: nomorAwal }).first();
    // Baris baru muncul setelah pullRecentOrders menulis ke Dexie dan liveQuery
    // merender ulang — itu terjadi sesudah lalu lintas API reda, jadi ditunggu
    // barisnya, bukan ditebak lamanya.
    await barisUji.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    record('Pesanan uji muncul di Riwayat Transaksi', await barisUji.count() > 0);
    // Panel detail dibuka lewat tombol mata di kolom Action; mengklik barisnya
    // sendiri tidak membuka apa pun.
    await barisUji.locator('button[title="Detail"]').click();
    await page.waitForTimeout(1000);
    const tombolUbah = page.getByRole('button', { name: /Ubah Order ID/i }).first();
    record('Tombol "Ubah Order ID" tersedia untuk admin', await tombolUbah.count() > 0);
    await tombolUbah.click();
    await page.waitForTimeout(600);
    await page.locator('#ubah-order-id').fill(nomorBaru);
    await page.getByRole('button', { name: /Simpan Order ID/i }).click();
    await page.waitForTimeout(1800);
    const diDb = psql(`select order_number from public.orders where order_number = '${nomorBaru}';`).trim();
    record('Order ID tersimpan ke database', diDb === nomorBaru, diDb || 'kosong');

    // ========== Tamu diarahkan ke etalase, bukan ke formulir masuk ==========
    const tamu = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const halamanTamu = await tamu.newPage();
    await halamanTamu.goto(BASE + '/', { waitUntil: 'networkidle' });
    await halamanTamu.waitForTimeout(1200);
    record('Pengunjung tanpa sesi diarahkan ke /toko',
      new URL(halamanTamu.url()).pathname.startsWith('/toko'), halamanTamu.url());
    await halamanTamu.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await halamanTamu.waitForTimeout(800);
    record('/login tetap bisa dibuka langsung',
      new URL(halamanTamu.url()).pathname === '/login'
        && (await halamanTamu.locator('input[type="password"]').count()) > 0);
    await tamu.close();

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
      psql(`delete from public.products where sku = 'UJIDUP-${CAP}';`);
      psql(`delete from public.products where sku like 'UJIKEL-%-${CAP}';`);
      psql(`delete from public.customers where name like '%Uji%${CAP}%' or phone = '0811${CAP}';`);
      psql(`delete from public.expenses where description like '%uji ${CAP}%';`);
      psql(`delete from public.orders where order_number like 'UJI-ORD-${CAP}%';`);
    } catch (_) { /* biarkan */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
