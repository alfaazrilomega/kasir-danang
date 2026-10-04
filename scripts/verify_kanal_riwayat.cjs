// Verifikasi butir 17 PERMINTAAN-CLIENT.md: asal pesanan (channel) terlihat di
// daftar Riwayat Transaksi, bukan hanya di detail.
//
// Kutipan client (video 3 Okt, spreadsheet 6.4): "di bagian channel atau
// TikToknya tidak terlihat ya. Terlihat ini itu ketika dibuka di bagian
// detail … di bagian sini dimunculkan di saluran tersebut. Adanya pun muncul
// orderan dari Shopee, TikTok, WhatsApp, ataupun dari website … Biar nantinya
// ada pemisahan sendiri terlihat di sini."
//
// Yang diuji:
//   - Desktop 1440px ke atas: kolom "Channel" memuat nama channel tiap pesanan.
//   - HP: nama channel ikut tampil di sel nomor pesanan, tabel tidak melebar.
//   - Laptop 1280px dan 1366px: tanggal tidak terlipat tiga baris walau ada pesanan
//     menunggu konfirmasi. Tablet 1024px: tampilan channel tidak menambah lebar.
//   - Kode channel yang tidak dikenal tetap tampil, tidak kosong.
//   - Filter Channel yang sudah ada tetap cocok dengan isi kolomnya.
//   - Akun kasir di HP: halaman Riwayat dan detail pesanan tidak melewati layar.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, ADMIN_PASSWORD, DB_PASSWORD, BASE_URL } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const TAG = 'UJIKNL' + Date.now().toString().slice(-6);
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined ? ' — ' + ket : ''));
};

