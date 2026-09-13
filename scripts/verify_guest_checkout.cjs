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
// Checkout memakai akun pembeli (keputusan client), jadi uji mendaftar akun baru.
const EMAIL_PEMBELI = `uji.pembeli.${CAP}@contoh.id`;

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
    const jumlahKartuProduk = await guest.locator('a[data-kartu-produk]').count();
    record('Katalog publik tampil tanpa login', jumlahKartuProduk > 0, jumlahKartuProduk + ' produk');

    // Kartu ala Lazada tidak punya tombol keranjang: buka produknya lalu tambah dari halaman detail.
    const tambahDariKartu = async (n) => {
      await guest.locator('a[data-kartu-produk]').filter({ hasNotText: 'Stok habis' }).nth(n).click();
      await guest.waitForURL((u) => u.pathname.includes('/toko/produk'), { timeout: 10000 }).catch(() => {});
      const tombol = guest.getByRole('button', { name: /Tambah ke keranjang/i }).first();
      await tombol.waitFor({ timeout: 15000 });
      await tombol.click();
      await guest.waitForTimeout(500);
    };

    // ---- 2. Tambah ke keranjang, cek badge ----
    await tambahDariKartu(0);
    const badge = await guest.locator('a[aria-label="Keranjang"] span').last().textContent();
    record('Badge keranjang bertambah', badge?.trim() === '1', 'badge=' + badge);

    // ---- 2a. Urutkan + filter multi-kategori (halaman Semua Produk) ----
    await guest.goto(BASE_URL + '/toko?semua=1', { waitUntil: 'networkidle' });
    await waitForApiIdle(guest, { idleMs: 1500, minWaitMs: 1000 });

    // Intl.NumberFormat memakai spasi tak-putus di "Rp 25.000", jadi teks
    // dicocokkan dengan \s (bukan spasi biasa) lalu diambil angkanya saja.
    const hargaTampil = async () => {
      const teks = await guest.locator('a[data-kartu-produk]').allInnerTexts();
      return teks
        .map((t) => /Rp\s*([\d.]+)/.exec(t))
        .filter(Boolean)
        .map((m) => Number(m[1].replace(/\./g, '')));
    };

    await guest.getByLabel('Urutkan produk').selectOption('harga-asc');
    await guest.waitForTimeout(600);
    const naik = await hargaTampil();
    record('Urutkan harga terendah benar-benar menaik',
      naik.length > 1 && naik.every((v, i) => i === 0 || naik[i - 1] <= v),
      naik.slice(0, 4).join(' <= '));

    await guest.getByLabel('Urutkan produk').selectOption('harga-desc');
    await guest.waitForTimeout(600);
    const turun = await hargaTampil();
    record('Urutkan harga tertinggi benar-benar menurun',
      turun.length > 1 && turun.every((v, i) => i === 0 || turun[i - 1] >= v),
      turun.slice(0, 4).join(' >= '));

    const jumlahDitemukan = async () =>
      Number(((await guest.getByText(/produk ditemukan/).first().textContent()) || '0').replace(/[^0-9]/g, ''));
    const totalSemua = await jumlahDitemukan();
    const centang = guest.locator('aside input[type="checkbox"]');
    await centang.nth(0).check();
    await guest.waitForTimeout(500);
    const setelahSatu = await jumlahDitemukan();
    await centang.nth(1).check();
    await guest.waitForTimeout(500);
    const setelahDua = await jumlahDitemukan();
    record('Filter kategori bisa dicentang lebih dari satu (multi-pilih)',
      setelahDua > setelahSatu && setelahDua < totalSemua,
      `semua=${totalSemua}, 1 kategori=${setelahSatu}, 2 kategori=${setelahDua}`);

    const jumlahChip = await guest.getByRole('button', { name: 'Hapus semua', exact: true }).count();
    record('Filter aktif menyediakan Hapus semua', jumlahChip > 0);
    await guest.getByRole('button', { name: 'Hapus semua', exact: true }).click();
    await guest.waitForTimeout(500);
    const setelahReset = await jumlahDitemukan();
    record('Hapus semua filter mengembalikan semua produk', setelahReset === totalSemua,
      `${setelahReset} vs ${totalSemua}`);

    // ---- 2b. Detail produk + Beli Sekarang (tidak boleh menyentuh keranjang) ----
    await guest.goto(BASE_URL + '/toko', { waitUntil: 'networkidle' });
    await waitForApiIdle(guest, { idleMs: 1500, minWaitMs: 1000 });
    await guest.locator('a[data-kartu-produk]').filter({ hasNotText: 'Stok habis' }).first().click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/produk'), { timeout: 10000 }).catch(() => {});
    record('Klik produk membuka halaman detail', guest.url().includes('/toko/produk'), guest.url());
    // Halaman detail memuat datanya sendiri; tunggu sampai tombol belinya tampil.
    await guest.getByRole('button', { name: 'Beli Sekarang' }).first().waitFor({ timeout: 15000 }).catch(() => {});
    record(
      'Halaman detail menawarkan Tambah ke Keranjang & Beli Sekarang terpisah',
      (await guest.getByRole('button', { name: 'Beli Sekarang' }).count()) > 0 &&
        (await guest.getByRole('button', { name: 'Tambah ke Keranjang' }).count()) > 0,
    );

    await guest.getByRole('button', { name: 'Beli Sekarang' }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/checkout'), { timeout: 10000 }).catch(() => {});
    record('Beli Sekarang membawa ke checkout mode direct',
      new URL(guest.url()).searchParams.get('mode') === 'direct', guest.url());

    // ---- Checkout wajib akun: daftar dari halaman checkout, lalu kembali ----
    record('Checkout tanpa akun meminta masuk dulu',
      (await guest.getByText('Masuk untuk checkout').count()) > 0);
    await guest.getByRole('button', { name: /^Daftar$/ }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/masuk'), { timeout: 10000 }).catch(() => {});
    await guest.getByLabel('Nama lengkap').fill('Uji Pembeli ' + CAP);
    // exact: kalimat persetujuan data juga memuat kata "email".
    await guest.getByLabel('Email', { exact: true }).fill(EMAIL_PEMBELI);
    await guest.getByLabel('Nomor HP / WhatsApp', { exact: true }).fill('0812' + CAP + '03');
    await guest.getByLabel('Kata sandi').fill('rahasia123');
    await guest.locator('form[data-auth] input[type="checkbox"]').check();
    await guest.locator('form[data-auth] button[type="submit"]').click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/checkout'), { timeout: 15000 }).catch(() => {});
    record('Setelah daftar kembali ke checkout yang sama',
      guest.url().includes('/toko/checkout') && new URL(guest.url()).searchParams.get('mode') === 'direct',
      guest.url());
    await guest.waitForTimeout(1200);
    record('Nama & HP terisi otomatis dari akun',
      (await guest.getByLabel('Nama Penerima').inputValue()) === 'Uji Pembeli ' + CAP,
      await guest.getByLabel('Nama Penerima').inputValue());
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
    await tambahDariKartu(1);
    await guest.goto(BASE_URL + '/toko/checkout', { waitUntil: 'networkidle' });
    await guest.getByLabel('Nama Penerima').fill('Uji Tamu QRIS ' + CAP);
    await guest.getByLabel(/Nomor HP/i).fill('0812' + CAP + '02');
    await guest.getByLabel('Alamat Pengiriman').fill('Jl. Uji Tamu No. 2, ' + CAP);
    await guest.getByRole('button', { name: /QRIS/i }).click();
    await guest.getByRole('button', { name: /Buat Pesanan/i }).click();
    await guest.waitForURL((u) => u.pathname.includes('/toko/selesai'), { timeout: 15000 }).catch(() => {});
    orderNumberQris = new URL(guest.url()).searchParams.get('order');
    record('Checkout QRIS menghasilkan nomor pesanan', !!orderNumberQris, orderNumberQris || '(kosong)');

    // ---- Pesanan tercatat di akun pembeli ----
    await guest.goto(BASE_URL + '/toko/akun', { waitUntil: 'networkidle' });
    await guest.waitForTimeout(1500);
    const teksAkun = await guest.locator('body').innerText();
    record('Pesanan Saya menampilkan pesanan akun',
      !!orderNumberCash && teksAkun.includes(orderNumberCash) && !!orderNumberQris && teksAkun.includes(orderNumberQris));
    const tertaut = psql(`select count(*) from public.orders o join public.customers c on c.id = o.customer_id
                           where c.email = '${EMAIL_PEMBELI}';`);
    record('Pesanan web tertaut ke data pelanggan akun', Number(tertaut) >= 3, tertaut + ' pesanan');
    const alamat = psql(`select coalesce(address, '') from public.customers where email = '${EMAIL_PEMBELI}';`);
    record('Alamat pertama tersimpan ke akun', alamat.includes('Jl. Uji Tamu No. 3'), alamat);

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

    const ONGKIR = 15000;
    const totalSebelumKonfirmasi = Number(
      psql(`select total from orders where order_number = '${orderNumberCash}';`),
    );

    await barisCash.getByRole('button', { name: 'Konfirmasi' }).click();
    await staff.waitForTimeout(1200);
    record('Dialog konfirmasi meminta ongkir',
      (await staff.getByLabel('Ongkos Kirim').count()) > 0);
    await staff.getByLabel('Ongkos Kirim').fill(String(ONGKIR));
    await staff.waitForTimeout(400);
    await staff.getByRole('button', { name: /Konfirmasi & Potong Stok/i }).click();
    await staff.waitForTimeout(2500);

    const statusCashSetelah = psql(`select order_status, payment_status from orders where order_number = '${orderNumberCash}';`);
    record('Konfirmasi mengubah status jadi done/paid', statusCashSetelah === 'done|paid', statusCashSetelah);

    // Uang: ongkir tersimpan sendiri DAN ikut menambah total tagihan.
    const barisUang = psql(
      `select shipping_cost, total, subtotal from orders where order_number = '${orderNumberCash}';`,
    ).split('|');
    const [ongkirDb, totalDb, subtotalDb] = barisUang.map(Number);
    record('Ongkir tersimpan di kolomnya sendiri', ongkirDb === ONGKIR, String(ongkirDb));
    record('Total ikut naik sebesar ongkir',
      totalDb === totalSebelumKonfirmasi + ONGKIR,
      `${totalSebelumKonfirmasi} + ${ONGKIR} = ${totalDb}`);
    record('Subtotal barang TIDAK ikut terkena ongkir',
      subtotalDb === totalSebelumKonfirmasi,
      `subtotal=${subtotalDb}`);

    // Laba rugi: ongkir tidak boleh dihitung sebagai pendapatan produk.
    await staff.goto(BASE_URL + '/reports?tab=pnl', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 3000, minWaitMs: 2000 });
    const pendapatanSql = Number(psql(
      `select coalesce(sum(total - tax - shipping_cost), 0) from orders
       where store_id = (select store_id from orders where order_number = '${orderNumberCash}')
         and order_status not in ('canceled', 'awaiting_confirmation');`,
    ));
    const pendapatanDenganOngkir = Number(psql(
      `select coalesce(sum(total - tax), 0) from orders
       where store_id = (select store_id from orders where order_number = '${orderNumberCash}')
         and order_status not in ('canceled', 'awaiting_confirmation');`,
    ));
    record('Pendapatan laba rugi memang beda kalau ongkir ikut dihitung',
      pendapatanDenganOngkir > pendapatanSql,
      `tanpa ongkir=${pendapatanSql}, dengan ongkir=${pendapatanDenganOngkir}`);

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
