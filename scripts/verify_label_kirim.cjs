// Verifikasi butir 16 PERMINTAAN-CLIENT.md: cetak label alamat pengiriman
// dari Riwayat Transaksi.
//
// Kutipan client (video 3 Okt, spreadsheet 6,3): "di sini untuk label
// pengiriman, mas. Jadi labeling itu produk atau alamat tujuan yang saya
// kirimkan. Di sini kan belum ada … alamat untuk tujuan si pengiriman
// barangnya kan belum muncul di sini … Jadi cetak label alamat tujuan".
//
// Yang diuji:
//   - Detail pesanan beralamat punya tombol "Cetak Label Kirim".
//   - Label berukuran 100 x 150 mm, memuat penerima (nama, telepon, alamat),
//     pengirim (toko), catatan pesanan, dan isi paket ber-SKU, tanpa harga.
//   - Pesanan kasir tanpa alamat kirim memakai alamat utama pelanggannya.
//   - Kota dan provinsi tidak dicetak dua kali kalau sudah ada di alamat.
//   - Pesanan tanpa alamat, pesanan batal, dan pesanan web yang masih menunggu
//     konfirmasi tidak menawarkan label (di video client mengonfirmasi dulu,
//     baru mencari label).
//   - Pesanan 30 barang tetap satu label: daftar barang dipangkas dan sisanya
//     disebut jumlahnya.
//   - Isian pembeli dicetak sebagai teks, tidak dijalankan sebagai HTML.
//   - Alamat 400 karakter ditambah catatan 330 karakter tetap muat: catatan
//     dibatasi tiga baris, alamat utuh, barang tetap terlihat.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, ADMIN_PASSWORD, DB_PASSWORD, BASE_URL } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const TAG = 'UJILBL' + Date.now().toString().slice(-6);
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined ? ' — ' + ket : ''));
};

