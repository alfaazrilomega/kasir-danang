// Verifikasi butir 15 PERMINTAAN-CLIENT.md: pixel Meta, TikTok, dan Google Ads
// di toko online.
//
// Kutipan client (spreadsheet 8.1): "bt fitu pixel meta, tiktok, google ads bisa
// ada tanam kode bt di shop nya / jadi pelacakan nya skalian di store.gnnkracing.id".
//
// Skrip ketiga platform dicegat dan diganti skrip kosong, jadi panggilan yang
// dikirim aplikasi tertahan di antrean bawaan kode resmi masing-masing
// (fbq.queue, array ttq, dataLayer) dan bisa dibaca langsung.
//
// Yang diuji:
//   - Pengaturan Toko Online menyimpan keempat ID, dan menolak format salah.
//   - /toko memuat skrip resmi dengan ID yang benar dan mencatat lihat halaman.
//   - Halaman produk: ViewContent. Tombol keranjang: AddToCart.
//   - Checkout: InitiateCheckout. Pesanan dibuat: Purchase bernilai subtotal
//     pesanan, ber-ID pesanan, dan konversi Google Ads berlabel.
//   - Halaman admin tidak memuat pixel sama sekali.
//   - Toko tanpa ID tidak memuat skrip apa pun.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, ADMIN_PASSWORD, DB_PASSWORD, BASE_URL } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const CAP = Date.now().toString().slice(-6);
const META = '1234567890' + CAP.slice(0, 5);
const TIKTOK = 'CUJI' + CAP + 'PIXEL0000';
const GADS = 'AW-98765' + CAP.slice(0, 4);
const LABEL = 'UjiLabel_' + CAP;
const EMAIL = `uji.pixel.${CAP}@contoh.id`;
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined ? ' — ' + ket : ''));
};
const HOST_PIXEL = /connect\.facebook\.net|analytics\.tiktok\.com|googletagmanager\.com/;

