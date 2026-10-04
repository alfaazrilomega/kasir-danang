// Verifikasi butir 13 PERMINTAAN-CLIENT.md: biaya susulan PO dicatat di
// Pengeluaran, ditempel ke nota PO, dan masuk HPP barangnya.
//
// Kutipan client (video A, 28 Sep): "di sini itu auto atau bisa memilih dengan
// opsi si PO tersebut … dan auto-klem ke si bagian si pembelian supplier" ·
// "Jadi nanti ongkos kirimnya itu menambahkan dari si harga barang. Jadi
// HPP-nya itu bisa full".
//
// Yang diuji:
//   - Form Catat Pengeluaran punya pilihan nota PO, dan baris tersimpan dengan
//     purchase_id nota itu tanpa slot (bukan baris otomatis dari form nota).
//   - Beberapa biaya bertahap bisa menempel ke satu nota, sebelum dan sesudah
//     barang diterima.
//   - Total, DP, dan sisa pelunasan nota TIDAK berubah karena biaya susulan.
//   - Detail nota menampilkan HPP per barang: harga beli + bagian biaya
//     (dibagi sesuai nilai barang) − bagian diskon. Angkanya dihitung di sini.
//   - Daftar Produk menampilkan "HPP penuh" dari nota terakhir yang diterima.
//   - Simpan ulang nota tidak menghapus biaya susulan; hapus nota melepas
//     biaya susulan (tetap ada di Pengeluaran) tapi menghapus baris otomatisnya.
//   - Mengedit biaya susulan di Pengeluaran tidak melepasnya dari nota.
//   - Cacat C1: terima barang menghitung ulang total nota TANPA Biaya
//     tambahan (extra_cost), sehingga sisa pelunasan kurang.

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { trackApi, waitForApiIdle, ADMIN_PASSWORD, DB_PASSWORD, BASE_URL } = require('./lib/harness.cjs');

