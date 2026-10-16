// Verifikasi butir 14a PERMINTAAN-CLIENT.md dan cacat C2.
//
// Kutipan client (video B, 28 Sep): "Pajak ini, menu-nya checklist … mau pakai
// pajak ataupun tidak, itu disini bisa di checklist … opsinya disesuaikan dari
// proses transaksi". Spreadsheet 4.16: "ada fitur pajak bisa ceklist pada waktu
// input penjualan … meskipun di pengaturan ada setting pajak".
//
// Yang diuji:
//   - Panel pesanan POS punya centang pajak, tercentang bawaan kalau tarif
//     pajak toko > 0.
//   - Tanpa centang: pesanan tersimpan dengan pajak 0 dan total = subtotal.
//   - Pilihan berlaku per transaksi: pesanan berikutnya kembali tercentang.
//   - Dengan centang: pajak 10% dari subtotal ditambahkan (mode bawaan toko).
//   - Order yang di-park lalu di-resume membawa pilihan pajaknya.
//   - Saklar "Pajak tercentang otomatis" di pengaturan menentukan keadaan awal
//     centang di tiap transaksi.
//   - C2: pengaturan "Harga sudah termasuk pajak" yang diubah dari perangkat
//     lain terbaca kasir yang sedang terbuka, tanpa membuka ulang aplikasi.
//     Di video, kasir pukul 20.37 masih menambahkan pajak padahal pengaturan
//     sudah "termasuk pajak".

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, ADMIN_PASSWORD, DB_PASSWORD, BASE_URL } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const TAG = 'UJIPJK' + Date.now().toString().slice(-6);
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined ? ' — ' + ket : ''));
};

