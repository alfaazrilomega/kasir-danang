// Uji flash sale: sesi berjalan/lewat di endpoint publik, harga & kuota
// dipakai saat checkout, cost_price tidak bocor ke publik, dan blok flash
// sale + badge tampil di beranda toko.
//
// Cek harga/kuota/sold_qty murni logika server (lihat UPDATE atomik di
// POST /api/public/orders), jadi dites langsung lewat fetch ke API -- bukan
// lewat form checkout browser yang panjang (provinsi/kota/dst) seperti
// verify_guest_checkout.cjs. Playwright hanya dipakai untuk satu hal yang
// memang butuh browser sungguhan: tampilan section#flash-sale di /toko.
//
// Data uji (produk, sesi, akun pembeli) dibuat sendiri lewat psql dengan
// nama/SKU/email bertanda unik, tidak menyentuh data flash sale atau produk
// milik client yang sudah ada, dan dihapus semua di bagian `finally`.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, BASE_URL, DB_PASSWORD } = require('./lib/harness.cjs');

const TAG = 'UJIFS' + Date.now().toString().slice(-6);
const EMAIL_PEMBELI = `uji.flash.${TAG}@contoh.id`.toLowerCase();
const TELEPON = '0812' + TAG.replace(/\D/g, '').slice(-8);

const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket ? ' — ' + ket : ''));
};