function psql(q) {
  return execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe',
    ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAq', '-c', q],
    { env: { ...process.env, PGPASSWORD: DB_PASSWORD }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const TAG = 'UJIHPP' + Date.now().toString().slice(-6);
const INV = 'PO-' + TAG;
const hasil = [];
const record = (nama, ok, ket) => {
  hasil.push({ nama, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nama + (ket !== undefined ? ' — ' + ket : ''));
};
const rupiah = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
// Intl id-ID memakai spasi tak-putus setelah "Rp"; disamakan dulu sebelum dicocokkan.
const teks = async (loc) => ((await loc.count()) ? (await loc.innerText()) : '').replace(/\u00a0/g, ' ');

(async () => {
  const STORE = psql('select id from public.stores order by created_at limit 1;');
  const PA = psql('select gen_random_uuid();');
  const PB = psql('select gen_random_uuid();');
  const NOTA = psql('select gen_random_uuid();');

  // Dua produk, harga beli beda supaya pembagian sesuai nilai barang teruji.
  psql(`insert into public.products (id, store_id, name, sku, base_price, cost_price, stock_qty, track_stock, is_active)
        values ('${PA}', '${STORE}', 'Gear A ${TAG}', 'A-${TAG}', 150000, 90000, 0, true, true),
               ('${PB}', '${STORE}', 'Gear B ${TAG}', 'B-${TAG}', 300000, 180000, 0, true, true);`);
  // Nota: A 10 x 100.000, B 5 x 200.000 -> nilai barang 2.000.000.
  // Diskon 100.000, biaya lain 50.000, biaya tambahan 30.000 -> total 1.980.000.
  psql(`insert into public.purchases (id, store_id, invoice_number, status, order_date, subtotal, discount, tax,
          other_cost, other_cost_label, other_cost_date, other_cost_category,
          extra_cost, extra_cost_label, extra_cost_date, extra_cost_category,
          total, currency, exchange_rate, paid_amount, dp_percent)
        values ('${NOTA}', '${STORE}', '${INV}', 'ordered', current_date, 2000000, 100000, 0,
          50000, 'Ongkir supplier', current_date, 'transport',
          30000, 'Kardus', current_date, 'perlengkapan',
          1980000, 'IDR', 1, 0, 30);`);
  psql(`insert into public.purchase_items (id, purchase_id, product_id, name, sku, qty, received_qty, cost_price, original_cost_price, currency, subtotal)
        values (gen_random_uuid(), '${NOTA}', '${PA}', 'Gear A ${TAG}', 'A-${TAG}', 10, 0, 100000, 100000, 'IDR', 1000000),
               (gen_random_uuid(), '${NOTA}', '${PB}', 'Gear B ${TAG}', 'B-${TAG}', 5, 0, 200000, 200000, 'IDR', 1000000);`);
  // Baris otomatis dari form nota, sama seperti yang ditulis syncPurchaseCostExpenses.
  psql(`insert into public.expenses (id, store_id, category, description, amount, expense_date, payment_method, purchase_id, purchase_cost_slot, created_at)
        values (gen_random_uuid(), '${STORE}', 'transport', 'Ongkir supplier - nota ${INV}', 50000, current_date, 'other', '${NOTA}', 'other', now()),
               (gen_random_uuid(), '${STORE}', 'perlengkapan', 'Kardus - nota ${INV}', 30000, current_date, 'other', '${NOTA}', 'extra', now());`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  trackApi(page);
  let dialogTerakhir = '';
  page.on('dialog', (d) => {
    dialogTerakhir = d.message();
    d.accept().catch(() => {});
  });
  const modal = () => page.locator('div.fixed.inset-0').last();

  async function catatBiaya(keterangan, nominal) {
    await page.goto(BASE_URL + '/expenses', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByRole('button', { name: /Catat Pengeluaran/i }).first().click();
    await page.waitForTimeout(800);
    const m = modal();
    await m.locator('select').first().selectOption('transport');
    await m.locator('label:has-text("Nominal") + input, label:has-text("Nominal") ~ input').first().fill(String(nominal));
    await m.locator('label:has-text("Metode Bayar") + select').selectOption('transfer');
    await m.getByPlaceholder(/Sewa ruko/i).fill(keterangan);
    const pilihNota = m.locator('label:has-text("Untuk nota PO") + select');
    const ada = (await pilihNota.count()) === 1;
    if (ada) await pilihNota.selectOption(NOTA);
    await page.waitForTimeout(300);
    const info = ada ? await m.textContent() : '';
    await m.getByRole('button', { name: /^Simpan$/ }).click();
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    return { ada, info: info || '' };
  }

  try {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
    await waitForApiIdle(page, { idleMs: 3500, minWaitMs: 3000 });
    // Layar Pengeluaran butuh daftar nota di perangkat untuk pilihan PO.
    await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });

    // ---------- 1. Biaya pertama, sebelum barang diterima ----------
    const k1 = 'Kirim kontainer China-Jakarta ' + TAG;
    const r1 = await catatBiaya(k1, 220000);
    record('Form Catat Pengeluaran punya pilihan "Untuk nota PO"', r1.ada);
    record('Memilih nota menampilkan keterangan bahwa biaya masuk HPP dan sisa pelunasan tidak berubah',
      /masuk HPP/i.test(r1.info) && /sisa pelunasan/i.test(r1.info));
    const b1 = psql(`select coalesce(purchase_id::text,'-') || '|' || coalesce(purchase_cost_slot,'null') from public.expenses where description = '${k1}';`);
    record('Biaya tersimpan menempel ke nota, tanpa slot otomatis', b1 === `${NOTA}|null`, b1 || '(tidak tersimpan)');

    // ---------- 2. Simpan ulang nota tidak menghapus biaya susulan ----------
    await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1500);
    await modal().getByRole('button', { name: /Edit nota/i }).click();
    await page.waitForTimeout(2000);
    await modal().getByRole('button', { name: /Simpan nota/i }).click();
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500, timeoutMs: 120000 });
    const setelahSimpan = psql(`select count(*) filter (where purchase_cost_slot is null) || '|' || count(*) filter (where purchase_cost_slot is not null)
                                from public.expenses where purchase_id = '${NOTA}';`);
    record('Simpan ulang nota: biaya susulan tetap 1, baris otomatis tetap 2', setelahSimpan === '1|2', setelahSimpan);

    // ---------- 3. Cacat C1: terima barang tidak boleh membuang Biaya tambahan ----------
    psql(`select public.receive_purchase_actual('${NOTA}'::uuid, '[]'::jsonb);`);
    const totalTerima = psql(`select total::int from public.purchases where id = '${NOTA}';`);
    record('Terima barang: total nota tetap memuat Biaya tambahan (1.980.000)', totalTerima === '1980000', totalTerima);

    // ---------- 4. Biaya kedua, sesudah barang diterima ----------
    const k2 = 'Gudang Jakarta-Sidoarjo ' + TAG;
    await catatBiaya(k2, 100000);
    const jumlahSusulan = psql(`select count(*) from public.expenses where purchase_id = '${NOTA}' and purchase_cost_slot is null;`);
    record('Dua biaya bertahap menempel ke nota yang sama', jumlahSusulan === '2', jumlahSusulan);
    const nota = psql(`select total::int || '|' || paid_amount::int from public.purchases where id = '${NOTA}';`);
    record('Total dan pembayaran nota tidak berubah oleh biaya susulan', nota === '1980000|0', nota);

    // ---------- 5. Lencana di daftar Pengeluaran ----------
    await page.goto(BASE_URL + '/expenses', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    const barisBiaya = page.locator('tbody tr').filter({ hasText: k1 }).first();
    record('Daftar Pengeluaran: biaya susulan diberi lencana nomor nota',
      (await barisBiaya.getByText('nota ' + INV, { exact: false }).count()) >= 1);

    // ---------- 6. Detail nota: HPP per barang ----------
    // Biaya 50.000 + 30.000 + 220.000 + 100.000 = 400.000, diskon 100.000,
    // nilai barang 2.000.000 -> tambahan 15% dari harga beli.
    const hppA = 100000 * 1.15;
    const hppB = 200000 * 1.15;
    await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1500);
    const seksi = modal().locator('section').filter({ hasText: 'HPP per barang' }).first();
    record('Detail nota punya bagian "HPP per barang"', (await seksi.count()) === 1);
    const teksSeksi = await teks(seksi);
    record('Bagian HPP mendaftar keempat biaya nota',
      [k1, k2, 'Ongkir supplier', 'Kardus'].every((t) => teksSeksi.includes(t)), teksSeksi.slice(0, 160).replace(/\s+/g, ' '));
    const barisA = seksi.locator('tr, li').filter({ hasText: 'Gear A ' + TAG }).first();
    const barisB = seksi.locator('tr, li').filter({ hasText: 'Gear B ' + TAG }).first();
    // Baris barang menyusul setelah nota ditarik ulang dari server.
    await barisA.waitFor({ timeout: 20000 }).catch(() => {});
    const tA = await teks(barisA);
    const tB = await teks(barisB);
    if (!tA) console.log('      isi bagian HPP: ' + (await teks(seksi)).replace(/\s+/g, ' ').slice(0, 700));
    record(`HPP penuh Gear A = ${rupiah(hppA)} (harga beli 100.000 + 15%)`, tA.includes(rupiah(hppA)), tA.replace(/\s+/g, ' ').slice(0, 140));
    record(`HPP penuh Gear B = ${rupiah(hppB)} (harga beli 200.000 + 15%)`, tB.includes(rupiah(hppB)), tB.replace(/\s+/g, ' ').slice(0, 140));
    record('Rincian Gear A menyebut bagian kirim kontainer +11.000 dan diskon −5.000',
      /\+11\.000/.test(tA) && /[−-]5\.000/.test(tA), tA.replace(/\s+/g, ' ').slice(0, 200));

    // ---------- 7. Daftar Produk: HPP penuh ----------
    await page.goto(BASE_URL + '/products', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByPlaceholder(/Cari nama/i).first().fill(TAG);
    await page.waitForTimeout(1500);
    const produkA = page.locator('tbody tr').filter({ hasText: 'Gear A ' + TAG }).first();
    // Halaman menampilkan salinan lokal dulu, lalu memperbarui setelah nota
    // dan pengeluaran tertarik dari server. Tunggu barisnya, bukan jeda tetap.
    await produkA.getByText(/HPP penuh/).waitFor({ timeout: 20000 }).catch(() => {});
    const teksProdukA = await teks(produkA);
    const okProduk = /HPP penuh/i.test(teksProdukA) && teksProdukA.includes(rupiah(hppA));
    record(`Daftar Produk: Gear A menampilkan "HPP penuh ${rupiah(hppA)}"`, okProduk, teksProdukA.replace(/\s+/g, ' ').slice(0, 160));
    if (!okProduk) {
      // Salinan lokal nota di browser: menjelaskan kenapa barisnya tidak muncul.
      const lokal = await page.evaluate(async (nota) => {
        const dbx = await new Promise((res, rej) => { const r = indexedDB.open('kasir'); r.onsuccess = () => res(r.result); r.onerror = rej; });
        const ambil = (s) => new Promise((res) => { const t = dbx.transaction(s).objectStore(s).getAll(); t.onsuccess = () => res(t.result); });
        const p = (await ambil('purchases')).find((x) => x.id === nota);
        const it = (await ambil('purchase_items')).filter((x) => x.purchase_id === nota);
        return { received_at: p && p.received_at, items: it.map((x) => x.product_id + ':' + x.received_qty) };
      }, NOTA);
      console.log('      lokal: ' + JSON.stringify(lokal));
    }
    // Baris "HPP penuh" tidak boleh melebarkan kolom Modal: lebar yang diambilnya
    // dipotong dari kolom nama produk, dan di laptop 1280-1366 nama jadi terpotong.
    // Diukur dengan menyembunyikan baris itu lalu membandingkan lebar kolomnya.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);
    const lebarModal = () => page.evaluate(() => {
      const th = Array.from(document.querySelectorAll('thead th')).find((el) => el.textContent.trim() === 'Modal');
      return th ? Math.round(th.getBoundingClientRect().width * 10) / 10 : -1;
    });
    const jumlahHpp = await page.locator('tbody td [data-hpp-penuh]').count();
    const modalDenganHpp = await lebarModal();
    const gaya = await page.addStyleTag({ content: 'tbody td [data-hpp-penuh]{display:none!important}' });
    await page.waitForTimeout(300);
    const modalTanpaHpp = await lebarModal();
    await gaya.evaluate((el) => el.remove());
    await page.setViewportSize({ width: 1440, height: 900 });
    record('1280px: baris "HPP penuh" tidak melebarkan kolom Modal (nama produk tidak ikut menyempit)',
      jumlahHpp >= 1 && modalDenganHpp > 0 && modalDenganHpp - modalTanpaHpp <= 1,
      `baris HPP=${jumlahHpp}, kolom Modal ${modalDenganHpp}px dengan HPP, ${modalTanpaHpp}px tanpa`);

    // ---------- 8. Edit biaya susulan tidak melepasnya dari nota ----------
    await page.goto(BASE_URL + '/expenses', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.locator('tbody tr').filter({ hasText: k1 }).first().getByTitle('Edit').click();
    await page.waitForTimeout(800);
    await modal().getByRole('button', { name: /^Simpan$/ }).click();
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    const setelahEdit = psql(`select coalesce(purchase_id::text,'-') from public.expenses where description = '${k1}';`);
    record('Mengedit biaya susulan tidak melepasnya dari nota', setelahEdit === NOTA, setelahEdit);
    const lencanaSetelahEdit = await page.locator('tbody tr').filter({ hasText: k1 }).first()
      .getByText('nota ' + INV, { exact: false }).count();
    record('Lencana nota tetap tampil sesudah edit (salinan lokal ikut benar)', lencanaSetelahEdit >= 1);

    // ---------- 8b. Layar HP: keterangan panjang tanpa spasi tidak boleh melebarkan apa pun ----------
    // Temuan QC: keterangan 80 karakter tanpa spasi membuat tabel Pengeluaran
    // 777px di wadah 335px, sehingga nominal dan tombol SEMUA baris keluar layar.
    const PANJANG = 'KirimKontainerChinaKeTanjungPriokLaluTrukKeGudangSidoarjoTanpaSpasi' + TAG;
    psql(`insert into public.expenses (id, store_id, category, description, amount, expense_date, payment_method, purchase_id, purchase_cost_slot, created_at)
          values (gen_random_uuid(), '${STORE}', 'transport', '${PANJANG}', 1000, current_date, 'transfer', '${NOTA}', null, now());`);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(BASE_URL + '/expenses', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.locator('tbody tr').filter({ hasText: PANJANG.slice(0, 20) }).first().waitFor({ timeout: 20000 }).catch(() => {});
    const lebarDaftar = await page.evaluate(() => {
      const t = document.querySelector('[class*="max-w-[1400px]"] table');
      return t ? { gulir: t.parentElement.scrollWidth, tampak: t.parentElement.clientWidth } : null;
    });
    record('HP 393px: daftar Pengeluaran tidak melebar karena keterangan panjang',
      !!lebarDaftar && lebarDaftar.gulir <= lebarDaftar.tampak + 1, JSON.stringify(lebarDaftar));
    await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    const seksiHp = modal().locator('section').filter({ hasText: 'HPP per barang' }).first();
    await seksiHp.locator('tr').filter({ hasText: 'Gear A ' + TAG }).first().waitFor({ timeout: 20000 }).catch(() => {});
    const lebarHpp = (await seksiHp.count())
      ? await seksiHp.evaluate((el) => ({ gulir: el.scrollWidth, tampak: el.clientWidth }))
      : null;
    record('HP 393px: bagian HPP per barang tidak melebar karena keterangan panjang',
      !!lebarHpp && lebarHpp.gulir <= lebarHpp.tampak + 1, JSON.stringify(lebarHpp));
    await page.keyboard.press('Escape').catch(() => {});
    await page.setViewportSize({ width: 1440, height: 900 });
    psql(`delete from public.expenses where description = '${PANJANG}';`);

    // ---------- 9. Hapus nota: biaya susulan tetap, baris otomatis ikut terhapus ----------
    await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 1500 });
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    await page.waitForTimeout(1500);
    dialogTerakhir = '';
    // Layar membaca salinan lokal, dan salinan itu baru menyusul server beberapa
    // detik setelah halaman dibuka (terukur 4 detik saat beberapa tarikan data
    // berjalan bersamaan). Baris uji 8b sudah dihapus dari server; tunggu sampai
    // bagian HPP menampilkan 4 biaya (2 dari form nota, 2 susulan) sebelum menekan Hapus.
    const judulHpp = async () => ((await modal().locator('section').filter({ hasText: 'HPP per barang' }).first().innerText().catch(() => '')).split(/\r?\n/)[1] || '');
    const mulaiTunggu = Date.now();
    while (Date.now() - mulaiTunggu < 20000 && !/^4 biaya/.test(await judulHpp())) await page.waitForTimeout(500);
    await modal().getByRole('button', { name: /^Hapus$/ }).click();
    await waitForApiIdle(page, { idleMs: 2500, minWaitMs: 2000 });
    record('Konfirmasi hapus nota menyebut 2 biaya susulan tetap tersimpan',
      /2 biaya susulan/i.test(dialogTerakhir) && /tetap tersimpan/i.test(dialogTerakhir), dialogTerakhir.slice(0, 160));
    const notaHilang = psql(`select count(*) from public.purchases where id = '${NOTA}';`);
    record('Nota terhapus lewat tombol Hapus', notaHilang === '0', notaHilang);
    const sisa = psql(`select count(*) filter (where description in ('${k1}','${k2}') and purchase_id is null) || '|' ||
                              count(*) filter (where description like '%- nota ${INV}')
                       from public.expenses where store_id = '${STORE}';`);
    record('Hapus nota: 2 biaya susulan tetap ada (lepas dari nota), 0 baris otomatis tersisa', sisa === '2|0', sisa);

    // ---------- 10. Lebih dari 1000 pengeluaran: biaya nota lama tetap terbaca ----------
    // Salinan lokal hanya menarik 1000 pengeluaran terbaru. Biaya nota yang
    // tanggalnya lebih lama dari jendela itu dulu hilang dari HPP tanpa pesan.
    const NOTA_LAMA = psql('select gen_random_uuid();');
    const INV_LAMA = 'PO-LAMA-' + TAG;
    psql(`insert into public.purchases (id, store_id, invoice_number, status, order_date, subtotal, discount, tax, other_cost, extra_cost, total, currency, exchange_rate, paid_amount, dp_percent)
      values ('${NOTA_LAMA}', '${STORE}', '${INV_LAMA}', 'ordered', current_date - 400, 1000000, 0, 0, 0, 0, 1000000, 'IDR', 1, 0, 0);`);
    psql(`insert into public.purchase_items (id, purchase_id, product_id, name, sku, qty, received_qty, cost_price, original_cost_price, currency, subtotal)
      values (gen_random_uuid(), '${NOTA_LAMA}', null, 'Barang lama ${TAG}', null, 10, 0, 100000, 100000, 'IDR', 1000000);`);
    psql(`insert into public.expenses (id, store_id, category, description, amount, expense_date, payment_method, purchase_id, purchase_cost_slot, created_at)
      values (gen_random_uuid(), '${STORE}', 'transport', 'Kirim lama ${TAG}', 50000, current_date - 395, 'transfer', '${NOTA_LAMA}', null, now());`);
    // 1000 pengeluaran lebih baru mendorong biaya nota itu keluar dari jendela tarik.
    psql(`insert into public.expenses (id, store_id, category, description, amount, expense_date, payment_method, created_at)
      select gen_random_uuid(), '${STORE}', 'lainnya', 'pengisi ${TAG} ' || n, 1, current_date - 1, 'cash', now() from generate_series(1, 1000) n;`);
    await page.goto(BASE_URL + '/purchases', { waitUntil: 'domcontentloaded' });
    await waitForApiIdle(page, { idleMs: 3000, minWaitMs: 2500 });
    await page.getByPlaceholder(/Cari nomor nota/i).first().fill(INV_LAMA);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Detail/i }).first().click();
    const mulaiLama = Date.now();
    while (Date.now() - mulaiLama < 20000 && !/^1 biaya/.test(await judulHpp())) await page.waitForTimeout(500);
    const judulLama = await judulHpp();
    record('Toko dengan lebih dari 1000 pengeluaran: biaya nota lama tetap masuk HPP',
      /^1 biaya · Rp 50\.000/.test(judulLama.split(String.fromCharCode(160)).join(' ')), judulLama || '(tanpa biaya)');
    await page.keyboard.press('Escape').catch(() => {});

    console.log('');
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + hasil.length + ' lolos');
    process.exitCode = lulus === hasil.length ? 0 : 1;
  } catch (e) {
    console.log('ERROR: ' + String(e.message || e).slice(0, 300));
    const lulus = hasil.filter((h) => h.ok).length;
    console.log(lulus + '/' + Math.max(hasil.length, 17) + ' lolos');
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      psql(`delete from public.expenses where description like '%${TAG}%';`);
      psql(`delete from public.purchases where invoice_number in ('${INV}', 'PO-LAMA-${TAG}');`);
      psql(`delete from public.stock_movements where product_id in ('${PA}','${PB}');`);
      psql(`delete from public.products where id in ('${PA}','${PB}');`);
    } catch (e) {
      console.log('Pembersihan gagal: ' + String(e.message || e).slice(0, 200));
    }
  }
})();
