// Verifikasi halaman produk toko online yang disamakan dengan halaman produk
// Lazada (hanya tema yang beda), lewat alur pengguna nyata di desktop dan HP,
// plus ulasan dari akun pembeli, balasan admin, tracking supplier, dan
// pengaturan Toko Online.
const { chromium } = require('playwright');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { BASE_URL: BASE, DB_PASSWORD, trackApi, waitForApiIdle, loginAdmin } = require('./lib/harness.cjs');

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();
const sql = (q) =>
  execFileSync(PSQL, ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: DB_PASSWORD },
    encoding: 'utf8',
  }).trim();
const first = (q) => sql(q).split('\n')[0].trim();

const TS = Date.now().toString(36).toUpperCase();
const NAMA = `Gear Depan Uji Lazada ${TS}`;
const EMAIL = `uji.lazada.${TS.toLowerCase()}@contoh.id`;
const svg = (warna) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${warna}"/><circle cx="200" cy="200" r="120" fill="#fff" opacity=".6"/></svg>`).toString('base64');

(async () => {
  const results = [];
  const record = (n, p, d) => {
    results.push({ n, p });
    console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d !== undefined ? ' — ' + d : ''));
  };
  const S = first('select id from public.stores order by created_at limit 1;');
  const tokoLama = first(`select coalesce(shop_phone,'')||'|'||coalesce(return_policy,'')||'|'||coalesce(warranty_info,'')||'|'||coalesce(pdp_banner_url,'') from public.stores where id='${S}';`);
  sql(`update public.stores set shop_phone='081234567890', return_policy=E'100% Ori\\nPengembalian Gratis 7 Hari',
         warranty_info=null, pdp_banner_url='${svg('#10b981')}' where id='${S}';`);

  const galeri = JSON.stringify([svg('#f97316'), svg('#0ea5e9')]).replace(/'/g, "''");
  const spec = JSON.stringify([{ label: 'Bahan', value: 'Baja karbon' }, { label: 'Model', value: '415' }]);
  const buatVarian = (label, harga, stok) =>
    first(`insert into public.products(store_id, name, sku, base_price, compare_at_price, brand, variant_name, variant_label,
             images, image_url, video_url, spec, warranty_type, warranty_period, box_contents, highlights, license_type,
             license_code, is_active, track_stock, stock_qty, weight_gram, description)
           values ('${S}', '${NAMA}', 'UJILZ-${label}-${TS}', ${harga}, 250000, 'GNNK Racing', '${label}', 'Ukuran',
             '${galeri}'::jsonb, '${svg('#6366f1')}', 'https://youtu.be/dQw4w9WgXcQ', '${spec}'::jsonb, 'Garansi toko', '1 Tahun',
             '1 gear depan, 1 kartu garansi', E'Baja karbon tahan aus\\nPresisi untuk rantai 415', 'Standar Nasional Indonesia (SNI)',
             'SNI-415-UJI', true, true, ${stok}, 120, 'Gear depan racing uji.')
           returning id;`);
  const V12 = buatVarian('12T', 175000, 8);
  const V13 = buatVarian('13T', 185000, 5);
  buatVarian('14T', 195000, 0);

  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await admin.newPage();
  page.setDefaultTimeout(30000);
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
  const tamuCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const t = await tamuCtx.newPage();
  t.setDefaultTimeout(30000);
  t.on('pageerror', (e) => console.log('  [pageerror tamu] ' + e.message));

  try {
    // ---------- Akun pembeli + pesanan selesai ----------
    await t.goto(BASE + '/toko', { waitUntil: 'networkidle' });
    const daftar = await t.evaluate(async ([sid, email]) => {
      const r = await fetch('/api/customer/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: sid, name: 'Budi Pembeli', email, phone: '081299990000', password: 'rahasia123', privacy_accepted: true }),
      });
      return r.status;
    }, [S, EMAIL]);
    record('Akun pembeli uji dibuat', daftar === 200, String(daftar));
    const CUST = first(`select id from public.customers where email='${EMAIL}';`);
    for (const n of [1, 2]) {
      const ORD = first(`insert into public.orders(store_id, order_number, subtotal, tax, discount, total, payment_method,
                           payment_status, order_status, points_earned, customer_id, customer_name, sales_channel)
                         values ('${S}', 'UJILZ-${TS}-${n}', 175000, 0, 0, 175000, 'cash', 'paid', 'done', 0, '${CUST}', 'Budi Pembeli', 'website')
                         returning id;`);
      sql(`insert into public.order_items(order_id, product_id, name, qty, price) values ('${ORD}', '${V12}', '${NAMA}', 1, 175000);`);
    }

    // ---------- Katalog ----------
    await t.goto(BASE + '/toko?q=' + encodeURIComponent(NAMA), { waitUntil: 'networkidle' });
    await t.waitForTimeout(1500);
    const kartu = t.locator('a[data-kartu-produk]').filter({ hasText: NAMA });
    record('Katalog: produk bervariasi tampil sebagai SATU kartu', (await kartu.count()) === 1);

    // ---------- Ulasan dengan tag dari akun ----------
    await t.goto(BASE + '/toko/masuk?next=/toko/akun', { waitUntil: 'networkidle' });
    await t.getByLabel('No. Handphone/Email').fill(EMAIL);
    await t.getByLabel('Kata sandi').fill('rahasia123');
    await t.locator('main form button[type="submit"]').click();
    await t.waitForURL((u) => u.pathname.includes('/toko/akun'), { timeout: 15000 }).catch(() => {});
    await t.waitForTimeout(1200);
    await t.getByRole('button', { name: /^Ulasan/ }).click();
    await t.waitForTimeout(800);
    await t.getByRole('button', { name: 'Beri Ulasan' }).first().click();
    await t.waitForTimeout(400);
    await t.getByRole('button', { name: '5 bintang' }).click();
    await t.getByRole('button', { name: 'Barang bagus' }).click();
    await t.getByRole('button', { name: 'Dikemas dengan baik' }).click();
    await t.getByLabel('Ulasan', { exact: true }).fill('Gearnya presisi, pengiriman cepat. Mantap!');
    await t.getByRole('button', { name: 'Kirim Ulasan' }).click();
    await t.waitForTimeout(1500);
    record('Ulasan dengan tag tersimpan',
      first(`select tags::text from public.product_reviews where product_id='${V12}';`).includes('Barang bagus'));

    // ---------- Halaman produk (desktop) ----------
    await t.goto(`${BASE}/toko/produk?id=${V12}`, { waitUntil: 'networkidle' });
    await t.waitForTimeout(1800);
    const teks = await t.locator('body').innerText();
    await t.screenshot({ path: path.join(SHOT_DIR, 'lz2_pdp_atas.png') });
    record('Jalur halaman (Beranda > produk)', /Beranda/.test(teks));
    record('Rating ringkas "5.0(1)" di bawah judul', /5\.0\(1\)/.test(teks));
    record('Merek + "Lebih banyak ... dari GNNK Racing"', /Merek:\s*GNNK Racing/.test(teks) && /dari GNNK Racing/.test(teks));
    record('Banner promo toko tampil', (await t.locator('img[alt="Promo toko"]').count()) > 0);
    record('Harga, harga coret, persen diskon', /175\.000/.test(teks) && /250\.000/.test(teks) && /-30%/.test(teks));
    record('Baris "Pilihan pengiriman"', /Pilihan pengiriman/.test(teks) && /UBAH/.test(teks));
    record('Baris "Pengembalian & Garansi" dari jaminan toko + garansi produk',
      /Pengembalian & Garansi/.test(teks) && /100% Ori · Pengembalian Gratis 7 Hari · 1 Tahun Garansi toko/.test(teks));
    record('Nama atribut variasi "Ukuran:" dengan pilihan 12T/13T/14T',
      /Ukuran:/.test(teks) && ['12T', '13T', '14T'].every((v) => teks.includes(v)));
    record('Kuantitas, Beli sekarang, Tambah ke keranjang, Bagikan, Suka',
      /Kuantitas:/.test(teks) && /Beli sekarang/.test(teks) && /Tambah ke keranjang/.test(teks) && /Bagikan/.test(teks) && /Suka/.test(teks));
    record('Galeri: thumbnail foto + video', (await t.locator('button[aria-label="Video produk"]').count()) === 1 &&
      (await t.locator('button[aria-label^="Foto "]').count()) === 3);
    record('Kartu penjual: Nilai Toko, Terjual oleh Toko, Pelanggan Tetap, Chat, KUNJUNGI TOKO',
      /Nilai Toko/.test(teks) && /Terjual oleh Toko/.test(teks) && /Pelanggan Tetap/.test(teks) && /KUNJUNGI TOKO/.test(teks));
    record('Tab Ulasan | Detail Produk | Rekomendasi',
      (await t.locator('a[href="#ulasan"]').count()) > 0 && (await t.locator('a[href="#detail-produk"]').count()) > 0 &&
        (await t.locator('a[href="#rekomendasi"]').count()) > 0);
    record('Ulasan: filter bintang & urutan', (await t.getByLabel('Filter bintang').count()) === 1 && (await t.getByLabel('Urutkan ulasan').count()) === 1);
    record('Ulasan: chip "Dengan gambar/video", "Pelanggan berulang(1)", tag "Barang bagus(1)"',
      /Dengan gambar\/video\(0\)/.test(teks) && /Pelanggan berulang\(1\)/.test(teks) && /Barang bagus\(1\)/.test(teks));
    record('Ulasan tampil dengan ukuran variasi dan isi', /Ukuran: 12T/.test(teks) && teks.includes('Gearnya presisi'));
    await t.getByRole('button', { name: /^Helpful\(0\)/ }).click();
    await t.waitForTimeout(800);
    record('Tombol Helpful menambah hitungan', (await t.getByRole('button', { name: /^Helpful\(1\)/ }).count()) === 1 &&
      first(`select helpful_count from public.product_reviews where product_id='${V12}';`) === '1');
    record('Detail Produk: Spesifikasi (Merek, SKU, Bahan, Model, garansi)',
      /Spesifikasi/.test(teks) && teks.includes(`UJILZ-12T-${TS}`) && /Baja karbon/.test(teks) && /Periode Garansi/.test(teks));
    record('Detail Produk: isi kotak, kualifikasi SNI, sorotan, deskripsi',
      /Apa yang ada di dalam kotak/.test(teks) && /Kualifikasi/.test(teks) && /SNI-415-UJI/.test(teks) && /Sorotan/.test(teks) && /Deskripsi/.test(teks));
    record('Tidak ada bagian tanya jawab (Lazada tidak punya)', !/Pertanyaan tentang produk/.test(teks));
    record('"Dari Toko yang Sama" dan "Kamu mungkin suka juga"', /Dari Toko yang Sama/.test(teks) && /Kamu mungkin suka juga/.test(teks));
    await t.screenshot({ path: path.join(SHOT_DIR, 'lz2_pdp_desktop.png'), fullPage: true });

    await t.locator('button[aria-pressed]').filter({ hasText: '13T' }).first().click();
    await t.waitForURL((u) => u.searchParams.get('id') === V13, { timeout: 10000 }).catch(() => {});
    record('Klik ukuran 13T membuka variasinya', new URL(t.url()).searchParams.get('id') === V13);

    // ---------- HP ----------
    await t.setViewportSize({ width: 412, height: 915 });
    await t.goto(`${BASE}/toko/produk?id=${V12}`, { waitUntil: 'networkidle' });
    await t.waitForTimeout(1500);
    const teksHp = await t.locator('body').innerText();
    const lebar = await t.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    record('HP: tidak melebar', lebar[0] <= lebar[1] + 1, lebar.join(' vs '));
    record('HP: penghitung galeri 1/4', /1\/4/.test(teksHp));
    record('HP: baris Pilihan Produk, Spesifikasi, Pengiriman, Layanan',
      /Pilihan Produk/.test(teksHp) && /Spesifikasi/.test(teksHp) && /Pengiriman/.test(teksHp) && /Layanan/.test(teksHp));
    record('HP: ringkasan "Penilaian & Ulasan (1)"', /Penilaian & Ulasan \(1\)/.test(teksHp));
    record('HP: bar bawah Toko, Chat, Beli Sekarang, + Keranjang',
      (await t.getByRole('link', { name: 'Toko', exact: true }).isVisible()) &&
        (await t.getByRole('button', { name: /^Beli Sekarang$/ }).isVisible()));
    await t.screenshot({ path: path.join(SHOT_DIR, 'lz2_pdp_hp.png') });
    await t.getByRole('button', { name: /Pilihan Produk/ }).click();
    await t.waitForTimeout(500);
    record('HP: ketuk Pilihan Produk membuka lembar variasi & kuantitas',
      /Kuantitas/.test(await t.locator('body').innerText()) && (await t.getByRole('button', { name: 'Tutup' }).isVisible()));
    await t.screenshot({ path: path.join(SHOT_DIR, 'lz2_pdp_hp_lembar.png') });

    // ---------- Admin: balas ulasan ----------
    await loginAdmin(page);
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {});
    await page.goto(BASE + '/feedback', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 1500 });
    record('Menu admin "Ulasan Produk"', /Ulasan Produk/.test(await page.locator('body').innerText()));
    const kartuUlasan = page.locator('.card').filter({ hasText: 'Gearnya presisi, pengiriman cepat' });
    await kartuUlasan.getByLabel('Balasan penjual').fill('Terima kasih sudah belanja, Kak!');
    await kartuUlasan.getByRole('button', { name: 'Simpan Balasan' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, 'lz2_admin_ulasan.png') });
    await t.setViewportSize({ width: 1440, height: 1000 });
    await t.reload({ waitUntil: 'networkidle' });
    await t.waitForTimeout(1200);
    record('Balasan penjual tampil di ulasan', (await t.locator('body').innerText()).includes('Terima kasih sudah belanja, Kak!'));

    // ---------- Tracking supplier ----------
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    record('Dashboard punya kartu Tracking Supplier', /Tracking Supplier/.test(await page.locator('body').innerText()));
    await page.goto(BASE + '/suppliers', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 1500 });
    await page.getByRole('button', { name: /^Tracking$/ }).first().click();
    await page.waitForTimeout(800);
    const modal = await page.locator('div.fixed.inset-0').last().innerText();
    record('Modal Tracking supplier', /Tracking /.test(modal) && /Sisa utang/.test(modal));
    await page.keyboard.press('Escape');

    // ---------- Pengaturan & form produk ----------
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const teksSet = await page.locator('body').innerText();
    record('Pengaturan Toko Online: WhatsApp, jaminan per baris, banner',
      /Nomor WhatsApp toko/.test(teksSet) && /Pengembalian & jaminan/.test(teksSet) && /Banner promo halaman produk/.test(teksSet));
    await page.goto(BASE + '/products', { waitUntil: 'networkidle' });
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 1500 });
    await page.getByRole('button', { name: /Tambah Produk/i }).first().click();
    await page.waitForTimeout(800);
    const teksForm = await page.locator('div.fixed.inset-0').last().innerText();
    record('Form produk: detail halaman toko online (atribut variasi, spesifikasi, garansi, isi kotak, sorotan, lisensi, video)',
      /Detail halaman toko online/i.test(teksForm) && /Nama atribut variasi/.test(teksForm) && /Spesifikasi/.test(teksForm) &&
        /Jenis garansi/.test(teksForm) && /Apa yang ada di dalam kotak/.test(teksForm) && /Sorotan/.test(teksForm) &&
        /Tipe lisensi/.test(teksForm) && /Video produk/.test(teksForm));
    await page.screenshot({ path: path.join(SHOT_DIR, 'lz2_form_produk.png') });
  } catch (e) {
    record('Skrip berjalan tanpa error', false, e.message.split('\n').slice(0, 3).join(' | '));
    await t.screenshot({ path: path.join(SHOT_DIR, 'lz2_gagal_tamu.png') }).catch(() => {});
    await page.screenshot({ path: path.join(SHOT_DIR, 'lz2_gagal_admin.png') }).catch(() => {});
  } finally {
    const [hp, retur, garansi, banner] = tokoLama.split('|');
    const nilai = (v) => (v ? `'${v.replace(/'/g, "''")}'` : 'null');
    sql(`update public.stores set shop_phone=${nilai(hp)}, return_policy=${nilai(retur)}, warranty_info=${nilai(garansi)},
           pdp_banner_url=${nilai(banner)} where id='${S}';`);
    sql(`delete from public.orders where order_number like 'UJILZ-%';`);
    sql(`delete from public.products where sku like 'UJILZ-%';`);
    sql(`delete from public.customers where email like 'uji.lazada.%@contoh.id';`);
    sql(`delete from public.profiles where email like 'uji.lazada.%@contoh.id';`);
    sql(`delete from public.app_users where email like 'uji.lazada.%@contoh.id';`);
    await browser.close();
    const gagal = results.filter((r) => !r.p).length;
    console.log(`\n${results.length - gagal}/${results.length} lulus`);
    process.exit(gagal ? 1 : 0);
  }
})();
