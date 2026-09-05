// Uji checkout tamu (tanpa login) di storefront publik /toko, dan antrian
// "Pesanan Website" di sisi staff (Orders.tsx).
//
// Alur: kunjungi /toko TANPA sesi sama sekali -> tambah produk ke keranjang
// -> checkout (nama, HP, alamat, metode bayar) -> submit -> dapat nomor
// pesanan -> login admin -> tab "Pesanan Website" di /orders -> Konfirmasi
// (stok terpotong) untuk satu pesanan, Tolak (stok tidak berubah) untuk
// pesanan lain -> cek rate limit endpoint publik.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, envValue, BASE_URL, ADMIN_PASSWORD, DB_PASSWORD } = require('./lib/harness.cjs');

const CAP = Date.now().toString().slice(-6);

function psql(q, boleh = false) {
  try {
    return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
      ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
      { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-guest-checkout-'));
  const browser = await chromium.launch();

  // Konteks TANPA storageState apa pun — betul-betul anonim, tidak ada token.
  const guestCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const guest = await guestCtx.newPage();
  trackApi(guest);

  let orderNumberCash = null;
  let orderNumberQris = null;

  try {
    // ---- 1. Kunjungi /toko tanpa login ----
    await guest.goto(BASE_URL + '/toko', { waitUntil: 'networkidle' });
    await waitForApiIdle(guest, { idleMs: 2000, minWaitMs: 1500 });
    const jumlahKartuProduk = await guest.locator('button:has-text("+ Keranjang")').count();
    record('Katalog publik tampil tanpa login', jumlahKartuProduk > 0, jumlahKartuProduk + ' produk');

    // ---- 2. Tambah ke keranjang, cek badge ----
    const tombolTersedia = guest.locator('button:has-text("+ Keranjang"):not([disabled])');
    await tombolTersedia.first().click();
    await guest.waitForTimeout(500);
    const badge = await guest.locator('a[aria-label="Keranjang"] span').last().textContent();
    record('Badge keranjang bertambah', badge?.trim() === '1', 'badge=' + badge);

    // ---- 2a. Urutkan + filter multi-kategori ----
    await guest.goto(BASE_URL + '/toko', { waitUntil: 'networkidle' });
    await waitForApiIdle(guest, { idleMs: 1500, minWaitMs: 1000 });

    // Intl.NumberFormat memakai spasi tak-putus di "Rp 25.000", jadi teks
    // dicocokkan dengan \s (bukan spasi biasa) lalu diambil angkanya saja.
    const hargaTampil = async () => {
      const teks = await guest.locator('.card').allInnerTexts();
      return teks
        .map((t) => /Rp\s*([\d.]+)/.exec(t))
        .filter(Boolean)
        .map((m) => Number(m[1].replace(/\./g, '')));
    };

    await guest.locator('select').first().selectOption('harga-asc');
    await guest.waitForTimeout(600);
    const naik = await hargaTampil();
    record('Urutkan harga terendah benar-benar menaik',
      naik.length > 1 && naik.every((v, i) => i === 0 || naik[i - 1] <= v),
      naik.slice(0, 4).join(' <= '));

    await guest.locator('select').first().selectOption('harga-desc');
    await guest.waitForTimeout(600);
    const turun = await hargaTampil();
    record('Urutkan harga tertinggi benar-benar menurun',
      turun.length > 1 && turun.every((v, i) => i === 0 || turun[i - 1] >= v),
      turun.slice(0, 4).join(' >= '));

    const totalSemua = Number((await guest.locator('text=/\\d+ produk/').first().textContent() || '0').replace(/\D/g, ''));
    await guest.getByRole('button', { name: /Filter/i }).click();
    await guest.waitForTimeout(400);
    const centang = guest.locator('input[type="checkbox"]');
    await centang.nth(0).check();
    await guest.waitForTimeout(500);
    const setelahSatu = Number((await guest.locator('text=/\\d+ produk/').first().textContent() || '0').replace(/\D/g, ''));
    await centang.nth(1).check();
    await guest.waitForTimeout(500);
    const setelahDua = Number((await guest.locator('text=/\\d+ produk/').first().textContent() || '0').replace(/\D/g, ''));
    record('Filter kategori bisa dicentang lebih dari satu (multi-pilih)',
      setelahDua > setelahSatu && setelahDua < totalSemua,
      `semua=${totalSemua}, 1 kategori=${setelahSatu}, 2 kategori=${setelahDua}`);

    const jumlahChip = await guest.locator('button:has-text("Reset filter")').count();
    record('Panel filter menyediakan Reset filter', jumlahChip > 0);
    await guest.getByRole('button', { name: 'Reset filter' }).first().click();
    await guest.waitForTimeout(500);
    const setelahReset = Number((await guest.locator('text=/\\d+ produk/').first().textContent() || '0').replace(/\D/g, ''));
    record('Reset filter mengembalikan semua produk', setelahReset === totalSemua,
      `${setelahReset} vs ${totalSemua}`);

    // ---- 2b. Detail produk + Beli Sekarang (tidak boleh menyentuh keranjang) ----
    await guest.goto(BASE_URL + '/toko', { waitUntil: 'networkidle' });
    await waitForApiIdle(guest, { idleMs: 1500, minWaitMs: 1000 });
    const kartuTersedia = guest
      .locator('.card')
      .filter({ has: guest.locator('button:has-text("+ Keranjang"):not([disabled])') })
      .first();
    await kartuTersedia.locator('a').first().click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/produk'), { timeout: 10000 }).catch(() => {});
    record('Klik produk membuka halaman detail', guest.url().includes('/toko/produk'), guest.url());
    record(
      'Halaman detail menawarkan Tambah ke Keranjang & Beli Sekarang terpisah',
      (await guest.getByRole('button', { name: 'Beli Sekarang' }).count()) > 0 &&
        (await guest.getByRole('button', { name: 'Tambah ke Keranjang' }).count()) > 0,
    );

    await guest.getByRole('button', { name: 'Beli Sekarang' }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/checkout'), { timeout: 10000 }).catch(() => {});
    record('Beli Sekarang membawa ke checkout mode direct',
      new URL(guest.url()).searchParams.get('mode') === 'direct', guest.url());
    await guest.getByLabel('Nama Penerima').fill('Uji Tamu BuyNow ' + CAP);
    await guest.getByLabel(/Nomor HP/i).fill('0812' + CAP + '03');
    await guest.getByLabel('Alamat Pengiriman').fill('Jl. Uji Tamu No. 3, ' + CAP);
    await guest.getByRole('button', { name: /Buat Pesanan/i }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/selesai'), { timeout: 15000 }).catch(() => {});
    const orderNumberBuyNow = new URL(guest.url()).searchParams.get('order');
    record('Beli Sekarang menghasilkan nomor pesanan', !!orderNumberBuyNow, orderNumberBuyNow || '(kosong)');

    await guest.goto(BASE_URL + '/toko', { waitUntil: 'networkidle' });
    const badgeSetelahBeliSekarang = await guest.locator('a[aria-label="Keranjang"] span').last().textContent();
    record('Keranjang lama tidak ikut terpakai oleh alur Beli Sekarang',
      badgeSetelahBeliSekarang?.trim() === '1', 'badge=' + badgeSetelahBeliSekarang);

    // ---- 3. Checkout, bayar cash ----
    await guest.goto(BASE_URL + '/toko/checkout', { waitUntil: 'networkidle' });
    await guest.getByLabel('Nama Penerima').fill('Uji Tamu Cash ' + CAP);
    await guest.getByLabel(/Nomor HP/i).fill('0812' + CAP + '01');
    await guest.getByLabel('Alamat Pengiriman').fill('Jl. Uji Tamu No. 1, ' + CAP);
    await guest.getByRole('button', { name: /Buat Pesanan/i }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/selesai'), { timeout: 15000 }).catch(() => {});
    const urlSelesai = new URL(guest.url());
    orderNumberCash = urlSelesai.searchParams.get('order');
    record('Checkout cash menghasilkan nomor pesanan', !!orderNumberCash, orderNumberCash || '(kosong)');

    // ---- 4. Pesanan kedua, bayar QRIS (untuk diuji Tolak nanti) ----
    await guest.goto(BASE_URL + '/toko', { waitUntil: 'networkidle' });
    await waitForApiIdle(guest, { idleMs: 2000, minWaitMs: 1500 });
    await guest.locator('button:has-text("+ Keranjang"):not([disabled])').nth(1).click();
    await guest.goto(BASE_URL + '/toko/checkout', { waitUntil: 'networkidle' });
    await guest.getByLabel('Nama Penerima').fill('Uji Tamu QRIS ' + CAP);
    await guest.getByLabel(/Nomor HP/i).fill('0812' + CAP + '02');
    await guest.getByLabel('Alamat Pengiriman').fill('Jl. Uji Tamu No. 2, ' + CAP);
    await guest.getByRole('button', { name: /QRIS/i }).click();
    await guest.getByRole('button', { name: /Buat Pesanan/i }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/selesai'), { timeout: 15000 }).catch(() => {});
    orderNumberQris = new URL(guest.url()).searchParams.get('order');
    record('Checkout QRIS menghasilkan nomor pesanan', !!orderNumberQris, orderNumberQris || '(kosong)');

    // ---- 5. Login admin di konteks TERPISAH, cek antrian & konfirmasi/tolak ----
    const staffCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const staff = await staffCtx.newPage();
    trackApi(staff);
    await staff.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
    await staff.fill('input[type="email"]', 'admin@example.com');
    await staff.fill('input[type="password"]', ADMIN_PASSWORD);
    await staff.click('button[type="submit"]');
    await staff.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(staff, { idleMs: 3500, minWaitMs: 2500 });

    await staff.goto(BASE_URL + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 3000, minWaitMs: 2000 });
    await staff.getByRole('button', { name: 'Pesanan Website' }).click();
    await staff.waitForTimeout(1000);

    const barisCash = staff.locator('tr', { hasText: orderNumberCash || '__none__' });
    const barisQris = staff.locator('tr', { hasText: orderNumberQris || '__none__' });
    record('Pesanan cash muncul di tab Pesanan Website', (await barisCash.count()) > 0);
    record('Pesanan QRIS muncul di tab Pesanan Website', (await barisQris.count()) > 0);

    // Ambil qty & product yang dipesan (baris pertama katalog) untuk cek stok nanti.
    const stokSebelum = psql(
      `select p.stock_qty from products p join order_items oi on oi.product_id = p.id
       join orders o on o.id = oi.order_id where o.order_number = '${orderNumberCash}' limit 1;`,
    );

    await barisCash.getByRole('button', { name: 'Konfirmasi' }).click();
    await staff.waitForTimeout(2000);
    const statusCashSetelah = psql(`select order_status, payment_status from orders where order_number = '${orderNumberCash}';`);
    record('Konfirmasi mengubah status jadi done/paid', statusCashSetelah === 'done|paid', statusCashSetelah);

    const stokSesudah = psql(
      `select p.stock_qty from products p join order_items oi on oi.product_id = p.id
       join orders o on o.id = oi.order_id where o.order_number = '${orderNumberCash}' limit 1;`,
    );
    record('Stok terpotong setelah konfirmasi', Number(stokSesudah) < Number(stokSebelum),
      `${stokSebelum} -> ${stokSesudah}`);

    const stokQrisSebelum = psql(
      `select p.stock_qty from products p join order_items oi on oi.product_id = p.id
       join orders o on o.id = oi.order_id where o.order_number = '${orderNumberQris}' limit 1;`,
    );
    await staff.goto(BASE_URL + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 3000, minWaitMs: 2000 });
    await staff.getByRole('button', { name: 'Pesanan Website' }).click();
    await staff.waitForTimeout(1000);
    staff.once('dialog', (d) => d.accept());
    await staff.locator('tr', { hasText: orderNumberQris }).getByRole('button', { name: 'Tolak' }).click();
    await staff.waitForTimeout(2000);
    const statusQrisSetelah = psql(`select order_status from orders where order_number = '${orderNumberQris}';`);
    record('Tolak mengubah status jadi canceled', statusQrisSetelah === 'canceled', statusQrisSetelah);

    const stokQrisSesudah = psql(
      `select p.stock_qty from products p join order_items oi on oi.product_id = p.id
       join orders o on o.id = oi.order_id where o.order_number = '${orderNumberQris}' limit 1;`,
    );
    record('Stok TIDAK berubah setelah ditolak', stokQrisSesudah === stokQrisSebelum,
      `${stokQrisSebelum} -> ${stokQrisSesudah}`);

    await staffCtx.close();

    // ---- 6. Rate limit endpoint publik ----
    // Batasnya bisa disetel lewat PUBLIC_ORDER_RATE_MAX, jadi tembakannya
    // mengikuti batas yang sedang berlaku (batas+1 pasti melewatinya, berapa
    // pun sisa jatah dari langkah sebelumnya).
    const batas = Number(envValue('PUBLIC_ORDER_RATE_MAX')) || 5;
    const hasilBurst = await guest.evaluate(async (n) => {
      const kode = [];
      for (let i = 0; i < n + 1; i++) {
        const res = await fetch('/api/public/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: 'not-a-uuid' }),
        });
        kode.push(res.status);
      }
      return kode;
    }, batas);
    record(`Permintaan melebihi batas (${batas}/jendela) kena rate limit 429`,
      hasilBurst[hasilBurst.length - 1] === 429,
      hasilBurst.join(','));

    console.log('');
    console.log('--- RINGKASAN ---');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + e.message.slice(0, 400));
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`delete from order_items where order_id in (select id from orders where customer_name like 'Uji Tamu%${CAP}%');`, true);
      psql(`delete from orders where customer_name like 'Uji Tamu%${CAP}%';`, true);
    } catch (_) { /* biarkan */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* biarkan */ }
  }
})();