async function cegahPixel(page, dicatat) {
  await page.route(HOST_PIXEL, (route) => {
    dicatat.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  // Gambar katalog dari gnnkracing.id kadang menggantung; tidak relevan untuk uji ini.
  await page.route(/gnnkracing\.id\/wp-content/, (route) => route.abort());
}

/** Isi antrean ketiga platform di halaman, disederhanakan jadi JSON. */
async function antrean(page) {
  return page.evaluate(() => {
    const keJson = (x) => {
      try { return JSON.parse(JSON.stringify(Array.from(x))); } catch { return []; }
    };
    return {
      fbq: window.fbq && window.fbq.queue ? window.fbq.queue.map(keJson) : null,
      ttq: Array.isArray(window.ttq) ? window.ttq.map(keJson) : null,
      gtag: Array.isArray(window.dataLayer) ? window.dataLayer.map(keJson) : null,
    };
  });
}
const cari = (daftar, nama) => (daftar || []).filter((a) => a[0] === 'track' && a[1] === nama);

(async () => {
  const STORE = psql('select id from public.stores order by created_at limit 1;');
  let awal = null;
  try {
    awal = psql(`select coalesce(meta_pixel_id,'') || '|' || coalesce(tiktok_pixel_id,'') || '|' ||
                        coalesce(google_ads_id,'') || '|' || coalesce(google_ads_purchase_label,'')
                   from public.stores where id = '${STORE}';`);
  } catch (e) {
    record('Kolom pixel ada di tabel stores', false, String(e.stderr || e.message).trim().split('\n')[0]);
  }

  const browser = await chromium.launch();
  let orderNumber = null;
  try {
    // ---------- 1. Pengaturan ----------
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const admin = await adminCtx.newPage();
    trackApi(admin);
    const pixelAdmin = [];
    await cegahPixel(admin, pixelAdmin);
    await admin.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await admin.fill('input[type="email"]', 'admin@example.com');
    await admin.fill('input[type="password"]', ADMIN_PASSWORD);
    await admin.click('button[type="submit"]');
    await admin.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(admin, { idleMs: 3000, minWaitMs: 2500 });
    await admin.goto(BASE_URL + '/settings', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(admin, { idleMs: 2500, minWaitMs: 2000 });

    const kolom = {
      meta: admin.getByLabel('Meta Pixel ID'),
      tiktok: admin.getByLabel('TikTok Pixel ID'),
      gads: admin.getByLabel('Google Ads ID'),
      label: admin.getByLabel('Label konversi pembelian Google Ads'),
    };
    const adaSemua = (await kolom.meta.count()) === 1 && (await kolom.tiktok.count()) === 1 &&
      (await kolom.gads.count()) === 1 && (await kolom.label.count()) === 1;
    record('Pengaturan Toko Online punya empat kolom pixel', adaSemua);
    if (adaSemua) {
      await kolom.gads.fill('GA-123');
      await admin.getByRole('button', { name: /^Simpan$/ }).first().click();
      await admin.waitForTimeout(1500);
      const toast = (await admin.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
      record('Format Google Ads ID yang salah ditolak dengan pesan jelas', /Google Ads/i.test(toast), toast.slice(0, 140));
      await kolom.meta.fill(META);
      await kolom.tiktok.fill(TIKTOK.toLowerCase());
      await kolom.gads.fill(GADS.toLowerCase());
      await kolom.label.fill(LABEL);
      await admin.getByRole('button', { name: /^Simpan$/ }).first().click();
      await waitForApiIdle(admin, { idleMs: 2500, minWaitMs: 2000 });
      const tersimpan = psql(`select coalesce(meta_pixel_id,'') || '|' || coalesce(tiktok_pixel_id,'') || '|' ||
                                     coalesce(google_ads_id,'') || '|' || coalesce(google_ads_purchase_label,'')
                                from public.stores where id = '${STORE}';`);
      record('Keempat ID tersimpan, TikTok dan Google dirapikan ke huruf besar',
        tersimpan === `${META}|${TIKTOK}|${GADS}|${LABEL}`, tersimpan);
    }

    // ---------- 2. Halaman admin tidak memuat pixel ----------
    await admin.goto(BASE_URL + '/menu', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(admin, { idleMs: 2500, minWaitMs: 2000 });
    record('Halaman admin (pengaturan, kasir) tidak memuat skrip pixel', pixelAdmin.length === 0, pixelAdmin.join(' , ').slice(0, 160));
    await adminCtx.close();

    // ---------- 3. Toko online ----------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const toko = await ctx.newPage();
    trackApi(toko);
    const pixelToko = [];
    await cegahPixel(toko, pixelToko);
    await toko.goto(BASE_URL + '/toko', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(toko, { idleMs: 2500, minWaitMs: 2000 });
    await toko.waitForTimeout(1000);
    record('Toko memuat skrip Meta Pixel', pixelToko.some((u) => /connect\.facebook\.net\/.*fbevents\.js/.test(u)));
    record('Toko memuat skrip TikTok Pixel dengan ID toko',
      pixelToko.some((u) => u.includes('analytics.tiktok.com/i18n/pixel/events.js') && u.includes('sdkid=' + TIKTOK)));
    record('Toko memuat skrip Google Ads dengan ID toko',
      pixelToko.some((u) => u.includes('googletagmanager.com/gtag/js') && u.includes('id=' + GADS)));
    let q = await antrean(toko);
    record('Meta: init dengan Pixel ID toko lalu PageView',
      (q.fbq || []).some((a) => a[0] === 'init' && a[1] === META) && cari(q.fbq, 'PageView').length >= 1);
    // Pixel Meta mengirim PageView sendiri tiap pushState; aplikasi sudah
    // mengirimnya per pindah halaman, jadi yang otomatis harus dimatikan.
    record('Meta: PageView otomatis pixel dimatikan supaya tidak ganda dengan kiriman aplikasi',
      (await toko.evaluate(() => !!window.fbq && window.fbq.disablePushState === true)) === true);
    record('TikTok: lihat halaman tercatat', (q.ttq || []).some((a) => a[0] === 'page'));
    record('Google Ads: config ID toko dan page_view',
      (q.gtag || []).some((a) => a[0] === 'config' && a[1] === GADS) &&
      (q.gtag || []).some((a) => a[0] === 'event' && a[1] === 'page_view'));

    // Produk
    await toko.locator('a[data-kartu-produk]').filter({ hasNotText: 'Stok habis' }).first().click();
    await toko.waitForURL((u) => u.pathname.includes('/toko/produk'), { timeout: 15000 }).catch(() => {});
    await toko.getByRole('button', { name: 'Tambah ke Keranjang' }).first().waitFor({ timeout: 20000 }).catch(() => {});
    await toko.waitForTimeout(800);
    q = await antrean(toko);
    const vc = cari(q.fbq, 'ViewContent')[0];
    record('Halaman produk: ViewContent bernilai rupiah dengan ID produk',
      !!vc && vc[2].currency === 'IDR' && vc[2].value > 0 && Array.isArray(vc[2].content_ids) && vc[2].content_ids.length === 1,
      String(JSON.stringify(vc && vc[2])).slice(0, 160));
    record('TikTok dan Google juga menerima lihat produk',
      cari(q.ttq, 'ViewContent').length === 1 && (q.gtag || []).some((a) => a[0] === 'event' && a[1] === 'view_item'));
    const idProduk = vc ? vc[2].content_ids[0] : null;

    await toko.getByRole('button', { name: 'Tambah ke Keranjang' }).first().click();
    await toko.waitForTimeout(800);
    q = await antrean(toko);
    const atc = cari(q.fbq, 'AddToCart')[0];
    record('Tambah ke keranjang: AddToCart untuk produk yang sama',
      !!atc && atc[2].content_ids[0] === idProduk && atc[2].value > 0,
      String(JSON.stringify(atc && atc[2])).slice(0, 160));
    record('TikTok dan Google juga menerima tambah ke keranjang',
      cari(q.ttq, 'AddToCart').length === 1 && (q.gtag || []).some((a) => a[0] === 'event' && a[1] === 'add_to_cart'));

    // Checkout: daftar akun pembeli dulu (checkout wajib akun).
    await toko.goto(BASE_URL + '/toko/checkout', { waitUntil: 'domcontentloaded' });
    await toko.waitForTimeout(1500);
    await toko.getByRole('button', { name: /^Daftar$/ }).click();
    await toko.waitForURL((u) => u.pathname.includes('/toko/masuk'), { timeout: 10000 }).catch(() => {});
    await toko.getByLabel('Nama lengkap').fill('Uji Pixel ' + CAP);
    await toko.getByLabel('Email', { exact: true }).fill(EMAIL);
    await toko.getByLabel('Nomor HP / WhatsApp', { exact: true }).fill('0813' + CAP + '07');
    await toko.getByLabel('Kata sandi').fill('rahasia123');
    await toko.locator('form[data-auth] input[type="checkbox"]').check();
    await toko.locator('form[data-auth] button[type="submit"]').click();
    await toko.waitForURL((u) => u.pathname.includes('/toko/checkout'), { timeout: 15000 }).catch(() => {});
    await toko.waitForTimeout(1500);
    q = await antrean(toko);
    record('Checkout: InitiateCheckout tercatat', cari(q.fbq, 'InitiateCheckout').length >= 1 &&
      cari(q.ttq, 'InitiateCheckout').length >= 1 && (q.gtag || []).some((a) => a[0] === 'event' && a[1] === 'begin_checkout'));

    const ubah = toko.getByRole('button', { name: 'Ubah', exact: true });
    if (await ubah.count()) await ubah.first().click();
    await toko.getByLabel('Nama Penerima').fill('Uji Pixel ' + CAP);
    await toko.getByLabel(/Nomor HP/i).fill('0813' + CAP + '07');
    await toko.getByLabel('Provinsi').selectOption({ label: 'Jawa Timur' });
    await toko.getByLabel('Kota/Kabupaten').selectOption({ label: 'Kota Surabaya' });
    await toko.getByLabel('Alamat Pengiriman').fill('Jl. Uji Pixel No. 1, ' + CAP);
    await toko.getByRole('button', { name: /Buat Pesanan/i }).click();
    await toko.waitForURL((u) => u.pathname.includes('/toko/selesai'), { timeout: 20000 }).catch(() => {});
    orderNumber = new URL(toko.url()).searchParams.get('order');
    q = await antrean(toko);
    const beli = (q.fbq || []).find((a) => a[0] === 'track' && a[1] === 'Purchase');
    const subtotalDb = orderNumber ? Number(psql(`select subtotal from public.orders where order_number = '${orderNumber}';`)) : NaN;
    const idPesanan = orderNumber ? psql(`select id from public.orders where order_number = '${orderNumber}';`) : '';
    record('Pesanan dibuat: Meta Purchase bernilai subtotal pesanan dan ber-ID pesanan',
      !!beli && beli[2].currency === 'IDR' && Math.abs(beli[2].value - subtotalDb) < 1 && beli[3] && beli[3].eventID === idPesanan,
      String(JSON.stringify(beli && beli.slice(2))).slice(0, 200) + ' subtotal=' + subtotalDb);
    const beliTt = (q.ttq || []).find((a) => a[0] === 'track' && a[1] === 'Purchase');
    record('TikTok Purchase bernilai sama', !!beliTt && Math.abs(beliTt[2].value - subtotalDb) < 1,
      String(JSON.stringify(beliTt && beliTt[2])).slice(0, 160));
    const konversi = (q.gtag || []).find((a) => a[0] === 'event' && a[1] === 'conversion');
    record('Google Ads: konversi berlabel dengan nilai dan nomor pesanan',
      !!konversi && konversi[2].send_to === `${GADS}/${LABEL}` && Math.abs(konversi[2].value - subtotalDb) < 1 &&
      konversi[2].currency === 'IDR' && konversi[2].transaction_id === orderNumber,
      String(JSON.stringify(konversi && konversi[2])).slice(0, 200));
    await ctx.close();

    // ---------- 4. Toko tanpa ID tidak memuat apa pun ----------
    psql(`update public.stores set meta_pixel_id = null, tiktok_pixel_id = null, google_ads_id = null,
            google_ads_purchase_label = null where id = '${STORE}';`);
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const toko2 = await ctx2.newPage();
    trackApi(toko2);
    const pixelKosong = [];
    await cegahPixel(toko2, pixelKosong);
    await toko2.goto(BASE_URL + '/toko', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(toko2, { idleMs: 2500, minWaitMs: 2000 });
    record('Toko tanpa ID pixel tidak memuat skrip pixel apa pun', pixelKosong.length === 0, pixelKosong.join(' , ').slice(0, 160));
    await ctx2.close();

    // ---------- Server menolak ID tidak sah walau form dilewati ----------
    // Form Pengaturan menolak lebih dulu, jadi tanpa cek ini penjaga di server
    // bisa hilang tanpa satu pun uji menjadi merah.
    const sesi = await (await fetch(BASE_URL + '/api/auth/signin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: ADMIN_PASSWORD }),
    })).json();
    const jwt = sesi.session?.access_token || sesi.data?.session?.access_token || sesi.access_token || sesi.token;
    const tulisToko = async (payload) => (await fetch(BASE_URL + '/api/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ table: 'stores', action: 'update', payload, filters: [{ type: 'eq', column: 'id', value: STORE }] }),
    })).status;
    const tidakSah = [
      ['meta_pixel_id', 'abc123'],
      ['meta_pixel_id', '1234567890"></script><script>alert(1)</script>'],
      ['tiktok_pixel_id', 'c4a1b2c3d4e5f6g7h8i9'],
      ['google_ads_id', 'AW-12'],
      ['google_ads_purchase_label', 'ada spasi"'],
    ];
    const kode = [];
    for (const [kolom, nilai] of tidakSah) kode.push(await tulisToko({ [kolom]: nilai }));
    const tersimpan = psql(`select coalesce(meta_pixel_id, '') || coalesce(tiktok_pixel_id, '') || coalesce(google_ads_id, '') || coalesce(google_ads_purchase_label, '') from public.stores where id = '${STORE}';`);
    record('Server menolak ID pixel tidak sah yang dikirim langsung ke API', !!jwt && kode.every((k) => k === 400), kode.join(', '));
    record('ID tidak sah tidak ada yang tersimpan', tersimpan === '', tersimpan || '(kosong)');

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
      if (awal !== null) {
        const [m, t, g, l] = awal.split('|');
        const nilai = (v) => (v ? `'${v.replace(/'/g, "''")}'` : 'null');
        psql(`update public.stores set meta_pixel_id = ${nilai(m)}, tiktok_pixel_id = ${nilai(t)},
                google_ads_id = ${nilai(g)}, google_ads_purchase_label = ${nilai(l)} where id = '${STORE}';`);
      }
      psql(`delete from public.order_items where order_id in (select o.id from public.orders o join public.customers c on c.id = o.customer_id where c.email = '${EMAIL}');`);
      psql(`delete from public.orders where customer_id in (select id from public.customers where email = '${EMAIL}');`);
    } catch (e) {
      console.log('Pembersihan gagal: ' + String(e.message || e).slice(0, 200));
    }
  }
})();
