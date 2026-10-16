// Gelombang 12 permintaan client (16 Okt 2026), dijalankan di browser seperti pengguna:
//
// 25  footer tidak tampil di halaman checkout, baris terakhir checkout tetap
//     tidak tertimbun bilah bayar HP.
// 26  kategori pengeluaran bisa ditambah di Pengaturan Toko dan dipakai di
//     Pengeluaran serta biaya nota pembelian.
// 29  pencarian di tab Link affiliate per produk, bukan per SKU, dan link-nya
//     memakai nama produk (slug). Komisi tetap tercatat untuk varian lain.
// 30  kartu toko di halaman produk tanpa "Toko Baru" dan "Pelanggan Tetap".
// 31  ganti varian tidak membuat gambar berkedip (tanpa kerangka, tanpa
//     menggambar ulang gambar, tanpa lompat gulir).
// 32  klik kategori dari beranda mendarat di deretan produk, bukan di footer.
//
// Produk UJIG12-*, akun aff.*.{CAP}@contoh.id, dan pengeluaran uji dibuat dan
// dihapus di suite ini. Pengaturan affiliate dan kategori pengeluaran toko
// dikembalikan ke nilai aslinya di `finally`.

const { chromium } = require('playwright');
const { trackApi, waitForApiIdle, loginAdmin, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const KUNCI_TOKEN = 'tokoku.customer.token.v1';
const INDUK = `UJIG12-${CAP}`;
const NAMA = `Uji Gelombang ${CAP} Gear Satria`;
const KATEGORI = `Ongkir Uji ${CAP}`;
const KET_PENGELUARAN = `Uji kategori ${CAP}`;
const GAMBAR = '/apple-touch-icon.png';
const DESK = { viewport: { width: 1440, height: 900 } };
const HP = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** Pasang pengamat kerangka dan tandai simpul gambar utama sebelum varian diganti. */
const PASANG_PENGAMAT = (nama) => {
  window.__kerangka = 0;
  new MutationObserver(() => {
    if (document.querySelector('.aspect-square.animate-pulse')) window.__kerangka += 1;
  }).observe(document.body, { childList: true, subtree: true });
  const img = document.querySelector(`img[alt="${nama}"]`);
  if (img) img.__penanda = 'lama';
  return !!img;
};
const BACA_PENGAMAT = (nama) => {
  const img = document.querySelector(`img[alt="${nama}"]`);
  return { kerangka: window.__kerangka, simpulSama: img?.__penanda === 'lama', y: Math.round(window.scrollY) };
};

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asliAff = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const asliKat = psql(`select expense_categories::text from public.stores where id = '${toko}'`);
  const browser = await chromium.launch();

  try {
    psql(`insert into public.products (store_id, name, base_price, parent_sku, sku, variant_name, variant_label, is_active, track_stock, stock_qty, image_url, affiliate_enabled)
          values ('${toko}', '${NAMA}', 30000, '${INDUK}', '${INDUK}-A', '13T', 'Ukuran', true, true, 50, '${GAMBAR}', true),
                 ('${toko}', '${NAMA}', 20000, '${INDUK}', '${INDUK}-B', '14T', 'Ukuran', true, true, 50, '${GAMBAR}', true),
                 ('${toko}', '${NAMA}', 25000, '${INDUK}', '${INDUK}-C', '15T', 'Ukuran', true, true, 50, '${GAMBAR}', true)`);
    const SLUG = psql(`select string_agg(distinct slug, ',') from public.products where parent_sku = '${INDUK}'`);
    const idVarian = (h) => psql(`select id from public.products where sku = '${INDUK}-${h}'`);
    const [idA, idB, idC] = ['A', 'B', 'C'].map(idVarian);
    record('Produk uji tiga varian berbagi satu alamat', /^uji-gelombang-\d+-gear-satria$/.test(SLUG), SLUG);

    // ================= 30 + 31: halaman produk =================
    for (const [nama, opsi] of [['desktop 1440', DESK], ['HP 393', HP]]) {
      const ctx = await browser.newContext(opsi);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/produk/${SLUG}?varian=${INDUK}-B`, { waitUntil: 'networkidle' });
      await p.locator(`img[alt="${NAMA}"]`).first().waitFor({ timeout: 20000 });
      const teks = await p.locator('body').innerText();
      record(`30 · ${nama}: kartu toko tanpa "Toko Baru" dan "Pelanggan Tetap"`,
        teks.includes('Nilai Toko') && !/Toko Baru/i.test(teks) && !/Pelanggan Tetap/i.test(teks),
        `Nilai Toko=${teks.includes('Nilai Toko')} TokoBaru=${/Toko Baru/i.test(teks)} PelangganTetap=${/Pelanggan Tetap/i.test(teks)}`);

      if (opsi === HP) {
        // Di HP varian dipilih dari lembar "Pilihan Produk".
        await p.getByText('Pilihan Produk').first().click();
        const lembar = p.locator('div.fixed.inset-0.z-40');
        await lembar.waitFor({ timeout: 5000 });
        const adaGambar = await p.evaluate(PASANG_PENGAMAT, NAMA);
        const yAwal = await p.evaluate(() => Math.round(window.scrollY));
        await lembar.getByRole('button', { name: '15T', exact: true }).click();
        await p.waitForURL((u) => u.searchParams.get('varian') === `${INDUK}-C`, { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(1200);
        const h = await p.evaluate(BACA_PENGAMAT, NAMA);
        record('31 · HP: ganti varian tanpa kerangka dan tanpa menggambar ulang gambar',
          adaGambar && h.kerangka === 0 && h.simpulSama, `gambar=${adaGambar} kerangka=${h.kerangka} simpulSama=${h.simpulSama}`);
        record('31 · HP: alamat berganti ke varian baru, gulir tidak melompat',
          new URL(p.url()).searchParams.get('varian') === `${INDUK}-C` && h.y === yAwal, `${p.url()} y ${yAwal}->${h.y}`);
        const teksLembar = (await lembar.isVisible()) ? await lembar.innerText() : '';
        record('31 · HP: lembar Pilihan Produk tetap terbuka dengan harga varian baru',
          /Rp\s*25\.000/.test(teksLembar), teksLembar.replace(/\n/g, ' / ').slice(0, 120));

        // Sambungan: rincian varian baru belum tiba, pembeli langsung mengetuk "+ Keranjang".
        // Tanpa kerangka penutup, yang masuk harus tetap varian yang baru diketuk.
        const tahanProduk = (u) => u.pathname === '/api/public/product';
        await p.route(tahanProduk, async (r) => {
          await new Promise((selesai) => setTimeout(selesai, 1500));
          await r.continue().catch(() => {});
        });
        await lembar.getByRole('button', { name: '13T', exact: true }).click();
        await lembar.getByRole('button', { name: '+ Keranjang' }).click();
        const isiKeranjang = await p.evaluate(() => JSON.parse(localStorage.getItem('tokoku.public_cart.v1') || '{}')?.state?.lines ?? []);
        const huruf = (id) => (id === idA ? 'A' : id === idB ? 'B' : id === idC ? 'C' : '?');
        record('31 · HP: "+ Keranjang" sesaat setelah ganti varian memasukkan varian yang baru dipilih',
          isiKeranjang.length === 1 && isiKeranjang[0].product_id === idA && isiKeranjang[0].price === 30000,
          isiKeranjang.map((l) => `${huruf(l.product_id)} ${l.price}`).join(', ') || 'keranjang kosong');
        await p.unroute(tahanProduk);
      } else {
        await p.evaluate(() => window.scrollTo({ top: 220 }));
        await p.waitForTimeout(300);
        const adaGambar = await p.evaluate(PASANG_PENGAMAT, NAMA);
        const yAwal = await p.evaluate(() => Math.round(window.scrollY));
        await p.getByRole('button', { name: '13T', exact: true }).first().click();
        await p.waitForURL((u) => u.searchParams.get('varian') === `${INDUK}-A`, { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(1200);
        const h = await p.evaluate(BACA_PENGAMAT, NAMA);
        record('31 · desktop: ganti varian tanpa kerangka dan tanpa menggambar ulang gambar',
          adaGambar && h.kerangka === 0 && h.simpulSama, `gambar=${adaGambar} kerangka=${h.kerangka} simpulSama=${h.simpulSama}`);
        record('31 · desktop: alamat berganti, gulir tetap di tempat',
          new URL(p.url()).searchParams.get('varian') === `${INDUK}-A` && yAwal > 100 && h.y === yAwal, `y ${yAwal}->${h.y}`);
        record('31 · desktop: harga mengikuti varian baru', /Rp\s*30\.000/.test(await p.locator('body').innerText()));
      }
      await ctx.close();
    }

    // ================= 32: kategori dari beranda =================
    for (const [nama, opsi] of [['desktop 1440', DESK], ['HP 393', HP]]) {
      const ctx = await browser.newContext(opsi);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko`, { waitUntil: 'networkidle' });
      // Ubin kategori dengan produk paling sedikit: halaman hasilnya paling pendek, jadi
      // pemulihan bawaan browser saat Back paling mungkin terpotong.
      await p.locator('#kategori a').first().waitFor({ timeout: 20000 });
      const hrefUbin = await p.locator('#kategori a').evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
      const jumlahPerUbin = hrefUbin.map((h) => {
        const id = new URL(h, 'http://x').searchParams.get('kategori') || '';
        return /^[0-9a-f-]{36}$/.test(id) ? Number(psql(`select count(*) from public.products where category_id = '${id}' and is_active`)) : 0;
      });
      const terpendek = jumlahPerUbin.reduce((iMin, n, i) => (n > 0 && (jumlahPerUbin[iMin] <= 0 || n < jumlahPerUbin[iMin]) ? i : iMin), 0);
      const ubin = p.locator('#kategori a').nth(terpendek);
      // Ubin digulir ke dekat atas layar (posisi gulir sekitar 1500 di desktop): dari sini
      // pemulihan bawaan browser saat Back terpotong karena halaman kategori lebih pendek.
      await ubin.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120 }));
      await p.waitForTimeout(400);
      const yKategori = await p.evaluate(() => Math.round(window.scrollY));
      await ubin.click();
      await p.waitForURL((u) => u.searchParams.has('kategori'), { timeout: 10000 }).catch(() => {});
      await p.locator('[data-kartu-produk]').first().waitFor({ timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(600);
      const sesudah = await p.evaluate(() => {
        const kartu = document.querySelector('[data-kartu-produk]');
        return { y: Math.round(window.scrollY), kartuAtas: kartu ? Math.round(kartu.getBoundingClientRect().top) : null, tinggi: window.innerHeight };
      });
      record(`32 · ${nama}: klik kategori mendarat di atas, kartu produk pertama terlihat`,
        yKategori > 300 && sesudah.y === 0 && sesudah.kartuAtas !== null && sesudah.kartuAtas < sesudah.tinggi,
        `y kategori ${yKategori} -> ${sesudah.y}, kartu pertama di ${sesudah.kartuAtas}px dari ${sesudah.tinggi}px`);
      await p.goBack();
      await p.waitForURL((u) => !u.searchParams.has('kategori'), { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(800);
      const yBalik = await p.evaluate(() => Math.round(window.scrollY));
      record(`32 · ${nama}: Back kembali ke posisi bagian Kategori semula`, Math.abs(yBalik - yKategori) <= 30, `${yKategori} -> ${yBalik} (kategori ${jumlahPerUbin[terpendek]} produk)`);
      await ctx.close();
    }

    // ================= 25: checkout tanpa footer =================
    // Checkout meminta akun pembeli; tanpa akun yang tampil hanya kartu "Masuk untuk checkout".
    const keranjang = JSON.stringify({ state: { lines: [{ product_id: idB, name: NAMA, price: 20000, qty: 1, image_url: GAMBAR }], buyNow: null }, version: 0 });
    const pembeliCheckout = await A.daftarPembeli(toko, CAP, 'g12c');
    for (const [nama, opsi] of [['desktop 1440', DESK], ['HP 393', HP]]) {
      const ctx = await browser.newContext(opsi);
      await ctx.addInitScript(([isi, k, t]) => {
        localStorage.setItem('tokoku.public_cart.v1', isi);
        localStorage.setItem(k, t);
      }, [keranjang, KUNCI_TOKEN, pembeliCheckout.token]);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/keranjang`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(500);
      const footerKeranjang = await p.locator('footer.kaki-toko').isVisible();
      await p.goto(`${BASE_URL}/toko/checkout`, { waitUntil: 'networkidle' });
      await p.getByText(NAMA).first().waitFor({ timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(800);
      record(`25 · ${nama}: checkout terbuka dengan isi keranjang (bukan kartu masuk)`, (await p.getByText('Masuk untuk checkout').count()) === 0 && (await p.getByText(NAMA).count()) > 0);
      const footerCheckout = await p.locator('footer.kaki-toko').isVisible();
      record(`25 · ${nama}: footer tampil di keranjang, hilang di checkout`, footerKeranjang && !footerCheckout,
        `keranjang=${footerKeranjang} checkout=${footerCheckout}`);
      await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
      await p.waitForTimeout(400);
      const ukur = await p.evaluate(() => {
        const ruang = document.querySelector('[data-kaki-disembunyikan]');
        const bilah = [...document.querySelectorAll('div.fixed.inset-x-0.bottom-0')].find((el) => el.getBoundingClientRect().height > 0);
        const isi = document.querySelector('main > div');
        // Bilah bayar sendiri (position: fixed) ada di dalam isi halaman; yang diukur isi yang menggulir.
        const anak = isi ? [...isi.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().height > 0 && !el.closest('.fixed')) : [];
        const bawahIsi = anak.length ? Math.max(...anak.map((el) => el.getBoundingClientRect().bottom)) : null;
        return {
          ruang: ruang ? Math.round(ruang.getBoundingClientRect().height) : null,
          atasBilah: bilah ? Math.round(bilah.getBoundingClientRect().top) : null,
          bawahIsi: bawahIsi === null ? null : Math.round(bawahIsi),
          geser: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      if (opsi === HP) {
        record('25 · HP: baris terakhir checkout tidak tertimbun bilah bayar',
          ukur.atasBilah !== null && ukur.bawahIsi !== null && ukur.bawahIsi <= ukur.atasBilah && !ukur.geser,
          `bawah isi ${ukur.bawahIsi}px, atas bilah ${ukur.atasBilah}px, ruang ${ukur.ruang}px`);
      } else {
        record('25 · desktop: tanpa ruang kosong sisa footer', ukur.ruang === 0 && !ukur.geser, `ruang ${ukur.ruang}px`);
      }
      await ctx.close();
    }

    // ================= 26: kategori pengeluaran =================
    {
      const ctx = await browser.newContext(DESK);
      const p = await ctx.newPage();
      trackApi(p);
      await loginAdmin(p);
      await p.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
      const bagian = p.locator('#section-expense-categories');
      await bagian.waitFor({ timeout: 15000 });
      record('26 · Pengaturan Toko punya bagian Kategori Pengeluaran', (await bagian.getByText('Kategori Pengeluaran').count()) > 0);

      await bagian.locator('#kategori-pengeluaran-baru').fill('sewa tempat');
      await bagian.getByRole('button', { name: 'Tambah' }).click();
      const galat = await bagian.locator('[role="alert"]').textContent({ timeout: 5000 }).catch(() => '');
      record('26 · Nama kembar kategori bawaan ditolak dengan pesan', galat === 'Kategori "sewa tempat" sudah ada.' &&
        psql(`select expense_categories::text from public.stores where id = '${toko}'`) === asliKat, galat);

      await bagian.locator('#kategori-pengeluaran-baru').fill('gaji');
      await bagian.getByRole('button', { name: 'Tambah' }).click();
      const galatGaji = await bagian.locator('[role="alert"]').textContent({ timeout: 5000 }).catch(() => '');
      record('26 · Pesan tolak menyebut nama kategori bawaan yang terlihat', galatGaji === 'Kategori "gaji" sudah ada sebagai "Gaji & Upah".', galatGaji);

      // Sambungan: perangkat lain menambah kategori saat halaman ini sudah terbuka.
      const LAIN = `Perangkat Lain ${CAP}`;
      psql(`update public.stores set expense_categories = '["${LAIN}"]'::jsonb where id = '${toko}'`);
      await bagian.locator('#kategori-pengeluaran-baru').fill(KATEGORI);
      await bagian.getByRole('button', { name: 'Tambah' }).click();
      await bagian.locator('[data-kategori-tambahan]').getByText(KATEGORI).waitFor({ timeout: 10000 }).catch(() => {});
      const tersimpan = psql(`select coalesce(expense_categories ? '${KATEGORI}', false) from public.stores where id = '${toko}'`);
      record('26 · Kategori baru tersimpan di toko dan tampil sebagai chip', tersimpan === 't' &&
        (await bagian.locator('[data-kategori-tambahan]').getByText(KATEGORI).count()) === 1, `db=${tersimpan}`);
      const isiDb = psql(`select expense_categories::text from public.stores where id = '${toko}'`);
      record('26 · Halaman yang terbuka lama tidak menimpa kategori dari perangkat lain', isiDb === `["${LAIN}", "${KATEGORI}"]`, isiDb);

      // Sebelum tiap p.goto, API ditunggu sepi. Permintaan POST yang diputus navigasi
      // membuat soket proxy Vite (dev) macet, dan permintaan berikutnya tidak pernah selesai.
      // Pengeluaran: kategori baru bisa dipilih dan tersimpan apa adanya.
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/expenses`, { waitUntil: 'networkidle' });
      await waitForApiIdle(p, { idleMs: 1500, minWaitMs: 800 });
      await p.getByRole('button', { name: /Catat Pengeluaran/ }).first().click();
      const modal = p.locator('[role="dialog"]').filter({ hasText: 'Catat Pengeluaran' });
      await modal.waitFor({ timeout: 5000 });
      const pilihKategori = modal.locator('select').first();
      const opsiModal = await pilihKategori.locator('option').allTextContents();
      record('26 · Formulir pengeluaran menawarkan kategori baru sebelum "Lainnya"',
        opsiModal.includes(KATEGORI) && opsiModal.indexOf(KATEGORI) < opsiModal.indexOf('Lainnya'), opsiModal.slice(-3).join(' | '));
      await pilihKategori.selectOption(KATEGORI);
      await modal.locator('select:has(option[value="transfer"])').selectOption('transfer');
      // Label Nominal dan Keterangan tidak terhubung ke kolomnya (Input tanpa id), jadi dicari lewat jenis dan contoh isi.
      await modal.locator('input[type="number"]').first().fill('12345');
      await modal.getByPlaceholder('cth. Sewa ruko bulan Agustus').fill(KET_PENGELUARAN);
      await modal.getByRole('button', { name: 'Simpan' }).click();
      await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await waitForApiIdle(p, { idleMs: 1500, minWaitMs: 800 });
      const kategoriDb = psql(`select category from public.expenses where description = '${KET_PENGELUARAN}'`);
      record('26 · Pengeluaran tersimpan dengan kategori baru', kategoriDb === KATEGORI, kategoriDb);
      const baris = p.locator('tbody tr', { hasText: KET_PENGELUARAN });
      record('26 · Daftar pengeluaran menampilkan nama kategori baru', (await baris.count()) === 1 && (await baris.innerText()).includes(KATEGORI));
      const opsiSaring = await p.locator('select').filter({ has: p.locator('option[value="all"]') }).first().locator('option').allTextContents();
      record('26 · Saringan kategori ikut menawarkan kategori baru', opsiSaring.includes(KATEGORI));

      // Sambungan ke impor: kategori tambahan dikenali, kategori ngawur tetap dilaporkan.
      await p.getByRole('button', { name: /Impor \/ Ekspor/ }).click();
      const ngawur = `Kategori Ngawur ${CAP}`;
      const csv = `sep=;\r\nTanggal;Kategori;Keterangan;Jumlah;Metode Bayar\r\n2026-10-01;${KATEGORI};uji impor;1000;transfer\r\n2026-10-01;${ngawur};uji impor;2000;transfer\r\n`;
      await p.locator('input[type="file"]').first().setInputFiles({ name: `uji-${CAP}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await p.getByText('Baris terbaca').first().waitFor({ timeout: 10000 }).catch(() => {});
      const teksImpor = await p.locator('[role="dialog"]').last().innerText();
      record('26 · Impor pengeluaran mengenali kategori tambahan, kategori ngawur tetap dicatat sebagai Lainnya',
        teksImpor.includes(`Kategori "${ngawur}" tidak dikenal`) && !teksImpor.includes(`Kategori "${KATEGORI}" tidak dikenal`) && /Akan ditambahkan\s*2/.test(teksImpor),
        teksImpor.split('\n').filter((b) => /tidak dikenal|Akan ditambahkan|^\d+$/.test(b)).join(' / ').slice(0, 200));
      await p.keyboard.press('Escape');
      record('26 · Impor dibatalkan tanpa menulis apa pun', psql(`select count(*) from public.expenses where description = 'uji impor' and amount in (1000, 2000) and created_at > now() - interval '10 minutes'`) === '0');

      // Sambungan ke Laba Rugi: rincian pengeluaran memakai nama kategori tambahan.
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/reports?tab=pnl`, { waitUntil: 'networkidle' });
      await waitForApiIdle(p, { idleMs: 1500, minWaitMs: 800 });
      await p.getByText('Pengeluaran Operasional').first().waitFor({ timeout: 15000 }).catch(() => {});
      const barisLr = await p.evaluate((k) => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent.trim() === k).map((el) => el.parentElement?.innerText ?? '').join(' | '), KATEGORI);
      record('26 · Laba Rugi merinci pengeluaran dengan nama kategori tambahan dan nominalnya', /Rp\s*12\.345/.test(barisLr), barisLr.replace(/\n/g, ' ').slice(0, 120));

      // Nota pembelian: biaya lain dan biaya tambahan.
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/purchases`, { waitUntil: 'networkidle' });
      await waitForApiIdle(p, { idleMs: 1500, minWaitMs: 800 });
      await p.getByRole('button', { name: /Nota Baru/ }).first().click();
      await p.getByText('Kategori pengeluaran').first().waitFor({ timeout: 10000 });
      const pilihNota = p.locator('select').filter({ has: p.locator(`option[value="${KATEGORI}"]`) });
      record('26 · Nota pembelian: dua pilihan kategori biaya menawarkan kategori baru', (await pilihNota.count()) === 2, `${await pilihNota.count()} pilihan`);
      await p.keyboard.press('Escape');

      // Hapus dari pengaturan: catatan lama tetap memakai namanya.
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
      await bagian.waitFor({ timeout: 15000 });
      await bagian.getByRole('button', { name: `Hapus kategori ${KATEGORI}` }).click();
      await bagian.locator('[data-kategori-tambahan]').getByText(KATEGORI).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
      record('26 · Hapus kategori dari pengaturan', psql(`select coalesce(expense_categories ? '${KATEGORI}', false) from public.stores where id = '${toko}'`) === 'f');
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/expenses`, { waitUntil: 'networkidle' });
      await waitForApiIdle(p, { idleMs: 1500, minWaitMs: 800 });
      await p.locator('tbody tr', { hasText: KET_PENGELUARAN }).getByTitle('Edit').click();
      const modalEdit = p.locator('[role="dialog"]').filter({ hasText: 'Edit Pengeluaran' });
      await modalEdit.waitFor({ timeout: 5000 });
      const nilaiEdit = await modalEdit.locator('select').first().inputValue();
      record('26 · Membuka pengeluaran lama tidak mengganti kategorinya diam-diam', nilaiEdit === KATEGORI, nilaiEdit);
      await modalEdit.getByRole('button', { name: 'Batal' }).click();

      // Lebar HP: bagian pengaturan tidak bergeser dan tombol hapus cukup besar untuk jari.
      // Sesi admin yang sama dipakai ulang; login baru di konteks HP memicu sinkron data
      // penuh dari nol (beberapa menit) dan pernah membuat halaman crash.
      psql(`update public.stores set expense_categories = '["${KATEGORI}"]'::jsonb where id = '${toko}'`);
      await p.setViewportSize({ width: 393, height: 852 });
      await waitForApiIdle(p, { idleMs: 1200, minWaitMs: 300, timeoutMs: 30000 });
      await p.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
      const tombol = p.getByRole('button', { name: `Hapus kategori ${KATEGORI}` });
      await tombol.waitFor({ timeout: 15000 });
      const kotak = await tombol.boundingBox();
      const geser = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      record('26 · Lebar 393: tombol hapus kategori minimal 44px dan halaman tidak bergeser',
        kotak && kotak.width >= 44 && kotak.height >= 44 && !geser, `${kotak?.width}x${kotak?.height} geser=${geser}`);
      await ctx.close();
    }

    // ================= 29: affiliate per produk =================
    {
      await A.aturProgram(admin, { enabled: true, access_mode: 'approved' });
      const Af = await A.daftarPembeli(toko, CAP, 'g12');
      await A.izinkan(admin, Af.id);
      const kode = await A.kodeAffiliate(Af.token);
      const daftar = await A.panggil('GET', '/api/customer/affiliate/products', { token: Af.token });
      const milikUji = (daftar.data || []).filter((r) => r.parent_sku === INDUK);
      record('29 · API produk affiliate mengirim slug dan SKU Induk tiap varian',
        milikUji.length === 3 && milikUji.every((r) => r.slug === SLUG), `${milikUji.length} baris`);

      const ctx = await browser.newContext({ ...HP, permissions: ['clipboard-read', 'clipboard-write'] });
      await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [KUNCI_TOKEN, Af.token]);
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/toko/affiliate?tab=link`, { waitUntil: 'networkidle' });
      await p.locator('#cari-produk-affiliate').waitFor({ timeout: 15000 });
      await p.locator('#cari-produk-affiliate').fill(`Uji Gelombang ${CAP}`);
      await p.waitForTimeout(400);
      // Dibatasi ke daftar hasil: dropdown Platform di halaman yang sama juga berisi <option>.
      const hasilCari = p.getByRole('listbox', { name: 'Hasil pencarian produk' });
      const opsiNama = hasilCari.getByRole('option');
      const teksOpsi = (await opsiNama.count()) === 1 ? await opsiNama.first().innerText() : '';
      record('29 · Cari nama produk: satu baris untuk tiga SKU, dengan jumlah varian dan rentang harga',
        (await opsiNama.count()) === 1 && teksOpsi.includes('3 varian') && /Rp\s*20\.000\s*-\s*Rp\s*30\.000/.test(teksOpsi),
        `${await opsiNama.count()} baris: ${teksOpsi.replace(/\n/g, ' / ')}`);
      await p.locator('#cari-produk-affiliate').fill(`${INDUK}-C`);
      await p.waitForTimeout(400);
      record('29 · Cari SKU satu varian tetap menemukan produknya (satu baris)', (await hasilCari.getByRole('option').count()) === 1 &&
        (await hasilCari.getByRole('option').first().innerText()).includes(NAMA));
      await hasilCari.getByRole('option').first().click();
      const link = await p.locator('#link-produk').inputValue();
      record('29 · Link produk memakai nama produk: {toko}/aff/{KODE}/{slug}', link === `${BASE_URL}/aff/${kode}/${SLUG}`, link);
      record('29 · Produk terpilih menyebut link berlaku untuk semua varian', (await p.getByText('Berlaku untuk semua 3 varian').count()) === 1);
      const lebar = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      record('29 · Tab Link di HP 393 tidak bergeser', lebar[0] <= lebar[1], lebar.join(' vs '));

      // Tombol "Bagikan & dapat komisi" di halaman produk memakai link yang sama.
      await p.goto(`${BASE_URL}/toko/produk/${SLUG}?varian=${INDUK}-C`, { waitUntil: 'networkidle' });
      const bagikan = p.locator('[data-bagikan-komisi]:visible').first();
      await bagikan.waitFor({ timeout: 15000 }).catch(() => {});
      await bagikan.click().catch(() => {});
      const papan = await p.evaluate(() => navigator.clipboard.readText()).catch((e) => 'GAGAL: ' + e.message);
      record('29 · Bagikan & dapat komisi di halaman produk menyalin link nama produk', papan === `${BASE_URL}/aff/${kode}/${SLUG}`, papan);
      await ctx.close();

      // Pengunjung membuka link: mendarat di halaman produk, klik dicatat pada varian wakil.
      const tamuCtx = await browser.newContext(DESK);
      const tamu = await tamuCtx.newPage();
      await tamu.goto(link, { waitUntil: 'domcontentloaded' });
      await tamu.waitForURL((u) => u.pathname === `/toko/produk/${SLUG}`, { timeout: 15000 }).catch(() => {});
      await tamu.waitForTimeout(800);
      const klikDb = psql(`select count(*) || '|' || coalesce(min(product_id::text), '-') from public.affiliate_clicks where affiliate_id = '${Af.id}'`);
      record('29 · Link nama produk membawa pengunjung ke halaman produknya', new URL(tamu.url()).pathname === `/toko/produk/${SLUG}`, tamu.url());
      record('29 · Klik tercatat satu kali pada varian termurah yang tersedia', klikDb === `1|${idB}`, klikDb);

      // Server tidak terjangkau: pengunjung tetap diantar ke produk lewat slug.
      const putusCtx = await browser.newContext(DESK);
      const putus = await putusCtx.newPage();
      await putus.route('**/api/public/affiliate/click', (r) => r.abort('failed'));
      await putus.goto(link, { waitUntil: 'domcontentloaded' });
      await putus.waitForURL((u) => u.pathname === `/toko/produk/${SLUG}`, { timeout: 20000 }).catch(() => {});
      record('29 · Jaringan putus: link nama produk tetap mengantar ke produknya', new URL(putus.url()).pathname === `/toko/produk/${SLUG}`, putus.url());
      await putusCtx.close();
      await tamuCtx.close();

      // Komisi: link per produk berlaku untuk varian lain (dibeli varian C).
      const k = await A.klik(toko, kode, { productId: SLUG, ip: A.ipUji() });
      record('29 · API klik menerima slug dan memasang cookie', k.status === 200 && k.cookie.startsWith('gnnk_aff=') && k.data?.redirect === `/toko/produk/${SLUG}`, `${k.status} ${k.data?.redirect}`);
      const pembeli = await A.daftarPembeli(toko, CAP, 'g12b', { cookie: k.cookie });
      const o = await A.pesan(toko, pembeli, [{ product_id: idC, qty: 1 }], { cookie: k.cookie });
      await A.konfirmasi(admin, o.id);
      const komisi = A.komisiPesanan(o.id);
      record('29 · Membeli varian lain lewat link produk tetap memberi komisi ke affiliate',
        komisi.some((b) => b.split(':')[1] === Af.id), komisi.join(' , ') || 'tidak ada komisi');

      const lama = await A.klik(toko, kode, { productId: idA, ip: A.ipUji() });
      record('29 · Link lama berisi id produk tetap jalan ke varian itu',
        lama.status === 200 && lama.data?.redirect === `/toko/produk/${SLUG}?varian=${encodeURIComponent(`${INDUK}-A`)}`, lama.data?.redirect);
      const hilang = await A.klik(toko, kode, { productId: `tidak-ada-${CAP}`, ip: A.ipUji() });
      const aneh = await A.klik(toko, kode, { productId: 'Bukan Slug!', ip: A.ipUji() });
      record('29 · Slug tak dikenal atau tidak sah: pesan "Produk tidak terdaftar di database"',
        hilang.status === 404 && hilang.error === 'Produk tidak terdaftar di database' && aneh.status === 404 && !hilang.cookie,
        `${hilang.status} ${hilang.error} / ${aneh.status}`);
    }
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    try {
      await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`);
    } catch (e) {
      console.log('Pembersihan affiliate gagal: ' + e.message);
    }
    psql(`delete from public.expenses where description = '${KET_PENGELUARAN}'`);
    psql(`update public.stores set affiliate_settings = $j$${asliAff || '{}'}$j$::jsonb, expense_categories = $j$${asliKat || '[]'}$j$::jsonb where id = '${toko}'`);
    try {
      psql(`delete from public.products where parent_sku = '${INDUK}'`);
    } catch {
      psql(`update public.products set is_active = false where parent_sku = '${INDUK}'`);
    }
  }
  ringkas();
})();