(async () => {
  const STORE = psql('select id from public.stores order by created_at limit 1;');
  const tarifAwal = psql(`select tax_rate from public.stores where id = '${STORE}';`);
  const fiturAwal = psql(`select coalesce(features::text, 'null') from public.stores where id = '${STORE}';`);
  const alamatAwal = psql(`select coalesce(address, '') from public.stores where id = '${STORE}';`);
  // Mode awal yang diketahui: pajak 10% ditambahkan ke total.
  psql(`update public.stores set tax_rate = 10,
          features = coalesce(features, '{}'::jsonb) || '{"taxInclusive": false}'::jsonb where id = '${STORE}';`);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  trackApi(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const cek = () => page.locator('#cek-pajak');
  async function isiKeranjang(nomor) {
    await page.locator('.card').filter({ hasText: /Add to Cart/i }).first()
      .getByRole('button', { name: /Add to Cart/i }).click();
    await page.waitForTimeout(1200);
    await page.locator('#input-order-id').fill(nomor);
    await page.waitForTimeout(400);
  }
  async function simpan() {
    await page.locator('#btn-place-order').click();
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 2500, timeoutMs: 120000 });
    await page.waitForTimeout(1200);
    // Tutup struk supaya panel pesanan kosong untuk transaksi berikutnya.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }
  const pesanan = (nomor) => {
    const r = psql(`select subtotal::numeric(14,2) || '|' || tax::numeric(14,2) || '|' || total::numeric(14,2) || '|' || coalesce(tax_inclusive::text,'null')
                    from public.orders where order_number = '${nomor}';`);
    const [subtotal, tax, total, inklusif] = r.split('|');
    return { ada: !!r, subtotal: Number(subtotal), tax: Number(tax), total: Number(total), inklusif };
  };

  try {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    await page.goto(BASE_URL + '/menu', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });

    // ---------- 1. Tanpa pajak ----------
    const n1 = TAG + '-TANPA';
    await isiKeranjang(n1);
    record('Panel pesanan punya centang pajak', (await cek().count()) === 1);
    record('Centang pajak tercentang bawaan saat tarif toko 10%', await cek().isChecked().catch(() => false));
    await cek().uncheck();
    await page.waitForTimeout(400);
    const panelTanpa = await page.locator('label[for="cek-pajak"]').innerText().catch(() => '');
    record('Tanpa centang, panel menulis pajak tidak dikenakan', /tidak dikenakan/i.test(panelTanpa), panelTanpa.replace(/\s+/g, ' '));
    await simpan();
    const p1 = pesanan(n1);
    record('Pesanan tanpa centang: pajak 0 dan total = subtotal',
      p1.ada && p1.tax === 0 && p1.total === p1.subtotal, JSON.stringify(p1));

    // ---------- 2. Transaksi berikutnya kembali tercentang ----------
    const n2 = TAG + '-PAKAI';
    await isiKeranjang(n2);
    record('Transaksi berikutnya kembali tercentang (pilihan per transaksi)', await cek().isChecked().catch(() => false));
    await simpan();
    const p2 = pesanan(n2);
    record('Pesanan dengan centang: pajak 10% ditambahkan ke total',
      p2.ada && Math.abs(p2.tax - p2.subtotal * 0.1) < 0.01 && Math.abs(p2.total - p2.subtotal * 1.1) < 0.01 && p2.inklusif === 'false',
      JSON.stringify(p2));

    // ---------- 3. Park dan resume membawa pilihan pajak ----------
    const n3 = TAG + '-PARK';
    await isiKeranjang(n3);
    await cek().uncheck();
    await page.locator('#btn-park-order').click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /parked/i }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Resume/i }).first().click();
    await page.waitForTimeout(1000);
    record('Order yang di-resume tetap tanpa centang pajak', !(await cek().isChecked().catch(() => true)));
    await page.locator('#input-order-id').fill(n3);
    await simpan();
    const p3 = pesanan(n3);
    record('Pesanan hasil resume tersimpan tanpa pajak', p3.ada && p3.tax === 0, JSON.stringify(p3));

    // ---------- 4. C2: pengaturan dari perangkat lain terbaca tanpa buka ulang ----------
    const n4 = TAG + '-INKL';
    await isiKeranjang(n4);
    const sebelum = await page.locator('label[for="cek-pajak"]').innerText().catch(() => '');
    psql(`update public.stores set features = coalesce(features, '{}'::jsonb) || '{"taxInclusive": true}'::jsonb where id = '${STORE}';`);
    // Kasir kembali ke jendela aplikasi.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(
      () => /termasuk harga/i.test(document.querySelector('label[for="cek-pajak"]')?.textContent || ''),
      null, { timeout: 20000 },
    ).catch(() => {});
    const sesudah = await page.locator('label[for="cek-pajak"]').innerText().catch(() => '');
    record('Kasir yang terbuka membaca perubahan "Harga sudah termasuk pajak" tanpa dibuka ulang',
      !/termasuk harga/i.test(sebelum) && /termasuk harga/i.test(sesudah),
      `${sebelum.replace(/\s+/g, ' ')} -> ${sesudah.replace(/\s+/g, ' ')}`);
    await simpan();
    const p4 = pesanan(n4);
    record('Pesanan sesudahnya memakai pajak termasuk harga (total = subtotal)',
      p4.ada && p4.inklusif === 'true' && p4.total === p4.subtotal && p4.tax > 0, JSON.stringify(p4));

    // ---------- 4b. Database putus: toko contoh dari server tidak boleh menimpa pengaturan ----------
    // Saat koneksi database gagal, server menjawab kueri stores dengan toko
    // contoh (id lain, "Toko Aplikasi Kasir", pajak 10%) tanpa galat. Pemuatan
    // ulang berkala tidak boleh menelannya: kasir yang sedang berjualan akan
    // tiba-tiba memakai nama dan tarif pajak toko contoh.
    const n4b = TAG + '-PUTUS';
    await isiKeranjang(n4b);
    psql(`update public.stores set tax_rate = 11 where id = '${STORE}';`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => /Pajak 11%/.test(document.querySelector('label[for="cek-pajak"]')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
    const labelAsli = (await page.locator('label[for="cek-pajak"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    // Isi tabel toko di salinan lokal, untuk dibandingkan sebelum dan sesudah
    // putus. Peramban baru sudah berisi toko contoh dari data awal lokal, jadi
    // yang diuji adalah isinya tidak berubah, bukan barisnya tidak ada.
    const tokoLokal = () => page.evaluate(async () => {
      const dbx = await new Promise((res, rej) => { const r = indexedDB.open('kasir'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      const semua = await new Promise((res) => { const t = dbx.transaction('stores').objectStore('stores').getAll(); t.onsuccess = () => res(t.result); });
      return semua.map((x) => `${x.id}|${x.name}|${x.tax_rate}`).sort().join(' ; ');
    });
    const lokalSebelum = await tokoLokal();
    let jawabanContoh = 0;
    const tokoContoh = { id: 'store-default-001', name: 'Toko Aplikasi Kasir', currency: 'IDR', tax_rate: 10, low_stock_threshold: 10, points_per_amount: 0.01 };
    const tiruPutus = async (route) => {
      let badan = null;
      try { badan = route.request().postDataJSON(); } catch { badan = null; }
      if (badan && badan.table === 'stores' && (badan.action || 'select') === 'select') {
        jawabanContoh += 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: badan.single || badan.maybeSingle ? tokoContoh : [tokoContoh] }) });
      }
      return route.continue();
    };
    await page.route('**/api/query', tiruPutus);
    // Pemuatan ulang paling cepat tiap 10 detik; ulangi fokus sampai kueri toko benar-benar terkirim.
    for (let i = 0; i < 4 && jawabanContoh === 0; i += 1) {
      await page.waitForTimeout(6000);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(1500);
    const labelSaatPutus = (await page.locator('label[for="cek-pajak"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const lokalSesudah = await tokoLokal();
    await page.unroute('**/api/query', tiruPutus);
    record('Database putus: jawaban toko contoh tidak mengganti tarif pajak di kasir yang terbuka',
      jawabanContoh >= 1 && /Pajak 11%/.test(labelAsli) && /Pajak 11%/.test(labelSaatPutus), `${jawabanContoh} jawaban toko contoh, label "${labelAsli}" -> "${labelSaatPutus}"`);
    record('Database putus: salinan lokal toko tidak berubah', !!lokalSebelum && lokalSesudah === lokalSebelum, `${lokalSebelum} -> ${lokalSesudah}`);
    psql(`update public.stores set tax_rate = 10 where id = '${STORE}';`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => /Pajak 10%/.test(document.querySelector('label[for="cek-pajak"]')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
    await page.locator('#btn-cancel-order').click().catch(() => {});
    await page.waitForTimeout(600);

    // ---------- 5. Sambungan: pemuatan ulang bertemu form Pengaturan ----------
    // Form Pengaturan disamakan ulang tiap data toko berganti. Pemuatan ulang
    // berkala tidak boleh menghapus isian yang sedang diketik admin.
    const centangInklusif = () => page.locator('label').filter({ hasText: 'Harga sudah termasuk pajak' })
      .locator('input[type="checkbox"]');
    await page.goto(BASE_URL + '/settings', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    // Form bersih: perubahan dari perangkat lain harus tampil tanpa dibuka ulang.
    const sebelumBersih = await centangInklusif().isChecked();
    psql(`update public.stores set features = coalesce(features, '{}'::jsonb) || '{"taxInclusive": ${!sebelumBersih}}'::jsonb where id = '${STORE}';`);
    await page.waitForTimeout(11000); // lewati jeda minimal antar pemuatan ulang
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction((harap) => {
      const l = Array.from(document.querySelectorAll('label')).find((x) => (x.textContent || '').includes('Harga sudah termasuk pajak'));
      const c = l && l.querySelector('input[type="checkbox"]');
      return !!c && c.checked === harap;
    }, !sebelumBersih, { timeout: 15000 }).catch(() => {});
    record('Pengaturan tanpa isian baru: perubahan dari perangkat lain tampil sendiri',
      (await centangInklusif().isChecked()) === !sebelumBersih, `sebelum=${sebelumBersih} sesudah=${await centangInklusif().isChecked()}`);

    // Form sedang diketik: isian tidak boleh hilang saat data toko berganti lagi.
    const alamat = page.locator('label:text-is("Alamat") + input');
    const ketikan = 'Alamat sedang diketik ' + TAG;
    await alamat.fill(ketikan);
    psql(`update public.stores set features = coalesce(features, '{}'::jsonb) || '{"taxInclusive": ${sebelumBersih}}'::jsonb where id = '${STORE}';`);
    await page.waitForTimeout(11000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitForApiIdle(page, { idleMs: 2000, minWaitMs: 2500 });
    record('Pengaturan sedang diketik: pemuatan ulang tidak menghapus ketikan admin',
      (await alamat.inputValue()) === ketikan, await alamat.inputValue());
    // Kolom yang tidak disentuh admin ikut nilai terbaru, supaya menyimpan
    // alamat tidak membatalkan perubahan pajak dari perangkat lain.
    record('Pengaturan sedang diketik: saklar yang tidak disentuh ikut nilai dari perangkat lain',
      (await centangInklusif().isChecked()) === sebelumBersih, `centang=${await centangInklusif().isChecked()} harap=${sebelumBersih}`);
    await page.getByRole('button', { name: /^Simpan$/ }).first().click();
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    const tersimpan = psql(`select address || '|' || coalesce(features->>'taxInclusive', 'null') from public.stores where id = '${STORE}';`);
    record('Simpan sesudahnya menyimpan ketikan admin tanpa menimpa perubahan perangkat lain',
      tersimpan === `${ketikan}|${sebelumBersih}`, tersimpan);

    // ---------- 5b. Saklar bawaan pajak yang baru dimatikan bertahan saat data toko berganti ----------
    // Saklar "Pajak tercentang otomatis" bawaannya nyala walau belum pernah
    // disimpan. Penggabungan form dulu menganggap "belum diisi" sama dengan
    // mati, jadi admin yang mematikannya tidak terbaca sebagai perubahan dan
    // saklarnya kembali nyala begitu data toko berganti dari perangkat lain.
    psql(`update public.stores set features = coalesce(features, '{}'::jsonb) - 'taxDefaultOn' where id = '${STORE}';`);
    await page.goto(BASE_URL + '/settings', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    const saklarBawaan = () => page.locator('label').filter({ hasText: 'Pajak tercentang otomatis tiap penjualan' })
      .locator('input[type="checkbox"]');
    const bawaanAwal = await saklarBawaan().isChecked().catch(() => null);
    await saklarBawaan().uncheck();
    const inklusifKini = await centangInklusif().isChecked();
    psql(`update public.stores set features = coalesce(features, '{}'::jsonb) || '{"taxInclusive": ${!inklusifKini}}'::jsonb where id = '${STORE}';`);
    await page.waitForTimeout(11000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction((harap) => {
      const l = Array.from(document.querySelectorAll('label')).find((x) => (x.textContent || '').includes('Harga sudah termasuk pajak'));
      const c = l && l.querySelector('input[type="checkbox"]');
      return !!c && c.checked === harap;
    }, !inklusifKini, { timeout: 15000 }).catch(() => {});
    record('Saklar bawaan pajak yang baru dimatikan tidak kembali nyala saat data toko berganti',
      bawaanAwal === true && (await saklarBawaan().isChecked()) === false && (await centangInklusif().isChecked()) === !inklusifKini,
      `awal=${bawaanAwal}, sesudah=${await saklarBawaan().isChecked()}, inklusif ikut perangkat lain=${(await centangInklusif().isChecked()) === !inklusifKini}`);
    await page.getByRole('button', { name: /^Simpan$/ }).first().click().catch(() => {});
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    const bawaanTersimpan = psql(`select coalesce(features->>'taxDefaultOn', 'null') from public.stores where id = '${STORE}';`);
    record('Simpan sesudahnya menyimpan saklar itu sebagai mati', bawaanTersimpan === 'false', bawaanTersimpan);

    // ---------- 6. Bawaan centang dari pengaturan ----------
    // Produksi per 3 Okt bertarif 0%: client yang biasanya menjual tanpa pajak
    // mematikan "Pajak tercentang otomatis" lalu mencentang hanya saat perlu.
    psql(`update public.stores set tax_rate = 10,
            features = coalesce(features, '{}'::jsonb) || '{"taxDefaultOn": false, "taxInclusive": false}'::jsonb where id = '${STORE}';`);
    await page.goto(BASE_URL + '/menu', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    const n6 = TAG + '-BAWAAN';
    await isiKeranjang(n6);
    record('Bawaan dimatikan: transaksi baru mulai tanpa centang pajak',
      (await cek().count()) === 1 && !(await cek().isChecked()), 'tercentang=' + (await cek().isChecked().catch(() => '-')));
    await simpan();
    const p6 = pesanan(n6);
    record('Bawaan dimatikan: pesanan tersimpan tanpa pajak', p6.ada && p6.tax === 0 && p6.total === p6.subtotal, JSON.stringify(p6));
    const n7 = TAG + '-CENTANG';
    await isiKeranjang(n7);
    record('Bawaan dimatikan: transaksi berikutnya kembali tanpa centang', !(await cek().isChecked()));
    await cek().check();
    await simpan();
    const p7 = pesanan(n7);
    record('Bawaan dimatikan: dicentang manual, pajak 10% ditambahkan',
      p7.ada && Math.abs(p7.tax - p7.subtotal * 0.1) < 0.01, JSON.stringify(p7));

    console.log('');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + String(e.message || e).slice(0, 300));
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + Math.max(hasil.length, 11) + ' lolos');
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`update public.stores set address = '${alamatAwal.replace(/'/g, "''")}' where id = '${STORE}';`);
      psql(`update public.stores set tax_rate = ${tarifAwal || 10},
              features = ${fiturAwal === 'null' ? 'null' : `'${fiturAwal.replace(/'/g, "''")}'::jsonb`}
            where id = '${STORE}';`);
      // Stok yang terpotong pesanan uji dikembalikan, supaya produk pertama
      // di POS tidak habis setelah suite ini dijalankan berkali-kali.
      psql(`update public.products p set stock_qty = p.stock_qty + s.q
              from (select i.product_id, sum(i.qty) as q
                      from public.order_items i join public.orders o on o.id = i.order_id
                     where o.order_number like '${TAG}%' and i.product_id is not null
                     group by i.product_id) s
             where p.id = s.product_id and p.track_stock;`);
      psql(`delete from public.stock_movements m using public.orders o where o.id = m.ref_order_id and o.order_number like '${TAG}%';`);
      psql(`delete from public.order_items i using public.orders o where o.id = i.order_id and o.order_number like '${TAG}%';`);
      psql(`delete from public.orders where order_number like '${TAG}%';`);
    } catch (e) {
      console.log('Pembersihan gagal: ' + String(e.message || e).slice(0, 200));
    }
  }
})();