function psql(q, boleh = false) {
  try {
    return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
      ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
      { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .trim().split('\n')[0].trim();
  } catch (e) {
    if (boleh) return 'GAGAL: ' + String(e.stderr || e.message).trim();
    throw e;
  }
}

/** Panggil API JSON langsung (tanpa browser) -- sama seperti fetchPublicFlashSale/submitPublicOrder di klien. */
async function apiJson(pathAndQuery, opts = {}) {
  const res = await fetch(BASE_URL + pathAndQuery, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, ok: res.ok, data: json?.data ?? null, error: json?.error ?? null };
}

let storeId = null;
let productId = null;
let sesiLewatId = null;
let sesiBerjalanId = null;
let itemId = null;
let userId = null;
const orderIds = [];

(async () => {
  try {
    storeId = psql('select id from public.stores order by created_at limit 1;');

    // ---------- Persiapan: produk uji + sesi yang sudah lewat ----------
    productId = psql(
      `insert into public.products (store_id, name, sku, base_price, cost_price, stock_qty, is_active)
       values ('${storeId}', '${TAG} Produk Flash', '${TAG}-SKU', 100000, 40000, 100, true)
       returning id;`,
    );
    sesiLewatId = psql(
      `insert into public.flash_sales (store_id, name, starts_at, ends_at, is_active)
       values ('${storeId}', '${TAG} Sesi Lewat', now() - interval '2 day', now() - interval '1 day', true)
       returning id;`,
    );

    // ---------- 1. Sesi yang sudah lewat tidak tampil ----------
    let flash = await apiJson(`/api/public/flash-sale?store_id=${storeId}`);
    record('Sesi yang sudah lewat tidak tampil di endpoint publik',
      flash.data?.flash_sale?.id !== sesiLewatId,
      JSON.stringify(flash.data?.flash_sale));

    // ---------- Sesi berjalan dengan kuota kecil (gampang dihabiskan) ----------
    sesiBerjalanId = psql(
      `insert into public.flash_sales (store_id, name, starts_at, ends_at, is_active)
       values ('${storeId}', '${TAG} Sesi Berjalan', now() - interval '1 hour', now() + interval '2 hour', true)
       returning id;`,
    );
    itemId = psql(
      `insert into public.flash_sale_items (store_id, flash_sale_id, product_id, flash_price, quota_qty)
       values ('${storeId}', '${sesiBerjalanId}', '${productId}', 60000, 1)
       returning id;`,
    );

    // ---------- 2. Sesi berjalan tampil, dengan data produk yang aman ----------
    flash = await apiJson(`/api/public/flash-sale?store_id=${storeId}`);
    record('Sesi berjalan tampil di endpoint publik',
      flash.data?.flash_sale?.id === sesiBerjalanId,
      JSON.stringify(flash.data?.flash_sale));
    const itemPublik = (flash.data?.items || []).find((it) => it.product_id === productId);
    record('Produk flash tampil dengan flash_price & kuota yang benar',
      !!itemPublik && Number(itemPublik.flash_price) === 60000 &&
        Number(itemPublik.quota_qty) === 1 && Number(itemPublik.sold_qty) === 0,
      JSON.stringify(itemPublik));
    record('cost_price TIDAK ikut terkirim ke endpoint publik',
      !!itemPublik && !('cost_price' in itemPublik),
      itemPublik ? Object.keys(itemPublik).join(',') : '(item tidak ditemukan)');

    // ---------- 3. Blok Flash Sale + badge tampil di beranda toko ----------
    // Dicek SEBELUM kuota dihabiskan di langkah berikutnya -- begitu kuota
    // habis, badge memang sengaja hilang (lihat itemFlashAktif di
    // publicCatalog.ts), jadi urutan ini penting.
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
      trackApi(page);
      // Sengaja BUKAN networkidle: gambar produk toko ini dimuat dari situs
      // klien (gnnkracing.id), dan saat situs itu lambat permintaan gambarnya
      // menggantung sehingga networkidle tidak pernah tercapai walau halaman
      // sudah siap. waitForApiIdle hanya menunggu permintaan API aplikasi.
      await page.goto(BASE_URL + '/toko', { waitUntil: 'domcontentloaded' });
      await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
      await page.waitForSelector('section#terlaris, section#flash-sale', { timeout: 60000 });
      const blok = page.locator('section#flash-sale');
      record('Blok Flash Sale tampil di beranda toko', (await blok.count()) > 0);
      const kartu = blok.locator('a[data-kartu-produk]').filter({ hasText: TAG });
      record('Kartu produk uji tampil di dalam blok Flash Sale', (await kartu.count()) > 0);
      record('Badge "Flash Sale" tampil di kartu produknya',
        (await kartu.first().getByText('Flash Sale', { exact: true }).count()) > 0);
    } finally {
      await browser.close();
    }

    // ---------- 4. Daftar akun pembeli uji, lalu checkout ----------
    const signup = await apiJson('/api/customer/signup', {
      method: 'POST',
      body: {
        store_id: storeId,
        email: EMAIL_PEMBELI,
        password: 'rahasia123',
        name: 'Uji Flash ' + TAG,
        phone: TELEPON,
        privacy_accepted: true,
      },
    });
    record('Akun pembeli uji berhasil didaftarkan', signup.ok && !!signup.data?.token, signup.error || '');
    const token = signup.data?.token;
    userId = psql(`select user_id from public.customers where email = '${EMAIL_PEMBELI}';`, true);

    const buatPesanan = (qty) => apiJson('/api/public/orders', {
      method: 'POST',
      token,
      body: {
        store_id: storeId,
        customer_name: 'Uji Flash ' + TAG,
        customer_phone: TELEPON,
        delivery_address: 'Jl. Uji Flash No. 1, ' + TAG,
        payment_method: 'cash',
        items: [{ product_id: productId, qty }],
      },
    });

    // Pesanan pertama: kuota masih tersisa (0 + 1 <= 1) -> harus pakai flash_price.
    const pesanan1 = await buatPesanan(1);
    record('Pesanan pertama (kuota tersedia) berhasil dibuat',
      pesanan1.ok && !!pesanan1.data?.order_id, pesanan1.error || '');
    if (pesanan1.data?.order_id) orderIds.push(pesanan1.data.order_id);

    const hargaPesanan1 = psql(
      `select price from public.order_items where order_id = '${pesanan1.data?.order_id}' and product_id = '${productId}';`,
      true,
    );
    record('Pesanan pertama memakai flash_price, bukan base_price',
      Number(hargaPesanan1) === 60000, 'harga tersimpan=' + hargaPesanan1);

    const soldQtySetelah1 = psql(`select sold_qty from public.flash_sale_items where id = '${itemId}';`, true);
    record('sold_qty naik sesuai qty yang dibeli',
      Number(soldQtySetelah1) === 1, 'sold_qty=' + soldQtySetelah1);

    // Pesanan kedua: kuota sudah habis (1 + 1 > 1) -> harus balik ke base_price.
    const pesanan2 = await buatPesanan(1);
    record('Pesanan kedua (kuota habis) tetap berhasil dibuat, dengan harga normal',
      pesanan2.ok && !!pesanan2.data?.order_id, pesanan2.error || '');
    if (pesanan2.data?.order_id) orderIds.push(pesanan2.data.order_id);

    const hargaPesanan2 = psql(
      `select price from public.order_items where order_id = '${pesanan2.data?.order_id}' and product_id = '${productId}';`,
      true,
    );
    record('Kuota habis membuat pesanan berikutnya memakai harga normal (base_price)',
      Number(hargaPesanan2) === 100000, 'harga tersimpan=' + hargaPesanan2);

    const soldQtySetelah2 = psql(`select sold_qty from public.flash_sale_items where id = '${itemId}';`, true);
    record('sold_qty TIDAK bertambah lagi setelah kuota habis',
      Number(soldQtySetelah2) === 1, 'sold_qty=' + soldQtySetelah2);

    console.log('');
    console.log('--- RINGKASAN ---');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message.slice(0, 400));
    process.exitCode = 1;
  } finally {
    // Bersih-bersih: urutan mengikuti foreign key (order_items -> orders ->
    // customers -> profiles -> app_users), baru sesi/item/produk flash sale.
    try {
      if (orderIds.length) {
        const daftar = orderIds.map((id) => `'${id}'`).join(',');
        psql(`delete from public.order_items where order_id in (${daftar});`, true);
        psql(`delete from public.orders where id in (${daftar});`, true);
      }
      psql(`delete from public.customers where email = '${EMAIL_PEMBELI}';`, true);
      if (userId && !userId.startsWith('GAGAL')) {
        psql(`delete from public.profiles where id = '${userId}';`, true);
        psql(`delete from public.app_users where id = '${userId}';`, true);
      }
      if (itemId) psql(`delete from public.flash_sale_items where id = '${itemId}';`, true);
      if (sesiBerjalanId) psql(`delete from public.flash_sales where id = '${sesiBerjalanId}';`, true);
      if (sesiLewatId) psql(`delete from public.flash_sales where id = '${sesiLewatId}';`, true);
      if (productId) psql(`delete from public.products where id = '${productId}';`, true);
    } catch (_) { /* biarkan */ }
  }
})();
