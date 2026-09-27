// Penjaga permintaan client: tiap butir di PERMINTAAN-CLIENT.md diperiksa
// langsung di layar, bukan lewat nama fitur.
//
// Dibuat setelah sebuah perbaikan teknis - membuang gambar dari blok deskripsi
// produk - ikut membatalkan permintaan client nomor 10, yaitu tombol
// "Lihat lebih banyak". Suite hijau waktu itu tidak menangkapnya karena tidak
// ada satu pun asersi yang menjaga permintaan aslinya.
// Verifikasi 1:1 terhadap PERMINTAAN-CLIENT.md, bagian yang terlihat pemakai.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BASE_URL, trackApi, loginAdmin } = require('./lib/harness.cjs');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const dbPw = /:\/\/[^:]+:([^@]*)@/.exec(envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')))[1];
const sql = (q) => execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q],
  { env: { ...process.env, PGPASSWORD: dbPw }, encoding: 'utf8' }).trim();
const OUT = path.join(__dirname, '..', 'audit_screenshots', 'permintaan');

const hasil = [];
const cek = (butir, nama, ok, bukti) => {
  hasil.push({ butir, nama, ok, bukti });
  console.log((ok ? 'OK    ' : 'GAGAL ') + '[' + butir + '] ' + nama + ' -- ' + bukti);
};