(async () => {
  const STORE = psql('select id from public.stores order by created_at limit 1;');
  const TOKO = psql(`select name || '|' || coalesce(address, '') from public.stores where id = '${STORE}';`).split('|');
  const [P1, P2, CUST, W, A, O, X, B, E, T, M] = Array.from({ length: 11 }, () => psql('select gen_random_uuid();'));
  psql(`insert into public.products (id, store_id, name, sku, base_price, cost_price, stock_qty, track_stock, is_active) values
    ('${P1}', '${STORE}', 'Gear Set Honda Crf150 Black ${TAG}', 'L1-${TAG}', 655000, 400000, 100, true, true),
    ('${P2}', '${STORE}', 'Gear Depan Fiz R ${TAG}', 'L2-${TAG}', 65000, 40000, 100, true, true);`);
  // 30 produk untuk pesanan grosir.
  const banyak = Array.from({ length: 30 }, (_, i) => ({ id: psql('select gen_random_uuid();'), sku: `LB${String(i + 1).padStart(2, '0')}-${TAG}` }));
  psql(`insert into public.products (id, store_id, name, sku, base_price, cost_price, stock_qty, track_stock, is_active) values ${
    banyak.map((p) => `('${p.id}', '${STORE}', 'Gear Set Yamaha MX King Type 415 Black ${TAG}', '${p.sku}', 655000, 400000, 100, true, true)`).join(',')};`);
  psql(`insert into public.customers (id, store_id, name, phone, joined_date, is_active, points, created_at, address, address_city, address_province)
        values ('${CUST}', '${STORE}', 'Bengkel Aldo ${TAG}', '081277770001', current_date, true, 0, now(),
                'Jl. Melati No. 7, Purwokerto Selatan', 'Kabupaten Banyumas', 'Jawa Tengah');`);
  const pesanan = (id, nomor, isi) => psql(`insert into public.orders (id, store_id, customer_id, order_number, subtotal, tax, discount, total, payment_method,
        payment_status, order_status, order_type, sales_channel, payment_term, tax_inclusive, customer_name, customer_phone,
        delivery_address, delivery_city, delivery_province, notes, created_at)
      values ('${id}', '${STORE}', ${isi.cust ? `'${isi.cust}'` : 'null'}, '${nomor}', 1375000, 0, 0, 1375000, 'qris',
        'paid', '${isi.status || 'done'}', 'take_away', '${isi.kanal}', 'cash', false, ${isi.nama ? `'${isi.nama}'` : 'null'},
        ${isi.telp ? `'${isi.telp}'` : 'null'}, ${isi.alamat ? `'${isi.alamat}'` : 'null'}, ${isi.kota ? `'${isi.kota}'` : 'null'},
        ${isi.prov ? `'${isi.prov}'` : 'null'}, ${isi.catatan ? `'${isi.catatan}'` : 'null'}, now() - interval '${isi.menit} minutes');`);
  pesanan(W, `WEB-${TAG}`, { kanal: 'website', nama: 'Nanang ' + TAG, telp: '081314249663', alamat: 'Jl janoko No. 5, Kabupaten Banyumas, Jawa Tengah',
    kota: 'Kabupaten Banyumas', prov: 'Jawa Tengah', catatan: 'Bubble wrap tebal ya', menit: 10 });
  pesanan(A, `WA-${TAG}`, { kanal: 'whatsapp', cust: CUST, menit: 12 });
  pesanan(O, `KASIR-${TAG}`, { kanal: 'offline', menit: 14 });
  pesanan(M, `TUNGGU-${TAG}`, { kanal: 'website', status: 'awaiting_confirmation', nama: 'Menunggu ' + TAG, telp: '0813', alamat: 'Jl. Mawar 3, Kota Malang, Jawa Timur', menit: 15 });
  pesanan(X, `BATAL-${TAG}`, { kanal: 'website', status: 'canceled', nama: 'Batal ' + TAG, telp: '0811', alamat: 'Jl. Kenanga 1, Kota Surabaya, Jawa Timur', menit: 16 });
  pesanan(B, `GROSIR-${TAG}`, { kanal: 'website', nama: 'Bengkel Motor Sumber Rejeki Jaya Abadi Makmur Sentosa', telp: '+62 813-1424-9663',
    alamat: 'Perumahan Griya Permata Indah Blok C-12 No. 7, RT 004 RW 011, Kelurahan Karangklesem, Kecamatan Purwokerto Selatan, patokan depan masjid Al-Ikhlas',
    kota: 'Kabupaten Banyumas', prov: 'Jawa Tengah', catatan: 'Kirim pakai JNE YES, barang untuk lomba hari Minggu.', menit: 18 });
  pesanan(E, `XSS-${TAG}`, { kanal: 'website', nama: '<img src=x onerror=window.__xss=1>', telp: '0812', alamat: '<b>Jl. Tebal</b> 9, Kota Malang', menit: 20 });
  // Tepi: alamat 400 karakter dan catatan 330 karakter sekaligus.
  const ALAMAT_400 = ('Perumahan Griya Permata Indah Blok C-12 No. 7, RT 004 RW 011, Kelurahan Karangklesem, Kecamatan Purwokerto Selatan, patokan depan masjid Al-Ikhlas sebelah warung bu Tini, ').repeat(3).slice(0, 400).trim();
  const CATATAN_330 = 'Tolong dibungkus bubble wrap tebal tiga lapis karena barang untuk lomba hari Minggu, jangan dibanting, kirim pakai JNE YES paling lambat besok pagi sebelum jam sembilan, kalau tidak sempat hubungi dulu nomor ini, jangan sampai telat karena lombanya jam tujuh pagi, terima kasih banyak ya mas sudah dibantu, semoga lancar dan barangnya aman sampai tujuan.';
  pesanan(T, `TEPI-${TAG}`, { kanal: 'website', nama: 'Bengkel Motor Sumber Rejeki Jaya Abadi Makmur Sentosa', telp: '+62 813-1424-9663', alamat: ALAMAT_400,
    kota: 'Kabupaten Banyumas', prov: 'Jawa Tengah', catatan: CATATAN_330, menit: 22 });
  const baris = (order, product, nama, qty) => `(gen_random_uuid(), '${order}', '${product}', '${nama}', null, ${qty}, 655000, 400000, null)`;
  psql(`insert into public.order_items (id, order_id, product_id, name, size, qty, price, cost_price, note) values
    ${baris(W, P1, 'Gear Set Honda Crf150 Black ' + TAG, 2)}, ${baris(W, P2, 'Gear Depan Fiz R ' + TAG, 1)},
    ${baris(A, P1, 'Gear Set Honda Crf150 Black ' + TAG, 1)}, ${baris(O, P1, 'Gear Set Honda Crf150 Black ' + TAG, 1)},
    ${baris(X, P1, 'Gear Set Honda Crf150 Black ' + TAG, 1)}, ${baris(E, P1, 'Gear Set Honda Crf150 Black ' + TAG, 1)},
    ${baris(M, P1, 'Gear Set Honda Crf150 Black ' + TAG, 1)},
    ${baris(T, P1, 'Gear Set Honda Crf150 Black ' + TAG, 3)}, ${baris(T, P2, 'Gear Depan Fiz R ' + TAG, 2)},
    ${banyak.map((p) => baris(B, p.id, 'Gear Set Yamaha MX King Type 415 Black ' + TAG, 10)).join(',')};`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  trackApi(page);
  const modal = () => page.locator('div.fixed.inset-0').last();
  const tombolLabel = () => modal().getByRole('button', { name: /Cetak Label Kirim/i });

  async function bukaDetail(nomor) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByPlaceholder(/Cari ID/i).first().fill(nomor);
    await page.waitForTimeout(900);
    await page.locator('tbody tr').filter({ hasText: nomor }).first().getByTitle('Detail').click();
    await page.waitForTimeout(800);
  }
  // Isi iframe cetak label yang dibuat oleh tombol (dialog cetak tidak muncul di headless).
  async function htmlLabel(nomor) {
    await page.evaluate(() => document.querySelectorAll('iframe').forEach((f) => f.remove()));
    await tombolLabel().click();
    await page.waitForFunction((n) => Array.from(document.querySelectorAll('iframe'))
      .some((f) => (f.title || '').includes(n) && (f.contentDocument?.documentElement?.outerHTML || '').includes('</html>')), nomor, { timeout: 15000 }).catch(() => {});
    return page.evaluate((n) => {
      const f = Array.from(document.querySelectorAll('iframe')).find((x) => (x.title || '').includes(n));
      return f ? f.contentDocument.documentElement.outerHTML : '';
    }, nomor);
  }
  // Label dirender di halaman sendiri seukuran kertasnya, lalu diukur dan dicetak ke PDF.
  async function ukurLabel(html) {
    const lp = await ctx.newPage();
    // Dimuat lewat navigasi sungguhan: skrip awal (pengganti dialog cetak)
    // hanya terpasang di dokumen hasil navigasi, tidak lewat setContent.
    await lp.addInitScript(() => { window.print = () => { window.__dicetak = (window.__dicetak || 0) + 1; }; });
    await lp.route('http://label.uji/', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await lp.setViewportSize({ width: 378, height: 567 });
    await lp.goto('http://label.uji/', { waitUntil: 'load' });
    await lp.waitForFunction(() => window.__dicetak >= 1, null, { timeout: 5000 }).catch(() => {});
    const u = await lp.evaluate(() => {
      const l = document.querySelector('.label');
      const lain = document.querySelector('.lain');
      return {
        ada: !!l,
        meluap: l ? l.scrollHeight - l.clientHeight : -1,
        meluapLebar: l ? l.scrollWidth - l.clientWidth : -1,
        baris: document.querySelectorAll('.isi tr').length,
        barisTerlihat: l ? Array.from(document.querySelectorAll('.isi tr')).filter((tr) => { const r = tr.getBoundingClientRect(); return r.height > 0 && r.bottom <= l.getBoundingClientRect().bottom - 1; }).length : 0,
        barisCatatan: (() => { const c = document.querySelector('.catatan .teks'); return c ? Math.round(c.getBoundingClientRect().height / parseFloat(getComputedStyle(c).lineHeight)) : 0; })(),
        // Ringkasan "+ N barang lain" terlihat utuh di dalam label dan di dalam kotak isi paket.
        lainTerlihat: (() => { const isi = document.querySelector('.isi'); if (!lain || lain.hidden || !isi) return false; const r = lain.getBoundingClientRect(); return r.height > 0 && r.bottom <= isi.getBoundingClientRect().bottom + 1 && r.bottom <= l.getBoundingClientRect().bottom; })(),
        hurufAlamatPt: (() => { const a = document.querySelector('.penerima .alamat'); return a ? Math.round(parseFloat(getComputedStyle(a).fontSize) * 0.75 * 10) / 10 : 0; })(),
        alamatUtuh: (() => { const a = document.querySelector('.penerima .alamat'); return a ? a.scrollHeight <= a.clientHeight + 1 && a.getBoundingClientRect().bottom <= l.getBoundingClientRect().bottom : false; })(),
        lain: lain && !lain.hidden ? lain.textContent.trim() : '',
        xss: window.__xss === 1,
        dicetak: window.__dicetak || 0,
      };
    });
    const pdf = await lp.pdf({ preferCSSPageSize: true, printBackground: true });
    u.halaman = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    await lp.close();
    return u;
  }

  try {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.goto(BASE_URL + '/orders', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });

    // ---------- 1. Pesanan website ----------
    await bukaDetail(`WEB-${TAG}`);
    record('Detail pesanan website beralamat punya tombol "Cetak Label Kirim"', (await tombolLabel().count()) === 1);
    const lw = (await tombolLabel().count()) ? await htmlLabel(`WEB-${TAG}`) : '';
    const teksW = lw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    record('Label berukuran 100 x 150 mm', /@page\s*\{\s*size:\s*100mm 150mm/.test(lw), (/@page[^}]*\}/.exec(lw) || ['(tanpa @page)'])[0]);
    record('Penerima: nama, telepon, dan alamat dari pesanan',
      teksW.includes('Nanang ' + TAG) && teksW.includes('081314249663') && teksW.includes('Jl janoko No. 5, Kabupaten Banyumas, Jawa Tengah'), teksW.slice(0, 220));
    record('Kota dan provinsi tidak dicetak dua kali (sudah ada di alamat)',
      teksW.split('Kabupaten Banyumas').length - 1 === 1 && !/KABUPATEN BANYUMAS/.test(teksW), 'kemunculan: ' + (teksW.split('Kabupaten Banyumas').length - 1));
    record('Pengirim: nama dan alamat toko', teksW.includes(TOKO[0]) && (!TOKO[1] || teksW.includes(TOKO[1])), TOKO.join(' | '));
    record('Isi paket ber-SKU dan berjumlah (2× L1, 1× L2), urut SKU', /2×\s*L1-/.test(teksW) && /1×\s*L2-/.test(teksW) && teksW.indexOf('L1-' + TAG) < teksW.indexOf('L2-' + TAG));
    record('Catatan pesanan ikut tercetak', teksW.includes('Bubble wrap tebal ya'));
    record('Label tanpa harga (ditempel di luar paket)', !/Rp/.test(teksW) && !/655\.000/.test(teksW));

    // ---------- 2. Pesanan WhatsApp dari kasir: alamat pelanggan ----------
    // Pelanggannya dihapus dulu dari salinan lokal, meniru PC packing yang
    // Riwayat-nya terbuka sejak pagi: pesanan baru tertarik tiap 20 detik,
    // pelanggan barunya tidak. Detail harus mengambil pelanggan itu sendiri.
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate((id) => new Promise((selesai) => {
      const req = indexedDB.open('kasir');
      req.onsuccess = () => {
        const tx = req.result.transaction('customers', 'readwrite');
        tx.objectStore('customers').delete(id);
        tx.oncomplete = () => { req.result.close(); selesai(true); };
      };
    }), CUST);
    await bukaDetail(`WA-${TAG}`);
    await tombolLabel().waitFor({ timeout: 8000 }).catch(() => {});
    const adaA = (await tombolLabel().count()) === 1;
    record('Pesanan kasir berpelanggan beralamat punya tombol label, walau pelanggannya belum ada di salinan lokal', adaA);
    const teksA = adaA ? (await htmlLabel(`WA-${TAG}`)).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : '';
    record('Label memakai nama, telepon, dan alamat utama pelanggan, plus kota dan provinsinya',
      teksA.includes('Bengkel Aldo ' + TAG) && teksA.includes('081277770001') && teksA.includes('Jl. Melati No. 7, Purwokerto Selatan') && /Kabupaten Banyumas, Jawa Tengah/i.test(teksA),
      teksA.slice(0, 220));

    // ---------- 3. Tanpa alamat dan pesanan batal ----------
    await bukaDetail(`KASIR-${TAG}`);
    record('Pesanan kasir tanpa pelanggan dan tanpa alamat tidak menawarkan label', (await tombolLabel().count()) === 0);
    await bukaDetail(`BATAL-${TAG}`);
    record('Pesanan batal tidak menawarkan label', (await tombolLabel().count()) === 0);
    await bukaDetail(`TUNGGU-${TAG}`);
    const adaKonfirmasi = await modal().getByRole('button', { name: /Konfirmasi Pesanan/i }).count();
    record('Pesanan web yang masih menunggu konfirmasi belum menawarkan label',
      adaKonfirmasi === 1 && (await tombolLabel().count()) === 0, `tombol Konfirmasi=${adaKonfirmasi}, tombol label=${await tombolLabel().count()}`);

    // ---------- 4. Pesanan 30 barang tetap satu label ----------
    await bukaDetail(`GROSIR-${TAG}`);
    const lb = (await tombolLabel().count()) ? await htmlLabel(`GROSIR-${TAG}`) : '';
    const ub = lb ? await ukurLabel(lb) : { ada: false };
    const sisaBarang = ub.baris ? 30 - ub.baris : -1;
    record('30 barang: label tidak meluap dan PDF-nya satu halaman',
      ub.ada && ub.meluap <= 1 && ub.meluapLebar <= 1 && ub.halaman === 1, JSON.stringify(ub));
    record('30 barang: barang yang tidak muat disebut jumlahnya, angkanya cocok',
      ub.baris > 0 && ub.baris < 30 && ub.lain === `+ ${sisaBarang} barang lain (${sisaBarang * 10} pcs), rinciannya di faktur.`, `${ub.baris} baris, "${ub.lain}"`);
    record('Label memanggil dialog cetak sekali', ub.dicetak === 1, String(ub.dicetak));

    // ---------- 5. Isian pembeli tidak dijalankan sebagai HTML ----------
    await bukaDetail(`XSS-${TAG}`);
    const le = (await tombolLabel().count()) ? await htmlLabel(`XSS-${TAG}`) : '';
    const ue = le ? await ukurLabel(le) : { xss: true };
    record('Nama dan alamat berisi tag HTML dicetak sebagai teks',
      !!le && le.includes('&lt;img src=x') && !/<img src=x/.test(le) && le.includes('&lt;b&gt;Jl. Tebal') && ue.xss === false, `xss=${ue.xss}`);

    // ---------- 5b. Alamat dan catatan sangat panjang ----------
    await bukaDetail(`TEPI-${TAG}`);
    const lt = (await tombolLabel().count()) ? await htmlLabel(`TEPI-${TAG}`) : '';
    const ut = lt ? await ukurLabel(lt) : { ada: false };
    record('Alamat 400 karakter + catatan 330 karakter: label tidak meluap, satu halaman',
      ut.ada && ut.meluap <= 1 && ut.halaman === 1, JSON.stringify(ut));
    record('Catatan dibatasi tiga baris dan alamat tetap utuh',
      ut.barisCatatan > 0 && ut.barisCatatan <= 3 && ut.alamatUtuh === true && lt.includes(ALAMAT_400.slice(-40)),
      `catatan ${ut.barisCatatan} baris, alamat utuh=${ut.alamatUtuh}`);
    // Tidak boleh ada baris barang yang terpotong setengah: yang tersisa harus
    // terlihat utuh, dan barang yang tidak tampil disebut jumlahnya.
    // Barang di pesanan ini: L1 x3 dan L2 x2 (urut SKU). Ringkasan yang benar bergantung pada berapa baris yang tampil.
    const ringkasanHarapan = { 2: '', 1: '+ 1 barang lain (2 pcs), rinciannya di faktur.', 0: 'Rincian 2 barang (5 pcs) ada di faktur.' }[ut.baris];
    record('Tidak ada baris barang terpotong, dan barang yang tidak tampil tetap disebut jumlahnya',
      ut.barisTerlihat === ut.baris && ut.lain === ringkasanHarapan && (ut.baris === 2 || ut.lainTerlihat === true),
      `${ut.baris} baris tersisa, ${ut.barisTerlihat} terlihat utuh, ringkasan terlihat=${ut.lainTerlihat}: "${ut.lain}"`);
    record('Alamat sangat panjang: hurufnya dikecilkan seperlunya (tidak di bawah 9pt) supaya minimal satu barang terbaca',
      ut.baris >= 1 && ut.hurufAlamatPt >= 9 && ut.hurufAlamatPt <= 12, `huruf alamat ${ut.hurufAlamatPt}pt, ${ut.baris} baris barang`);

    // ---------- 6. HP 393px ----------
    await page.keyboard.press('Escape').catch(() => {});
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(500);
    await bukaDetail(`WEB-${TAG}`);
    const ukuranTombol = await modal().locator('button').evaluateAll((els) => els
      .filter((b) => /Cetak Label Kirim|Cetak Thermal|Cetak Faktur/.test(b.textContent || ''))
      .map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().slice(0, 18), h: Math.round(r.height), kanan: Math.round(r.right) }; }));
    const label393 = ukuranTombol.find((u) => /Label/.test(u.t));
    const tetangga = ukuranTombol.filter((u) => !/Label/.test(u.t));
    record('HP: tombol label setinggi tombol cetak lain dan tidak keluar layar',
      !!label393 && tetangga.length === 2 && tetangga.every((u) => u.h === label393.h) && label393.kanan <= 393, JSON.stringify(ukuranTombol));

    console.log('');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + String(e.message || e).slice(0, 300));
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + Math.max(hasil.length, 22) + ' lolos');
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`delete from public.order_items where order_id in ('${W}','${A}','${O}','${X}','${B}','${E}','${T}','${M}');`);
      psql(`delete from public.orders where id in ('${W}','${A}','${O}','${X}','${B}','${E}','${T}','${M}');`);
      psql(`delete from public.products where sku like '%-${TAG}';`);
      psql(`delete from public.customers where id = '${CUST}';`);
    } catch (e) {
      console.log('Pembersihan gagal: ' + String(e.message || e).slice(0, 200));
    }
  }
})();