(async () => {
  const STORE = psql('select id from public.stores order by created_at limit 1;');
  const namaKanal = (kode) => psql(`select name from public.sales_channels where store_id = '${STORE}' and code = '${kode}';`);
  const KODE_ASING = 'kanal-lama-' + TAG.slice(-4);
  // Isi baris dibuat seperti data asli: nomor platform 18 digit dari impor
  // marketplace, nomor kasir yang panjang, dan pesanan web yang menunggu
  // konfirmasi (baris itu punya tombol Konfirmasi dan Tolak). Baris pendek
  // tidak pernah membuat tabel melebar, jadi tidak menguji apa pun.
  const angka = Date.now().toString().slice(-9);
  const KASUS = [
    { kode: 'shopee', nomor: `586${angka}421923`, ext: true },
    { kode: 'tiktok', nomor: `5786${angka}31045`, ext: true },
    { kode: 'whatsapp', nomor: `#261004-${angka.slice(0, 6)}-GNNKRacing-Offline` },
    { kode: 'website', nomor: `WEB-${angka}D8`, status: 'awaiting_confirmation' },
    { kode: 'offline', nomor: `GN2610${angka.slice(0, 5)}` },
    { kode: KODE_ASING, nomor: `LAMA-${angka}` },
  ].map((k) => ({ ...k, nama: namaKanal(k.kode) || k.kode, id: psql('select gen_random_uuid();') }));
  const P1 = psql('select gen_random_uuid();');
  const CUST = psql('select gen_random_uuid();');
  psql(`insert into public.products (id, store_id, name, sku, base_price, cost_price, stock_qty, track_stock, is_active)
        values ('${P1}', '${STORE}', 'Gear Uji ${TAG}', 'K1-${TAG}', 195000, 100000, 100, true, true);`);
  // Pencarian Riwayat mencocokkan nama pelanggan tertaut, jadi semua pesanan
  // uji ditemukan lewat TAG tanpa harus menaruh TAG di nomor pesanannya.
  psql(`insert into public.customers (id, store_id, name, phone, joined_date, is_active, points, created_at)
        values ('${CUST}', '${STORE}', 'Bengkel Motor Jaya Abadi ${TAG}', '0812${angka.slice(0, 7)}', current_date, true, 0, now());`);
  KASUS.forEach((k, i) => {
    psql(`insert into public.orders (id, store_id, customer_id, order_number, external_order_no, subtotal, tax, discount, total, payment_method,
            payment_status, order_status, order_type, sales_channel, payment_term, tax_inclusive, created_at)
          values ('${k.id}', '${STORE}', '${CUST}', '${k.nomor}', ${k.ext ? `'${k.nomor}'` : 'null'}, 1245000, 0, 0, 1245000, 'transfer',
            '${k.status ? 'unpaid' : 'paid'}', '${k.status || 'done'}', 'take_away', '${k.kode}', 'cash', false, now() - interval '${10 + i} minutes');`);
    psql(`insert into public.order_items (id, order_id, product_id, name, size, qty, price, cost_price, note)
          values (gen_random_uuid(), '${k.id}', '${P1}', 'Gear Uji ${TAG}', null, 1, 1245000, 100000, null);`);
  });

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  trackApi(page);
  const barisPesanan = (nomor) => page.locator('tbody tr').filter({ hasText: nomor }).first();
  async function cari() {
    await page.getByPlaceholder(/Cari ID/i).first().fill(TAG);
    await page.waitForTimeout(900);
  }
  const ukurTabel = () => page.evaluate(() => {
    const t = document.querySelector('tbody')?.closest('table');
    return t ? { gulir: t.parentElement.scrollWidth, tampak: t.parentElement.clientWidth } : null;
  });

  try {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.goto(BASE_URL + '/orders', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await cari();

    // ---------- 1. Desktop 1440 ----------
    const judul = await page.locator('thead th').allInnerTexts();
    const iKanal = judul.findIndex((t) => /^Channel$/i.test(t.trim()));
    record('Desktop: daftar punya kolom "Channel"', iKanal >= 0, judul.map((t) => t.trim()).join(' | '));
    const isiKolom = [];
    for (const k of KASUS) {
      const sel = iKanal >= 0 ? await barisPesanan(k.nomor).locator('td').nth(iKanal).innerText().catch(() => '') : '';
      isiKolom.push({ k, sel: sel.trim() });
    }
    record('Desktop: tiap pesanan menampilkan nama channel-nya di kolom itu',
      isiKolom.every(({ k, sel }) => sel === k.nama), isiKolom.map(({ k, sel }) => `${k.kode}→"${sel}"`).join(', '));
    record('Kode channel yang tidak dikenal tetap tampil, tidak kosong',
      isiKolom.find(({ k }) => k.kode === KODE_ASING)?.sel === KODE_ASING);
    // Sel channel tidak boleh memotong nama yang panjang.
    const terpotong = await page.evaluate((i) => Array.from(document.querySelectorAll('tbody tr')).filter((tr) => {
      const td = tr.children[i];
      return td && Array.from(td.querySelectorAll('*')).some((el) => el.scrollWidth > el.clientWidth + 1);
    }).length, iKanal);
    record('Desktop: nama channel tidak terpotong', iKanal >= 0 && terpotong === 0, `${terpotong} sel terpotong`);
    const u1440 = await ukurTabel();
    record('Desktop 1440: tabel tidak melebar', !!u1440 && u1440.gulir <= u1440.tampak, JSON.stringify(u1440));

    // ---------- 2. Filter Channel yang sudah ada ----------
    const pilihKanal = page.locator('select').filter({ has: page.locator('option[value="all"]', { hasText: 'Semua' }) })
      .filter({ has: page.locator('option[value="shopee"]') }).first();
    await pilihKanal.selectOption('shopee');
    await page.waitForTimeout(700);
    const sisa = await page.locator('tbody tr').filter({ hasText: TAG }).allInnerTexts();
    const namaShopee = KASUS[0].nama;
    record('Filter Shopee: hanya pesanan Shopee yang tersisa, dan kolomnya bertulis channel itu',
      sisa.length === 1 && sisa[0].includes(KASUS[0].nomor) && sisa[0].includes(namaShopee), `${sisa.length} baris`);
    await pilihKanal.selectOption('all');
    await page.waitForTimeout(500);

    // ---------- 3. Laptop 1280 dan tablet mendatar 1024 ----------
    // Di laptop 1280 dan 1366 kolom Channel sempat menjepit kolom lain begitu
    // ada pesanan menunggu konfirmasi (kolom Aksi melebar oleh tombol
    // Konfirmasi dan Tolak): tanggal terlipat tiga baris. Di lebar ini channel
    // ditulis di bawah nomor pesanan, kolomnya baru tampil mulai 1440px.
    const barisTanggal = () => page.evaluate((tag) => {
      const judul = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      const i = judul.indexOf('Tanggal');
      return Array.from(document.querySelectorAll('tbody tr')).filter((tr) => (tr.textContent || '').includes(tag)).map((tr) => {
        const td = tr.children[i];
        const r = document.createRange();
        r.selectNodeContents(td);
        return Math.round(r.getBoundingClientRect().height / parseFloat(getComputedStyle(td).lineHeight));
      });
    }, TAG);
    for (const lebar of [1280, 1366]) {
      await page.setViewportSize({ width: lebar, height: 800 });
      await page.waitForTimeout(600);
      const u = await ukurTabel();
      const baris = await barisTanggal();
      const adaKolom = (await page.locator('thead th').filter({ hasText: /^Channel$/ }).filter({ visible: true }).count()) > 0;
      const namaTerlihat = (await barisPesanan(KASUS[2].nomor).innerText().catch(() => '')).includes(KASUS[2].nama);
      record(`Laptop ${lebar}: tabel tidak melebar, tanggal paling banyak dua baris, channel tetap terlihat`,
        !!u && u.gulir <= u.tampak && baris.length === KASUS.length && Math.max(...baris) <= 2 && namaTerlihat,
        `${JSON.stringify(u)}, baris tanggal ${baris.join('/')}, kolom Channel tampil=${adaKolom}, channel terlihat=${namaTerlihat}`);
    }
    // Di 1440 kolomnya tampil; tanggal tetap tidak boleh terlipat tiga baris.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    const baris1440 = await barisTanggal();
    const kolom1440 = (await page.locator('thead th').filter({ hasText: /^Channel$/ }).filter({ visible: true }).count()) > 0;
    record('Desktop 1440: kolom Channel tampil dan tanggal paling banyak dua baris walau ada pesanan menunggu konfirmasi',
      kolom1440 && baris1440.length === KASUS.length && Math.max(...baris1440) <= 2, `kolom=${kolom1440}, baris tanggal ${baris1440.join('/')}`);

    // Di 1024 kolom Pelanggan sudah tampil dan ruangnya sempit; kolom Channel
    // pernah membuat tabel melebar 71px di lebar ini.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(600);
    // Baris uji yang panjang (tombol Konfirmasi dan Tolak, nomor kasir 33
    // karakter) sudah melebarkan tabel di 1024 sebelum butir ini, jadi yang
    // diuji adalah tambahan lebar dari tampilan channel: harus nol.
    const u1024 = await ukurTabel();
    const gaya1024 = await page.addStyleTag({ content: '[data-kanal]{display:none!important}' });
    await page.waitForTimeout(300);
    const u1024Tanpa = await ukurTabel();
    await gaya1024.evaluate((el) => el.remove());
    await page.waitForTimeout(200);
    const kanal1024 = await barisPesanan(KASUS[2].nomor).innerText().catch(() => '');
    record('Tablet 1024: tampilan channel tidak menambah lebar tabel, dan nama channel tetap terlihat',
      !!u1024 && !!u1024Tanpa && u1024.gulir <= u1024Tanpa.gulir && kanal1024.includes(KASUS[2].nama),
      `dengan channel ${JSON.stringify(u1024)}, tanpa ${JSON.stringify(u1024Tanpa)}, channel ada=${kanal1024.includes(KASUS[2].nama)}`);

    // ---------- 4. HP 393 ----------
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(600);
    const selPertama = [];
    for (const k of KASUS) {
      const td = barisPesanan(k.nomor).locator('td').filter({ hasText: k.nomor }).first();
      selPertama.push({ k, teks: (await td.innerText().catch(() => '')).replace(/\s+/g, ' ') });
    }
    record('HP: nama channel tampil di sel nomor pesanan',
      selPertama.every(({ k, teks }) => teks.includes(k.nama)), selPertama.map(({ k, teks }) => `${k.kode}: ${teks.slice(0, 60)}`).join(' | '));
    // Tabel Riwayat di HP sudah melebar sebelum butir ini (temuan QC F18:
    // tombol Konfirmasi dan Tolak). Yang diuji: tampilan channel tidak
    // menambah lebar, dibanding tabel yang sama dengan channel disembunyikan.
    const u393 = await ukurTabel();
    const gaya393 = await page.addStyleTag({ content: '[data-kanal]{display:none!important}' });
    await page.waitForTimeout(300);
    const u393Tanpa = await ukurTabel();
    await gaya393.evaluate((el) => el.remove());
    record('HP 393: tampilan channel tidak menambah lebar tabel',
      !!u393 && !!u393Tanpa && u393.gulir <= u393Tanpa.gulir, `dengan channel ${JSON.stringify(u393)}, tanpa ${JSON.stringify(u393Tanpa)}`);
    const tampakKanal = await page.evaluate((nama) => {
      const el = Array.from(document.querySelectorAll('tbody td *')).find((x) => x.children.length === 0 && x.textContent.trim() === nama);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { kiri: Math.round(r.left), kanan: Math.round(r.right), lebarLayar: window.innerWidth, terpotong: el.scrollWidth > el.clientWidth + 1 };
    }, KASUS[2].nama);
    record('HP: nama channel terpanjang (WhatsApp) utuh di dalam layar',
      !!tampakKanal && tampakKanal.kanan <= tampakKanal.lebarLayar && !tampakKanal.terpotong, JSON.stringify(tampakKanal));

    // ---------- 5. Akun kasir di HP: halaman tidak melebar ----------
    // Baris saringan "Bayar" (7 pilihan) dulu tidak bisa menyusut. Di tata
    // letak kasir halaman ikut melebar jadi 432px di layar 393px, dan modal
    // detail pesanan (tempat tombol label dan channel) melewati tepi layar.
    const ctxKasir = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const kasir = await ctxKasir.newPage();
    trackApi(kasir);
    await kasir.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await kasir.fill('input[type="email"]', 'kasir@example.com');
    await kasir.fill('input[type="password"]', 'kasir12345');
    await kasir.click('button[type="submit"]');
    await kasir.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(kasir, { idleMs: 3000, minWaitMs: 2500 });
    await kasir.goto(BASE_URL + '/orders', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(kasir, { idleMs: 3000, minWaitMs: 2500 });
    await kasir.getByPlaceholder(/Cari ID/i).first().fill(TAG);
    await kasir.waitForTimeout(900);
    const lebarHalaman = await kasir.evaluate(() => ({ gulir: document.documentElement.scrollWidth, layar: window.innerWidth }));
    record('Kasir di HP 393: halaman Riwayat tidak melebar ke samping', lebarHalaman.gulir <= lebarHalaman.layar, JSON.stringify(lebarHalaman));
    const pilihanBayar = await kasir.evaluate(() => {
      const tombol = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Lainnya');
      if (!tombol) return null;
      const wadah = tombol.parentElement;
      return { gulirWadah: wadah.scrollWidth, tampakWadah: wadah.clientWidth, bisaDigeser: getComputedStyle(wadah).overflowX };
    });
    record('Kasir di HP: pilihan "Bayar" yang tidak muat bisa digeser di dalam barisnya',
      !!pilihanBayar && (pilihanBayar.gulirWadah <= pilihanBayar.tampakWadah || /auto|scroll/.test(pilihanBayar.bisaDigeser)), JSON.stringify(pilihanBayar));
    await kasir.locator('tbody tr').filter({ hasText: KASUS[3].nomor }).first().getByTitle('Detail').click();
    await kasir.waitForTimeout(900);
    const modalKasir = await kasir.evaluate(() => {
      const kotak = Array.from(document.querySelectorAll('div.fixed.inset-0')).pop();
      const tombol = kotak ? Array.from(kotak.querySelectorAll('button')) : [];
      const kanan = tombol.length ? Math.max(...tombol.map((b) => b.getBoundingClientRect().right)) : -1;
      return { tombol: tombol.length, kananTombol: Math.round(kanan), layar: window.innerWidth };
    });
    record('Kasir di HP: semua tombol di detail pesanan berada di dalam layar',
      modalKasir.tombol > 0 && modalKasir.kananTombol <= modalKasir.layar, JSON.stringify(modalKasir));
    await ctxKasir.close();

    console.log('');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + String(e.message || e).slice(0, 300));
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + Math.max(hasil.length, 16) + ' lolos');
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`delete from public.order_items where order_id in (${KASUS.map((k) => `'${k.id}'`).join(',')});`);
      psql(`delete from public.orders where id in (${KASUS.map((k) => `'${k.id}'`).join(',')});`);
      psql(`delete from public.products where id = '${P1}';`);
      psql(`delete from public.customers where id = '${CUST}';`);
    } catch (e) {
      console.log('Pembersihan gagal: ' + String(e.message || e).slice(0, 200));
    }
  }
})();