(async () => {
  const pid = sql("select id from public.products where is_active order by length(description) desc limit 1;");
  const browser = await chromium.launch();

  // ================= Toko online =================
  const ctxHp = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const hp = await ctxHp.newPage();
  await hp.goto(BASE_URL + '/toko', { waitUntil: 'domcontentloaded' });
  await hp.waitForSelector('main', { timeout: 45000 }).catch(() => {});
  await hp.waitForTimeout(3000);

  const kaki = await hp.evaluate(() => {
    const teks = document.body.innerText || '';
    const tautan = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({ t: (a.innerText || '').trim(), h: a.getAttribute('href') || '' }));
    const sos = ['facebook', 'instagram', 'tiktok', 'youtube']
      .filter((n) => tautan.some((x) => x.h.toLowerCase().includes(n)));
    const jelajahi = tautan.filter((x) => /gnnkracing\.id/.test(x.h));
    return {
      sos,
      adaJelajahi: /Jelajahi/i.test(teks),
      jumlahArtikel: jelajahi.length,
      contoh: jelajahi.slice(0, 2).map((x) => x.t + ' -> ' + x.h.slice(0, 50)),
    };
  });
  cek(7, 'Media sosial FB/IG/TikTok/YouTube di kaki halaman', kaki.sos.length === 4, kaki.sos.join(', ') || 'tidak ada');
  cek(8, 'Jelajahi GNNK Racing jadi tautan artikel', kaki.adaJelajahi && kaki.jumlahArtikel > 0,
    kaki.jumlahArtikel + ' tautan ke gnnkracing.id, mis. ' + (kaki.contoh[0] || '-'));

  // Deteksi yang sama seperti dipakai untuk produksi: tautan wa.me, bukan teks.
  const chatNyala = await hp.evaluate(() => Array.from(document.querySelectorAll('a,button'))
    .some((e) => /wa.me|whatsapp/i.test(e.getAttribute('href') || '')));
  const saklar = sql("select coalesce(chat_enabled::text,'kosong') from public.stores order by created_at limit 1;");
  cek(9, 'Tombol chat mengikuti saklar Pengaturan',
    (saklar === 'true' && chatNyala) || (saklar === 'false' && !chatNyala),
    'chat_enabled=' + saklar + ', tombol di toko=' + (chatNyala ? 'ada' : 'tidak ada'));

  await hp.goto(BASE_URL + '/toko/produk?id=' + pid, { waitUntil: 'domcontentloaded' });
  await hp.waitForSelector('main', { timeout: 45000 }).catch(() => {});
  await hp.waitForTimeout(3000);
  const produkHp = await hp.evaluate(() => {
    const blok = Array.from(document.querySelectorAll('div'))
      .find((d) => /relative space-y-3 overflow-hidden/.test(String(d.className)) && d.getBoundingClientRect().width > 0);
    const tombol = Array.from(document.querySelectorAll('button')).find((x) => /Lihat lebih banyak/i.test(x.innerText || ''));
    const lipat = Array.from(document.querySelectorAll('button'))
      .filter((b) => /^(Spesifikasi|Apa yang ada di dalam kotak|Kualifikasi|Sorotan)/i.test((b.innerText || '').trim()));
    return {
      tampak: blok ? Math.round(blok.getBoundingClientRect().height) : null,
      isi: blok ? blok.scrollHeight : null,
      adaTombol: !!tombol,
      gambar: blok ? blok.querySelectorAll('img').length : null,
      jumlahLipat: lipat.length,
      label: lipat.slice(0, 4).map((b) => (b.innerText || '').trim().split('\n')[0]),
      aria: lipat.slice(0, 4).map((b) => b.getAttribute('aria-expanded')),
    };
  });
  cek(10, 'Deskripsi tidak tampil penuh langsung, ada tombol',
    produkHp.adaTombol && produkHp.tampak < produkHp.isi,
    'tampak ' + produkHp.tampak + 'px dari ' + produkHp.isi + 'px, gambar di deskripsi=' + produkHp.gambar);

  if (produkHp.adaTombol) {
    await hp.getByRole('button', { name: /Lihat lebih banyak/i }).first().click();
    await hp.waitForTimeout(900);
    const sesudah = await hp.evaluate(() => {
      const blok = Array.from(document.querySelectorAll('div'))
        .find((d) => /relative space-y-3 overflow-hidden/.test(String(d.className)) && d.getBoundingClientRect().width > 0);
      const tutup = Array.from(document.querySelectorAll('button')).some((x) => /Lihat lebih sedikit/i.test(x.innerText || ''));
      return { tampak: blok ? Math.round(blok.getBoundingClientRect().height) : null, isi: blok ? blok.scrollHeight : null, tutup };
    });
    cek(10, 'Tombol membuka deskripsi sampai penuh',
      sesudah.tampak >= sesudah.isi - 2 && sesudah.tutup,
      'sesudah diklik ' + sesudah.tampak + 'px dari ' + sesudah.isi + 'px, tombol jadi Lihat lebih sedikit=' + sesudah.tutup);
  }
  cek(11, 'Detail Produk bisa diklik buka-tutup di HP', produkHp.jumlahLipat >= 2,
    produkHp.jumlahLipat + ' bagian: ' + produkHp.label.join(', ') + ' | aria-expanded=' + produkHp.aria.join(','));
  await hp.screenshot({ path: OUT + '_produk_hp.png' });
  await ctxHp.close();

  const flash = sql('select count(*) from public.flash_sales;');
  const flashItem = sql('select count(*) from public.flash_sale_items;');
  const kolomKuota = sql("select count(*) from information_schema.columns where table_name='flash_sale_items' and column_name in ('quota_qty','sold_qty');");
  cek(1, 'Flash sale punya kuota terjual per item', kolomKuota === '2',
    flash + ' sesi, ' + flashItem + ' item, kolom kuota+terjual=' + kolomKuota);

  // ================= Admin =================
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  trackApi(page);
  await loginAdmin(page);

  // Butir 10 di layar lebar: di sana semua bagian Detail Produk selalu
  // terbuka, jadi yang dipotong SELURUH bloknya. Yang diukur jarak gulir
  // yang hilang, bukan berapa baris yang disembunyikan.
  await page.goto(BASE_URL + '/toko/produk?id=' + pid, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#detail-produk', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const bacaDetail = () => {
    const blok = document.getElementById('detail-produk');
    if (!blok) return null;
    const bungkus = blok.querySelector('div.relative.space-y-5.overflow-hidden');
    const dt = Array.from(blok.querySelectorAll('dt')).find((x) => /^Motor$/i.test((x.innerText || '').trim()));
    return {
      tinggiBlok: Math.round(blok.getBoundingClientRect().height),
      tampak: bungkus ? Math.round(bungkus.getBoundingClientRect().height) : null,
      isi: bungkus ? bungkus.scrollHeight : null,
      motorTerlihat: dt && bungkus ? dt.parentElement.getBoundingClientRect().bottom <= bungkus.getBoundingClientRect().bottom + 1 : null,
      tinggiHalaman: document.documentElement.scrollHeight,
    };
  };
  const tutup = await page.evaluate(bacaDetail);
  const tombolDetail = page.locator('#detail-produk button').filter({ hasText: /Lihat lebih banyak/i });
  const adaTombolDetail = (await tombolDetail.count()) > 0;
  let buka = null;
  if (adaTombolDetail) {
    await tombolDetail.first().click();
    await page.waitForTimeout(900);
    buka = await page.evaluate(bacaDetail);
  }
  cek(10, 'Detail Produk di layar lebar dipotong, tidak dibiarkan penuh', adaTombolDetail && !!tutup && tutup.tampak < tutup.isi,
    tutup ? ('tampak ' + tutup.tampak + 'px dari ' + tutup.isi + 'px, blok ' + tutup.tinggiBlok + 'px') : 'blok tidak ditemukan');
  cek(10, 'Potongan itu memangkas jarak gulir dengan berarti', !!buka && buka.tinggiHalaman - tutup.tinggiHalaman > 500,
    tutup && buka ? ('halaman ' + tutup.tinggiHalaman + 'px tertutup vs ' + buka.tinggiHalaman + 'px terbuka, hemat ' + (buka.tinggiHalaman - tutup.tinggiHalaman) + 'px') : 'tidak terukur');
  cek(10, 'Yang terlihat sampai baris spesifikasi Motor', tutup ? tutup.motorTerlihat === true : false,
    tutup ? ('motorTerlihat=' + tutup.motorTerlihat) : '-');

  await page.goto(BASE_URL + '/products', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[class*="max-w-[1400px]"] table tbody tr', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const grup = await page.evaluate(() => {
    const baris = Array.from(document.querySelectorAll('tbody tr'));
    const varian = baris.filter((tr) => /\d+ varian/.test(tr.innerText || ''));
    return {
      total: baris.length, kelompok: varian.length,
      contoh: varian.slice(0, 1).map((t) => (t.innerText || '').replace(/\n/g, ' ').slice(0, 50)),
    };
  });
  cek(5, 'Produk dikelompokkan: satu nama, banyak SKU', grup.kelompok > 0,
    grup.kelompok + ' baris kelompok dari ' + grup.total + ' baris, mis. ' + (grup.contoh[0] || '-'));

  await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const adaNota = await page.getByRole('button', { name: /Nota Baru/i }).count();
  if (adaNota) {
    await page.getByRole('button', { name: /Nota Baru/i }).first().click();
    await page.waitForTimeout(2500);
  }
  const form = await page.evaluate(() => {
    const teks = document.body.innerText || '';
    const label = Array.from(document.querySelectorAll('label')).map((l) => (l.innerText || '').trim());
    return {
      template: /Template|Impor item|Unggah/i.test(teks),
      dp: label.some((l) => /DP|Uang Muka/i.test(l)) || /DP/.test(teks),
      biaya: label.filter((l) => /Biaya|Ongkir|Nama biaya/i.test(l)),
      mataUang: /USD|Mata Uang|Kurs/i.test(teks),
    };
  });
  cek(6, 'Unggah template item di form nota PO', form.template, 'penanda Template/Impor/Unggah=' + form.template);
  cek(3, 'Kolom DP ada di form nota', form.dp, 'penanda DP/Uang Muka=' + form.dp);
  cek(4, 'Dua baris biaya bernama di form nota', form.biaya.length >= 2,
    form.biaya.length + ' label biaya: ' + form.biaya.slice(0, 4).join(' | '));
  cek(2, 'Form nota mengenal mata uang asing', form.mataUang, 'penanda USD/Kurs=' + form.mataUang);
  await page.screenshot({ path: OUT + '_form_po.png' });

  // Butir 12 dibuktikan dengan menjalankan alurnya, bukan menebak dari data
  // yang kebetulan ada: suite ini membuat nota bersama biayanya lalu memeriksa
  // pengeluaran bertanggal yang lahir darinya.
  let keluaran = '';
  try {
    keluaran = execFileSync('node', ['scripts/verify_purchase_cost_expense.cjs'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  } catch (e) { keluaran = (e.stdout || '') + (e.stderr || ''); }
  const m = new RegExp(String.raw`(\d+)/(\d+) lolos`).exec(keluaran);
  cek(12, 'Biaya nota PO jadi pengeluaran bertanggal', !!m && m[1] === m[2],
    // Kata 'lolos' sengaja dihindari: runner run_all_checks membaca pola
    // itu dan akan mengira angka suite lain adalah angka suite ini.
    'verify_purchase_cost_expense ' + (m ? m[1] + ' dari ' + m[2] + ' asersi' : 'tidak selesai'));

  await browser.close();
  console.log('');
  console.log('--- RINGKASAN ---');
  const lolos = hasil.filter((h) => h.ok).length;
  console.log(lolos + '/' + hasil.length + ' lolos');
  process.exitCode = lolos === hasil.length ? 0 : 1;
  hasil.filter((h) => !h.ok).forEach((h) => console.log('  GAGAL butir ' + h.butir + ': ' + h.nama + ' -- ' + h.bukti));
})();
