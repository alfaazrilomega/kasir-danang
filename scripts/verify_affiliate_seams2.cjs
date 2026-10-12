// Sambungan program affiliate, putaran kedua. Yang diuji di sini belum pernah
// disentuh suite lain: server menolak atau mati saat link dibuka, harga flash
// sale sebagai dasar komisi, tarif komisi yang berubah sebelum pesanan
// dikonfirmasi, pembeli dan produk yang dihapus setelah ada pesanan, dua
// permintaan yang sama datang bersamaan, dan callback pembayaran Tripay.

const crypto = require('crypto');
const { chromium } = require('playwright');
const { BASE_URL, envValue, loginAdmin, trackApi } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const q = (token, body) => panggil('POST', '/api/query', { token, body: { columns: '*', filters: [], orderBy: null, limit: null, payload: null, returning: false, single: false, maybeSingle: false, ...body } });
const komisi = (orderId) => psql(`select coalesce(string_agg(trunc(base_amount) || ':' || rate_type || ':' || trunc(rate_value) || ':' || trunc(commission) || ':' || status, ',' order by tier), '-') from public.affiliate_commissions where order_id = '${orderId}'`);

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const [P1, P2, P3] = A.produkUji(toko, 3);
  const browser = await chromium.launch();
  let idSesiFlash = null;
  let idProdukSementara = null;

  try {
    await A.aturProgram(admin, {
      enabled: true, access_mode: 'approved', cookie_days: 30, general_cookie: true, permanent: false,
      commission: [{ type: 'percentage', value: 10 }], invite_daily_limit: 20,
    });
    const Af = await A.daftarPembeli(toko, CAP, 'a');
    await A.izinkan(admin, Af.id);
    const kode = await A.kodeAffiliate(Af.token);
    const C = await A.daftarPembeli(toko, CAP, 'c');
    const kUmum = await A.klik(toko, kode, { source: 'what', media: 'putaran2' });

    // ---------- 1. Server menolak atau mati saat link dibuka ----------
    // Halaman pembuka link ada untuk mengantar pengunjung ke produk. Gangguan
    // yang bukan salah link (batas laju, galat server, jaringan putus) tidak
    // boleh menghentikan pengunjung di layar galat.
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await ctx.newPage();
    const bukaDengan = async (jalan, pola, jawab) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route(pola, jawab);
      await page.goto(BASE_URL + jalan, { waitUntil: 'domcontentloaded' });
      await page.waitForURL((u) => !u.pathname.startsWith('/aff/'), { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      const u = new URL(page.url());
      return { jalur: u.pathname, cari: u.search, galat: await page.locator('[data-affiliate-buka="galat"]').count() };
    };
    const json = (status, error) => (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
    const POLA_KLIK = '**/api/public/affiliate/click';

    const r429 = await bukaDengan(`/aff/${kode}/${P1.id}`, POLA_KLIK, json(429, 'Terlalu banyak permintaan, coba lagi sebentar.'));
    record('Batas laju (429) saat membuka link produk: pengunjung tetap tiba di halaman produk itu, tanpa layar galat (AC-67)',
      r429.jalur === '/toko/produk' && r429.cari === `?id=${P1.id}` && r429.galat === 0, JSON.stringify(r429));
    const r500 = await bukaDengan(`/aff/${kode}/${P1.id}`, POLA_KLIK, json(500, 'Terjadi kesalahan server.'));
    record('Galat server (500) saat membuka link produk: pengunjung tetap tiba di halaman produk itu (AC-67)',
      r500.jalur === '/toko/produk' && r500.cari === `?id=${P1.id}` && r500.galat === 0, JSON.stringify(r500));
    const rPutus = await bukaDengan(`/aff/${kode}/${P1.id}`, POLA_KLIK, (r) => r.abort('failed'));
    record('Jaringan putus saat membuka link produk: pengunjung tetap tiba di halaman produk itu (AC-67)',
      rPutus.jalur === '/toko/produk' && rPutus.cari === `?id=${P1.id}` && rPutus.galat === 0, JSON.stringify(rPutus));
    const rToko = await bukaDengan(`/aff/${kode}`, POLA_KLIK, json(429, 'Terlalu banyak permintaan, coba lagi sebentar.'));
    record('Batas laju saat membuka link seluruh toko: pengunjung tiba di toko (AC-67)', rToko.jalur === '/toko' && rToko.galat === 0, JSON.stringify(rToko));
    const rUnd = await bukaDengan('/aff/undangan/tokenuji123', '**/api/public/affiliate/invitation', json(500, 'Terjadi kesalahan server.'));
    record('Galat server saat membuka undangan: penerima tiba di formulir daftar (AC-67)',
      rUnd.jalur === '/toko/masuk' && /tab=daftar/.test(rUnd.cari) && rUnd.galat === 0, JSON.stringify(rUnd));
    // Gangguan sesaat: percobaan pertama putus, percobaan ulang sampai ke server.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    let panggilanKlik = 0;
    await page.route(POLA_KLIK, (r) => {
      panggilanKlik += 1;
      return panggilanKlik === 1 ? r.abort('failed') : r.continue();
    });
    const klikSebelum = Number(psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${Af.id}'`));
    await page.goto(BASE_URL + `/aff/${kode}/${P1.id}?utm_source=what&utm_media=ulang`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((u) => u.pathname === '/toko/produk', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    const klikSesudah = Number(psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${Af.id}' and media = 'ulang'`));
    record('Jaringan putus sesaat: satu percobaan ulang menyelamatkan klik, tercatat tepat sekali dan cookie terpasang (AC-67)',
      panggilanKlik === 2 && klikSesudah === 1 && new URL(page.url()).pathname === '/toko/produk' && (await ctx.cookies(BASE_URL)).some((c) => c.name === 'gnnk_aff'),
      `${panggilanKlik} panggilan, ${klikSesudah} klik (sebelumnya ${klikSebelum}), tiba di ${new URL(page.url()).pathname}`);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto(BASE_URL + `/aff/TIDAKADA${CAP}`, { waitUntil: 'domcontentloaded' });
    const kartu = page.locator('[data-affiliate-buka="galat"]');
    await kartu.waitFor({ timeout: 10000 }).catch(() => {});
    record('Link yang memang salah tetap menampilkan pesan Sejoli, tidak ikut dialihkan (AC-14)',
      (await kartu.count()) === 1 && /Affiliasi tidak terdaftar di database/.test(await kartu.innerText().catch(() => '')), new URL(page.url()).pathname);
    await ctx.close();

    // ---------- 2. Harga flash sale adalah dasar komisi ----------
    const flashLain = psql(`select count(*) from public.flash_sale_items i join public.flash_sales s on s.id = i.flash_sale_id where i.product_id = '${P3.id}' and s.is_active and now() between s.starts_at and s.ends_at`);
    const hargaFlash = Math.floor((P3.price * 0.8) / 1000) * 1000;
    idSesiFlash = psql(`insert into public.flash_sales (store_id, name, starts_at, ends_at, is_active) values ('${toko}', 'Uji affiliate ${CAP}', now() - interval '1 hour', now() + interval '1 hour', true) returning id`).split(/\s/)[0];
    psql(`insert into public.flash_sale_items (store_id, flash_sale_id, product_id, flash_price, quota_qty) values ('${toko}', '${idSesiFlash}', '${P3.id}', ${hargaFlash}, 50)`);
    const oFlash = await A.pesan(toko, C, [{ product_id: P3.id, qty: 2 }], { cookie: kUmum.cookie });
    const hargaBaris = Number(psql(`select trunc(price) from public.order_items where order_id = '${oFlash.id}'`));
    record('Pesanan saat flash sale: komisi 10% dihitung dari harga flash yang dibayar, bukan harga normal (D-6)',
      flashLain === '0' && hargaBaris === hargaFlash && komisi(oFlash.id) === `${hargaFlash * 2}:percentage:10:${Math.floor(hargaFlash * 2 * 0.1)}:pending`,
      `harga normal ${P3.price}, flash ${hargaFlash}, baris ${hargaBaris}, komisi ${komisi(oFlash.id)}`);
    psql(`delete from public.flash_sales where id = '${idSesiFlash}'`);
    idSesiFlash = null;

    // ---------- 3. Tarif komisi berubah sebelum pesanan dikonfirmasi ----------
    const oTarif = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kUmum.cookie });
    const awal = komisi(oTarif.id);
    await A.aturProgram(admin, { commission: [{ type: 'percentage', value: 20 }] });
    await A.konfirmasi(admin, oTarif.id);
    record('Tarif naik dari 10% ke 20% sebelum konfirmasi: komisi pesanan lama tetap 10% dan menjadi Belum dibayar',
      awal === `${P1.price}:percentage:10:${Math.floor(P1.price * 0.1)}:pending` && komisi(oTarif.id) === `${P1.price}:percentage:10:${Math.floor(P1.price * 0.1)}:added`, `${awal} -> ${komisi(oTarif.id)}`);
    const oBaru = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kUmum.cookie });
    record('Pesanan sesudah perubahan memakai tarif baru 20%', komisi(oBaru.id) === `${P1.price}:percentage:20:${Math.floor(P1.price * 0.2)}:pending`, komisi(oBaru.id));
    await A.aturProgram(admin, { commission: [{ type: 'percentage', value: 10 }] });

    // ---------- 4. Pembeli dihapus setelah pesanannya selesai ----------
    const D = await A.daftarPembeli(toko, CAP, 'd', { name: `Pembeli Dihapus ${CAP}` });
    const oD = await A.pesan(toko, D, [{ product_id: P2.id, qty: 1 }], { cookie: kUmum.cookie });
    await A.konfirmasi(admin, oD.id);
    const hapusD = await q(admin, { table: 'customers', action: 'delete', filters: [{ type: 'eq', column: 'id', value: D.id }] });
    const adaD = psql(`select count(*) from public.customers where id = '${D.id}'`);
    const orderA = await panggil('GET', '/api/customer/affiliate/orders', { token: Af.token });
    const barisD = (orderA.data || []).find((o) => o.order_number === oD.number);
    const komisiAdmin = await panggil('GET', `/api/admin/affiliate/commissions?order_id=${oD.id}`, { token: admin });
    const infoAdmin = await panggil('GET', `/api/admin/affiliate/order/${oD.id}`, { token: admin });
    record('Pembeli dihapus setelah pesanan selesai: pesanan dan komisinya tetap tampil untuk affiliate dan admin, dengan nama penerima',
      hapusD.status < 300 && adaD === '0' && orderA.status === 200 && !!barisD && barisD.buyer_name === D.name && barisD.status === 'selesai'
        && komisiAdmin.status === 200 && komisiAdmin.data.length === 1 && infoAdmin.status === 200 && infoAdmin.data.affiliate?.id === Af.id,
      `hapus ${hapusD.status} ${hapusD.error || ''}; baris ${JSON.stringify(barisD || null)}; admin ${komisiAdmin.status}/${infoAdmin.status}`);

    // ---------- 5. Produk dinonaktifkan atau dihapus setelah ada klik dan komisi ----------
    psql(`update public.products set is_active = false where id = '${P2.id}'`);
    const klikMati = await A.klik(toko, kode, { productId: P2.id });
    const daftarProduk = await panggil('GET', '/api/customer/affiliate/products', { token: Af.token });
    const komisiA = await panggil('GET', '/api/customer/affiliate/commissions', { token: Af.token });
    const namaP2 = psql(`select name from public.products where id = '${P2.id}'`);
    record('Produk dinonaktifkan: link-nya ditolak, hilang dari pembuat link, komisi lamanya tetap tampil dengan nama produk',
      klikMati.status === 404 && klikMati.error === 'Produk tidak terdaftar di database' && daftarProduk.status === 200 && !daftarProduk.data.some((p) => p.id === P2.id)
        && komisiA.status === 200 && komisiA.data.rows.some((k) => k.order_number === oD.number && k.product_name === namaP2),
      `klik ${klikMati.status} ${klikMati.error}; produk di daftar ${daftarProduk.data?.some((p) => p.id === P2.id)}`);
    psql(`update public.products set is_active = true where id = '${P2.id}'`);

    idProdukSementara = psql(`insert into public.products (store_id, name, sku, base_price, stock_qty) values ('${toko}', 'Produk Uji Affiliate ${CAP}', 'UJI-AFF-${CAP}', 50000, 5) returning id`).split(/\s/)[0];
    const klikSementara = await A.klik(toko, kode, { productId: idProdukSementara, source: 'fb', media: 'hapus' });
    const hapusProduk = await q(admin, { table: 'products', action: 'delete', filters: [{ type: 'eq', column: 'id', value: idProdukSementara }] });
    const sisaProduk = psql(`select count(*) from public.products where id = '${idProdukSementara}'`);
    const klikYatim = psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${Af.id}' and media = 'hapus' and product_id is null`);
    const akuisisi = await panggil('GET', '/api/customer/affiliate/acquisition', { token: Af.token });
    record('Produk yang pernah diklik lewat link affiliate tetap bisa dihapus, kliknya tetap terhitung',
      klikSementara.status === 200 && hapusProduk.status < 300 && sisaProduk === '0' && klikYatim === '1' && akuisisi.status === 200 && akuisisi.data.some((x) => x.media === 'hapus' && x.views === 1),
      `klik ${klikSementara.status}, hapus ${hapusProduk.status} ${hapusProduk.error || ''}, sisa ${sisaProduk}, klik tanpa produk ${klikYatim}`);
    if (sisaProduk === '0') idProdukSementara = null;

    // ---------- 6. Dua permintaan yang sama datang bersamaan ----------
    const emailGanda = `aff.undang.ganda.${CAP}@contoh.id`;
    const ganda = await Promise.all([1, 2, 3].map(() => panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailGanda, name: 'Teman Uji' } })));
    const barisGanda = psql(`select count(*) from public.affiliate_invitations where affiliate_id = '${Af.id}' and lower(email) = '${emailGanda}'`);
    record('Tombol kirim undangan tertekan tiga kali bersamaan: satu undangan tersimpan, sisanya ditolak 409',
      barisGanda === '1' && ganda.map((r) => r.status).sort().join(',') === '200,409,409', `${ganda.map((r) => r.status).join(',')}, ${barisGanda} baris`);

    const E = await A.daftarPembeli(toko, CAP, 'e', { name: `Erna Bersamaan ${CAP}` });
    await A.izinkan(admin, E.id);
    const bersama = await Promise.all([1, 2, 3, 4, 5, 6].map(() => panggil('GET', '/api/customer/affiliate', { token: E.token })));
    const kodeE = new Set(bersama.map((r) => r.data?.profile?.code));
    record('Dashboard dibuka enam kali bersamaan untuk pertama kali: satu kode yang sama di semua jawaban',
      bersama.every((r) => r.status === 200) && kodeE.size === 1 && [...kodeE][0] === psql(`select affiliate_code from public.customers where id = '${E.id}'`), [...kodeE].join(','));

    // ---------- 7. Callback pembayaran Tripay menggerakkan komisi ----------
    // Callback hanya menulis tabel orders. Yang diuji: pemicu basis data ikut
    // bekerja dari jalur itu. Permintaan dibuat di sini dengan tanda tangan dari
    // kunci lokal, tidak ada panggilan ke Tripay.
    const kunciTripay = envValue('TRIPAY_PRIVATE_KEY');
    if (!kunciTripay) {
      record('Callback Tripay: kunci lokal tersedia untuk menandatangani permintaan uji', false, 'TRIPAY_PRIVATE_KEY kosong di .env');
    } else {
      const callback = (isi, tanda) =>
        panggil('POST', '/api/tripay/callback', {
          body: isi,
          headers: { 'X-Callback-Signature': tanda ?? crypto.createHmac('sha256', kunciTripay).update(JSON.stringify(isi)).digest('hex') },
        });
      const status = (id) => psql(`select order_status || '|' || payment_status from public.orders where id = '${id}'`);
      const oLunas = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kUmum.cookie });
      const palsu = await callback({ reference: '', merchant_ref: oLunas.number, status: 'EXPIRED' }, 'f'.repeat(64));
      record('Callback bertanda tangan salah ditolak 403 dan tidak mengubah pesanan atau komisi',
        palsu.status === 403 && status(oLunas.id) === 'awaiting_confirmation|unpaid' && /:pending$/.test(komisi(oLunas.id)), `${palsu.status} ${status(oLunas.id)} ${komisi(oLunas.id)}`);
      const lunas = await callback({ reference: '', merchant_ref: oLunas.number, status: 'PAID' });
      const setelahLunas = `${status(oLunas.id)} ${komisi(oLunas.id).split(':').pop()}`;
      await A.konfirmasi(admin, oLunas.id);
      record('Callback PAID: pesanan lunas, komisi tetap Order belum selesai sampai admin mengonfirmasi, lalu Belum dibayar (D-7)',
        lunas.status === 200 && setelahLunas === 'awaiting_confirmation|paid pending' && /:added$/.test(komisi(oLunas.id)), `${lunas.status}; ${setelahLunas} -> ${status(oLunas.id)} ${komisi(oLunas.id).split(':').pop()}`);
      const oLewat = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kUmum.cookie });
      const lewat = await callback({ reference: '', merchant_ref: oLewat.number, status: 'EXPIRED' });
      record('Callback EXPIRED: pesanan dibatalkan dan komisinya ikut Dibatalkan (AC-33)',
        lewat.status === 200 && status(oLewat.id) === 'canceled|unpaid' && /:cancelled$/.test(komisi(oLewat.id)), `${lewat.status}; ${status(oLewat.id)} ${komisi(oLewat.id)}`);
    }

    // ---------- 8. Satu permintaan gagal dimuat ----------
    // Layar harus mengatakannya dan menawarkan coba lagi. Kerangka memuat tanpa
    // akhir atau daftar kosong membuat kegagalan terlihat seperti "tidak ada data".
    const GAGAL = '[data-affiliate-layar] [data-gagal-muat]';
    const ctxA = await browser.newContext({ viewport: { width: 393, height: 852 } });
    await ctxA.addInitScript((t) => {
      try {
        localStorage.setItem('tokoku.customer.token.v1', t);
      } catch (_) { /* abaikan */ }
    }, Af.token);
    const hA = await ctxA.newPage();
    await hA.route('**/api/customer/affiliate/orders*', (r) => r.abort('failed'));
    await hA.goto(BASE_URL + '/toko/affiliate?tab=order', { waitUntil: 'domcontentloaded' });
    await hA.locator(GAGAL).first().waitFor({ timeout: 12000 }).catch(() => {});
    const gagalOrder = await hA.locator(GAGAL).count();
    const tinggiTombol = gagalOrder ? Math.round((await hA.locator(GAGAL).getByRole('button', { name: 'Coba lagi' }).boundingBox())?.height ?? 0) : 0;
    await hA.unrouteAll({ behavior: 'ignoreErrors' });
    if (gagalOrder) await hA.locator(GAGAL).getByRole('button', { name: 'Coba lagi' }).click();
    await hA.locator('[data-daftar-order-affiliate]').waitFor({ timeout: 12000 }).catch(() => {});
    const barisSetelah = await hA.locator('[data-daftar-order-affiliate] > li').count();
    record('Dashboard affiliate (HP): daftar order gagal dimuat menampilkan pesan dan Coba lagi 44px, lalu Coba lagi memuat daftarnya (AL-1)',
      gagalOrder === 1 && tinggiTombol >= 44 && barisSetelah > 0 && (await hA.locator(GAGAL).count()) === 0, `${gagalOrder} pesan, tombol ${tinggiTombol}px, ${barisSetelah} baris setelah coba lagi`);

    // Rentang tanggal: kegagalan tidak boleh tampil sebagai "Tidak ada order di rentang tanggal ini."
    await hA.route('**/api/customer/affiliate/orders?*', (r) => r.abort('failed'));
    await hA.locator('#dari-tanggal').fill('2026-01-01');
    await hA.locator(GAGAL).first().waitFor({ timeout: 12000 }).catch(() => {});
    const gagalRentang = await hA.locator(GAGAL).count();
    const tampakKosong = await hA.getByText('Tidak ada order di rentang tanggal ini.').count();
    await hA.unrouteAll({ behavior: 'ignoreErrors' });
    if (gagalRentang) await hA.locator(GAGAL).getByRole('button', { name: 'Coba lagi' }).click();
    await hA.locator('[data-daftar-order-affiliate]').waitFor({ timeout: 12000 }).catch(() => {});
    record('Dashboard affiliate: rentang tanggal gagal dimuat tidak tampil sebagai daftar kosong, Coba lagi memuat hasilnya',
      gagalRentang === 1 && tampakKosong === 0 && (await hA.locator('[data-daftar-order-affiliate] > li').count()) > 0, `${gagalRentang} pesan, teks kosong ${tampakKosong}`);
    await ctxA.close();

    const ctxS = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const hS = await ctxS.newPage();
    trackApi(hS);
    await loginAdmin(hS);
    const hasilAdmin = [];
    for (const [tab, pola] of [
      ['ringkasan', '**/api/admin/affiliate/overview*'],
      ['komisi', '**/api/admin/affiliate/commissions*'],
      ['pembayaran', '**/api/admin/affiliate/payouts/summary*'],
      ['affiliate', '**/api/admin/affiliate/members*'],
      ['pengaturan', '**/api/admin/affiliate/settings'],
    ]) {
      await hS.unrouteAll({ behavior: 'ignoreErrors' });
      await hS.route(pola, (r) => r.abort('failed'));
      await hS.goto(BASE_URL + '/affiliate?tab=' + tab, { waitUntil: 'domcontentloaded' });
      await hS.locator(GAGAL).first().waitFor({ timeout: 15000 }).catch(() => {});
      const ada = await hS.locator(GAGAL).count();
      await hS.unrouteAll({ behavior: 'ignoreErrors' });
      if (ada) await hS.locator(GAGAL).first().getByRole('button', { name: 'Coba lagi' }).click();
      await hS.locator(GAGAL).first().waitFor({ state: 'detached', timeout: 12000 }).catch(() => {});
      hasilAdmin.push(`${tab}:${ada}:${await hS.locator(GAGAL).count()}`);
    }
    record('Admin affiliate: tiap tab yang gagal dimuat menampilkan pesan dan Coba lagi (bukan daftar kosong atau kerangka tanpa akhir), lalu pulih',
      hasilAdmin.join(',') === 'ringkasan:1:0,komisi:1:0,pembayaran:1:0,affiliate:1:0,pengaturan:1:0', hasilAdmin.join(','));
    await ctxS.close();

    // ---------- 9. Temuan QC sub-agent (C1, C2, C9, C10, C11) dan pesan gagal di dashboard induk ----------
    const oTolak = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kUmum.cookie });
    await A.tolak(admin, oTolak.id);
    const ctxH = await browser.newContext({ viewport: { width: 393, height: 852 } });
    await ctxH.addInitScript((t) => {
      try {
        localStorage.setItem('tokoku.customer.token.v1', t);
      } catch (_) { /* abaikan */ }
    }, Af.token);
    const hH = await ctxH.newPage();
    await hH.goto(BASE_URL + '/toko/affiliate?tab=order', { waitUntil: 'domcontentloaded' });
    const kartuTolak = hH.locator('[data-daftar-order-affiliate] > li', { hasText: oTolak.number });
    await kartuTolak.waitFor({ timeout: 15000 }).catch(() => {});
    const teksTolak = (await kartuTolak.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const coret = await kartuTolak.locator('b.line-through').count();
    record('Tab Order: pesanan Dibatalkan menampilkan "Komisi dibatalkan" dengan nilai dicoret, bukan "Komisi kamu" (QC C1)',
      /Dibatalkan/.test(teksTolak) && /Komisi dibatalkan/.test(teksTolak) && !/Komisi kamu/.test(teksTolak) && coret === 1, teksTolak.slice(0, 120));

    await hH.route('**/api/customer/affiliate', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'x' }) }));
    await hH.goto(BASE_URL + '/toko/affiliate?tab=ringkasan', { waitUntil: 'domcontentloaded' });
    await hH.locator('[data-gagal-muat]').first().waitFor({ timeout: 12000 }).catch(() => {});
    const teksInduk = await hH.locator('[data-gagal-muat]').first().innerText().catch(() => '');
    await hH.unrouteAll({ behavior: 'ignoreErrors' });
    record('Dashboard affiliate: galat server pada data induk menampilkan pesan AL-1, bukan pesan mentah server',
      /Data affiliate gagal dimuat\. Coba lagi\./.test(teksInduk) && !/^x$/m.test(teksInduk), teksInduk.replace(/\s+/g, ' '));
    await ctxH.close();

    // Tinggi layar 500 px supaya halaman pasti bisa digulir dengan data uji yang sedikit.
    const ctxD = await browser.newContext({ viewport: { width: 1440, height: 500 } });
    await ctxD.addInitScript((t) => {
      try {
        localStorage.setItem('tokoku.customer.token.v1', t);
      } catch (_) { /* abaikan */ }
    }, Af.token);
    const hD = await ctxD.newPage();
    await hD.goto(BASE_URL + '/toko/affiliate?tab=komisi', { waitUntil: 'domcontentloaded' });
    await hD.locator('[data-affiliate-layar] aside nav').waitFor({ timeout: 15000 }).catch(() => {});
    await hD.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await hD.waitForTimeout(300);
    const gulirAwal = await hD.evaluate(() => Math.round(window.scrollY));
    await hD.locator('[data-affiliate-layar] aside nav').getByRole('button', { name: 'Ringkasan' }).click();
    await hD.waitForTimeout(500);
    const gulirAkhir = await hD.evaluate(() => Math.round(window.scrollY));
    record('Desktop: pindah tab dari posisi gulir bawah kembali ke atas, judul dan periode tidak tertutup kepala toko (QC C2)',
      gulirAwal > 0 && gulirAkhir === 0 && (await hD.getByRole('heading', { name: 'Ringkasan', exact: true }).isVisible()), `gulir ${gulirAwal} -> ${gulirAkhir}`);
    await ctxD.close();

    const ctxP = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const hP = await ctxP.newPage();
    trackApi(hP);
    await loginAdmin(hP);
    const cookieAwal = psql(`select affiliate_settings->>'cookie_days' from public.stores where id = '${toko}'`);
    await hP.goto(BASE_URL + '/affiliate?tab=pengaturan', { waitUntil: 'domcontentloaded' });
    const kolomCookie = hP.getByLabel('Umur cookie (hari)');
    await kolomCookie.waitFor({ timeout: 15000 }).catch(() => {});
    await kolomCookie.fill('');
    await hP.getByRole('button', { name: /Simpan pengaturan/i }).click();
    await hP.waitForTimeout(800);
    const pesanCookie = (await hP.locator('[data-affiliate-layar]').innerText()).includes('Umur cookie harus 0 sampai 3.650 hari.');
    const cookieSesudah = psql(`select affiliate_settings->>'cookie_days' from public.stores where id = '${toko}'`);
    const lewatApi = await panggil('PUT', '/api/admin/affiliate/settings', { token: admin, body: { ...(await panggil('GET', '/api/admin/affiliate/settings', { token: admin })).data, cookie_days: '' } });
    record('Umur cookie dikosongkan: ditolak di layar dan di server, tidak tersimpan sebagai 0 (selamanya) (QC C9, AC-8)',
      pesanCookie && cookieSesudah === cookieAwal && lewatApi.status === 400, `layar ${pesanCookie}, tersimpan ${cookieAwal} -> ${cookieSesudah}, API ${lewatApi.status}`);

    await hP.goto(BASE_URL + '/affiliate?tab=affiliate', { waitUntil: 'domcontentloaded' });
    await hP.locator('[data-kartu-anggota]').waitFor({ timeout: 15000 }).catch(() => {});
    const jumlahMember = Number(psql(`select count(*) from public.customers where store_id = '${toko}' and user_id is not null`));
    const kartu1 = await hP.locator('[data-kartu-anggota] > li').count();
    const tinggi1 = await hP.evaluate(() => document.documentElement.scrollHeight);
    await hP.locator('[data-tampilkan-lagi]').getByRole('button').click().catch(() => {});
    await hP.waitForTimeout(400);
    const kartu2 = await hP.locator('[data-kartu-anggota] > li').count();
    record('Admin Affiliate di HP: daftar member dibuka 30 per tahap dengan tombol Tampilkan lagi (QC C11)',
      jumlahMember > 30 && kartu1 === 30 && kartu2 === Math.min(60, jumlahMember), `${jumlahMember} member, tampil ${kartu1} lalu ${kartu2}, tinggi halaman ${tinggi1}px`);

    await hP.locator('[data-kartu-anggota] > li').first().getByRole('button', { name: /Ubah/ }).click();
    const dialog = hP.getByRole('dialog');
    await dialog.waitFor({ timeout: 10000 }).catch(() => {});
    const tutup = dialog.getByRole('button', { name: 'Tutup', exact: true }).first();
    const kotak = await tutup.boundingBox().catch(() => null);
    const namaDialog = await dialog.getAttribute('aria-labelledby').catch(() => null);
    await tutup.click().catch(() => {});
    await hP.waitForTimeout(300);
    record('Dialog admin punya role dialog dengan judul, tombol Tutup 44px di HP, dan tombol itu menutupnya (QC C10)',
      !!kotak && Math.round(kotak.width) >= 44 && Math.round(kotak.height) >= 44 && !!namaDialog && (await hP.getByRole('dialog').count()) === 0,
      kotak ? `${Math.round(kotak.width)}x${Math.round(kotak.height)}px` : 'tidak ditemukan');
    await ctxP.close();
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    if (idSesiFlash) psql(`delete from public.flash_sales where id = '${idSesiFlash}'`);
    if (idProdukSementara) psql(`delete from public.products where id = '${idProdukSementara}'`);
    if (P2) psql(`update public.products set is_active = true where id = '${P2.id}'`);
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    await browser.close();
  }
  ringkas();
})();
