// Perjalanan utama program affiliate, dijalankan di browser seperti pengguna:
//
// admin menyalakan program dan mengizinkan member -> affiliate (di HP) melihat
// kodenya, membuat link produk berparameter, menyalinnya -> pengunjung membuka
// link, mendaftar, checkout -> affiliate melihat order dan komisi potensial ->
// admin mengonfirmasi pesanan -> komisi Belum dibayar -> affiliate mengisi
// rekening -> admin membayar dengan bukti transfer dan pengeluaran -> komisi
// Sudah dibayar, pengeluaran muncul di Pengeluaran dan Laba Rugi.
//
// Tiap langkah di layar dibandingkan dengan isi basis data.

const { chromium } = require('playwright');
const { trackApi, waitForApiIdle, loginAdmin, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const KUNCI_TOKEN = 'tokoku.customer.token.v1';
// 1x1 PNG, cukup untuk bukti transfer.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwGAS4m9EAAAAABJRU5ErkJggg==', 'base64');
const rupiah = (n) => new RegExp('Rp\\s*' + Number(n).toLocaleString('id-ID').replace(/\./g, '\\.') + '(?![\\d.])');
const ubin = (teks, label) => (new RegExp(label + '\\s*\\n\\s*([^\\n]+)').exec(teks) || [])[1]?.trim();

(async () => {
  const toko = A.idToko();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  // Link produk berlaku per kelompok varian dan membuka varian default (permintaan 29).
  // Produk uji dipilih yang kelompoknya satu varian, supaya yang dibeli lewat link memang P1.
  const P1 = A.produkUji(toko, 40).find(
    (c) => psql(`select count(*) from public.products q join public.products p on q.store_id = p.store_id and q.slug = p.slug where p.id = '${c.id}' and q.is_active`) === '1',
  );
  if (!P1) throw new Error('Tidak ada produk uji satu varian');
  const sku = psql(`select sku from public.products where id = '${P1.id}'`);
  const browser = await chromium.launch();

  try {
    // Mulai dari program mati dengan nilai bawaan, supaya menyalakannya benar-benar diuji.
    psql(`update public.stores set affiliate_settings = '{}'::jsonb where id = '${toko}'`);
    const Af = await A.daftarPembeli(toko, CAP, 'a');

    // ---------- 1. Admin menyalakan program ----------
    const staffCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const staff = await staffCtx.newPage();
    trackApi(staff);
    await loginAdmin(staff);
    await staff.goto(BASE_URL + '/affiliate', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 1500, minWaitMs: 800 });
    record('Menu Affiliate terbuka dan menyebut program belum aktif', (await staff.getByText('Program belum aktif. Nyalakan di tab Pengaturan.').count()) > 0);
    await staff.getByRole('button', { name: 'Buka pengaturan' }).click();
    await staff.locator('[data-pengaturan-affiliate]').waitFor({ timeout: 10000 });
    await staff.locator('[data-pengaturan-affiliate] label', { hasText: 'Aktifkan program affiliate' }).first().click();
    record('Saklar program menyala setelah ditekan', await staff.getByRole('switch', { name: /Aktifkan program affiliate/ }).isChecked());
    await staff.locator('#umur-cookie').fill('5000');
    await staff.getByRole('button', { name: 'Simpan pengaturan' }).click();
    const galat = await staff.locator('[data-pengaturan-affiliate] [role="alert"]').textContent({ timeout: 5000 }).catch(() => '');
    record('Umur cookie 5000 ditolak di layar dengan pesan PRD (AC-8)', galat === 'Umur cookie harus 0 sampai 3.650 hari.', galat);
    record('Pengaturan yang ditolak tidak tersimpan', psql(`select coalesce(affiliate_settings->>'enabled', 'kosong') from public.stores where id = '${toko}'`) === 'kosong');
    await staff.locator('#umur-cookie').fill('30');
    await staff.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await staff.getByText('Pengaturan affiliate tersimpan.').first().waitFor({ timeout: 10000 }).catch(() => {});
    record('Pengaturan tersimpan: program aktif, hanya member diizinkan, cookie 30 hari, komisi 10% (FR-1, FR-4, FR-5)',
      psql(`select (affiliate_settings->>'enabled') || '|' || (affiliate_settings->>'access_mode') || '|' || (affiliate_settings->>'cookie_days') || '|' || (affiliate_settings->'commission'->0->>'value') from public.stores where id = '${toko}'`) === 'true|approved|30|10');
    record('Kepala halaman menyebut program aktif', (await staff.getByText(/Program aktif · hanya member yang diizinkan · cookie 30 hari/).count()) > 0);

    // ---------- 2. Member tanpa akses (HP 393x852) ----------
    const affCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
    await affCtx.addInitScript(([k, t]) => localStorage.setItem(k, t), [KUNCI_TOKEN, Af.token]);
    const aff = await affCtx.newPage();
    trackApi(aff);
    await aff.goto(BASE_URL + '/toko/akun', { waitUntil: 'networkidle' });
    await waitForApiIdle(aff, { idleMs: 1500, minWaitMs: 800 });
    const menuAff = aff.locator('nav[aria-label="Menu akun"]:visible').getByRole('button', { name: 'Affiliate' });
    record('Halaman akun menampilkan menu Affiliate saat program aktif', (await menuAff.count()) === 1);
    await menuAff.click();
    await aff.waitForURL((u) => u.pathname === '/toko/affiliate', { timeout: 10000 }).catch(() => {});
    await aff.locator('[data-affiliate-tanpa-akses]').waitFor({ timeout: 10000 }).catch(() => {});
    const teksTolak = await aff.locator('[data-affiliate-tanpa-akses]').innerText().catch(() => '');
    record('Member belum diizinkan melihat pesan dari pengaturan (AC-3)', teksTolak.includes('Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.'), teksTolak.replace(/\n/g, ' / ').slice(0, 140));
    record('Member tanpa akses tidak mendapat kode', psql(`select coalesce(affiliate_code, 'kosong') from public.customers where id = '${Af.id}'`) === 'kosong');

    // ---------- 3. Admin mengizinkan member ----------
    await staff.getByRole('tab', { name: 'Affiliate' }).click();
    await staff.getByLabel('Cari member').fill(Af.email);
    await staff.waitForTimeout(900);
    const barisA = staff.locator('[data-tabel-anggota] tbody tr', { hasText: Af.email });
    record('Tab Affiliate menemukan member lewat email, status Tidak berhak', (await barisA.count()) === 1 && (await barisA.innerText()).includes('Tidak berhak'));
    await barisA.getByRole('button', { name: 'Ubah' }).click();
    await staff.locator('[data-dialog-anggota]').waitFor({ timeout: 5000 });
    await staff.locator('#akses-member').selectOption('allowed');
    await staff.locator('[data-dialog-anggota]').getByRole('button', { name: 'Simpan', exact: true }).click();
    await staff.getByText(`Data affiliate ${Af.name} tersimpan.`).first().waitFor({ timeout: 10000 }).catch(() => {});
    await staff.waitForTimeout(900);
    record('Setelah diizinkan baris member berstatus Berhak (FR-2, FR-48)', (await barisA.innerText()).includes('Berhak') && !(await barisA.innerText()).includes('Tidak berhak') && psql(`select affiliate_access from public.customers where id = '${Af.id}'`) === 'allowed');

    // ---------- 4. Affiliate melihat dashboard dan membuat link ----------
    await aff.goto(BASE_URL + '/toko/affiliate', { waitUntil: 'networkidle' });
    await aff.locator('[data-ringkasan-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    const kode = psql(`select affiliate_code from public.customers where id = '${Af.id}'`);
    record('Membuka dashboard membuat kode affiliate otomatis (AC-9)', /^[A-Z0-9]{4,20}$/.test(kode), kode);
    record('Dashboard kosong mengajak membuat link', (await aff.getByText('Belum ada kunjungan dari link kamu.').count()) > 0);
    await aff.getByRole('button', { name: 'Buat link' }).click();
    await aff.locator('[data-kode-affiliate]').waitFor({ timeout: 5000 });
    record('Halaman Link menampilkan kode yang sama dengan basis data', (await aff.locator('[data-kode-affiliate]').innerText()).trim() === kode);
    record('Link seluruh toko berbentuk {toko}/aff/{KODE}', (await aff.locator('#link-toko').inputValue()) === `${BASE_URL}/aff/${kode}`, await aff.locator('#link-toko').inputValue());
    await aff.locator('#cari-produk-affiliate').fill(sku);
    await aff.getByRole('option').first().click();
    // Sejak permintaan 29 link produk memakai alamat (slug) produk, bukan id varian.
    const slugP1 = psql(`select slug from public.products where id = '${P1.id}'`);
    const linkProduk = `${BASE_URL}/aff/${kode}/${slugP1}`;
    record('Link produk berbentuk {toko}/aff/{KODE}/{slug produk} (AC-10, permintaan 29)', (await aff.locator('#link-produk').inputValue()) === linkProduk, await aff.locator('#link-produk').inputValue());
    await aff.locator('#param-platform').selectOption('what');
    await aff.locator('#param-id').fill('grup 1');
    await aff.getByRole('button', { name: 'Tambahkan parameter' }).click();
    const linkParam = `${linkProduk}?utm_source=what&utm_media=grup-1`;
    record('Parameter akuisisi ditambahkan ke link (AC-12)', (await aff.locator('#link-produk').inputValue()) === linkParam, await aff.locator('#link-produk').inputValue());
    await aff.locator('#link-produk').locator('xpath=..').getByRole('button', { name: 'Salin', exact: true }).click();
    const papan = await aff.evaluate(() => navigator.clipboard.readText()).catch((e) => 'GAGAL: ' + e.message);
    record('Tombol Salin menyalin persis link itu (AC-10)', papan === linkParam, papan);
    const waHref = await aff.locator('#link-produk').locator('xpath=..').getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
    record('Tombol WhatsApp membawa link yang sama', decodeURIComponent(waHref || '').endsWith(linkParam), (waHref || '').slice(0, 60));
    const lebar = await aff.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    record('Halaman Link di HP 393px tidak bergeser ke samping', lebar[0] <= lebar[1], lebar.join(' vs '));

    // ---------- 5. Pengunjung membuka link, mendaftar, membeli ----------
    const tamuCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const tamu = await tamuCtx.newPage();
    trackApi(tamu);
    await tamu.goto(linkParam, { waitUntil: 'networkidle' });
    // Link slug membuka /toko/produk/{slug}; produk satu varian langsung tampil sebagai P1.
    await tamu.waitForURL((u) => u.pathname === `/toko/produk/${slugP1}`, { timeout: 15000 }).catch(() => {});
    const tibaDi = new URL(tamu.url());
    const namaP1 = psql(`select name from public.products where id = '${P1.id}'`);
    const judulTiba = await tamu.locator('h1').first().innerText({ timeout: 15000 }).catch(() => '');
    record('Link affiliate membawa pengunjung ke halaman produknya (AC-13)', tibaDi.pathname === `/toko/produk/${slugP1}` && judulTiba.trim() === namaP1.trim(), `${tamu.url()} · ${judulTiba}`);
    const kue = (await tamuCtx.cookies()).find((c) => c.name === 'gnnk_aff');
    const hariKue = kue ? (kue.expires - Date.now() / 1000) / 86400 : 0;
    record('Cookie affiliate terpasang: HttpOnly, SameSite Lax, umur 30 hari (AC-6, AC-13)', !!kue && kue.httpOnly && kue.sameSite === 'Lax' && hariKue > 29.9 && hariKue < 30.1, kue ? `httpOnly=${kue.httpOnly} sameSite=${kue.sameSite} ${hariKue.toFixed(2)} hari` : 'tidak ada');
    record('Cookie tidak terbaca JavaScript halaman', !(await tamu.evaluate(() => document.cookie)).includes('gnnk_aff'));
    record('Satu kunjungan tercatat sebagai satu klik dengan parameternya (AC-13)', psql(`select count(*) || '|' || min(source) || '|' || min(media) from public.affiliate_clicks where affiliate_id = '${Af.id}'`) === '1|what|grup-1', psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${Af.id}'`) + ' klik');
    await tamu.getByRole('button', { name: /Beli sekarang/i }).first().waitFor({ timeout: 15000 });
    record('Pengunjung tidak melihat tombol Bagikan & dapat komisi (AC-18)', (await tamu.locator('[data-bagikan-komisi]:visible').count()) === 0);
    await tamu.getByRole('button', { name: /Beli sekarang/i }).first().click();
    await tamu.waitForURL((u) => u.pathname.includes('/toko/checkout'), { timeout: 10000 }).catch(() => {});
    await tamu.getByRole('button', { name: /^Daftar$/ }).click();
    await tamu.waitForURL((u) => u.pathname.includes('/toko/masuk'), { timeout: 10000 }).catch(() => {});
    const emailTamu = `aff.tamu.${CAP}@contoh.id`;
    const namaTamu = 'Uji Tamu ' + CAP;
    await tamu.getByLabel('Nama lengkap').fill(namaTamu);
    await tamu.getByLabel('Email', { exact: true }).fill(emailTamu);
    await tamu.getByLabel('Nomor HP / WhatsApp', { exact: true }).fill('0814' + CAP + '77');
    await tamu.getByLabel('Kata sandi').fill('rahasia123');
    await tamu.locator('form[data-auth] input[type="checkbox"]').check();
    await tamu.locator('form[data-auth] button[type="submit"]').click();
    await tamu.waitForURL((u) => u.pathname.includes('/toko/checkout'), { timeout: 15000 }).catch(() => {});
    await tamu.waitForTimeout(1200);
    record('Daftar lewat link affiliate: upline akun baru = affiliate, sumber link (AC-19)', psql(`select coalesce(referred_by::text, '-') || '|' || coalesce(referral_source, '-') from public.customers where lower(email) = '${emailTamu}'`) === `${Af.id}|link`);
    const ubahAlamat = tamu.getByRole('button', { name: 'Ubah', exact: true });
    if (await ubahAlamat.count()) await ubahAlamat.first().click();
    await tamu.getByLabel('Nama Penerima').fill(namaTamu);
    await tamu.getByLabel(/Nomor HP/i).fill('0814' + CAP + '77');
    await tamu.getByLabel('Provinsi').selectOption({ label: 'Jawa Timur' });
    await tamu.getByLabel('Kota/Kabupaten').selectOption({ label: 'Kota Surabaya' });
    await tamu.getByLabel('Alamat Pengiriman').fill('Jl. Uji Affiliate No. 5, ' + CAP);
    await tamu.getByRole('button', { name: /Buat Pesanan/i }).click();
    await tamu.waitForURL((u) => u.pathname.includes('/toko/selesai'), { timeout: 15000 }).catch(() => {});
    const nomor = new URL(tamu.url()).searchParams.get('order');
    record('Checkout pengunjung menghasilkan nomor pesanan', !!nomor, nomor || tamu.url());
    const idPesanan = psql(`select id from public.orders where order_number = '${nomor}'`);
    const komisi = Math.floor((P1.price * 10) / 100);
    record('Pesanan tercatat atas affiliate, sumber link, akuisisi what/grup-1 (AC-20)', psql(`select affiliate_id || '|' || affiliate_source || '|' || acquisition_source || '|' || acquisition_media from public.orders where id = '${idPesanan}'`) === `${Af.id}|link|what|grup-1`);
    record('Komisi 10% dari harga barang tercatat Order belum selesai (AC-26)', A.komisiPesanan(idPesanan).join(',') === `1:${Af.id}:${komisi}:pending:false`, A.komisiPesanan(idPesanan).join(','));

    // ---------- 6. Affiliate melihat order dan komisi potensial ----------
    await aff.goto(BASE_URL + '/toko/affiliate?tab=ringkasan', { waitUntil: 'networkidle' });
    await aff.locator('[data-ringkasan-affiliate]').waitFor({ timeout: 10000 });
    let teks = await aff.locator('[data-ringkasan-affiliate]').innerText();
    record('Ringkasan: 1 klik, 1 lead, 0 sales sebelum pesanan dikonfirmasi (AC-47)', ubin(teks, 'Klik') === '1' && ubin(teks, 'Lead') === '1' && ubin(teks, 'Sales') === '0', teks.replace(/\n/g, ' '));
    const akuisisi = await aff.locator('body').innerText();
    record('Data akuisisi menampilkan WhatsApp / grup-1', /WhatsApp/.test(akuisisi) && /grup-1/.test(akuisisi));
    await aff.goto(BASE_URL + '/toko/affiliate?tab=order', { waitUntil: 'networkidle' });
    await aff.locator('[data-daftar-order-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    teks = await aff.locator('[data-daftar-order-affiliate]').innerText().catch(() => '');
    record('Order affiliate menampilkan pesanan itu, Menunggu konfirmasi, dan komisinya', teks.includes(nomor) && teks.includes('Menunggu konfirmasi') && rupiah(komisi).test(teks) && rupiah(P1.price).test(teks), teks.replace(/\n/g, ' ').slice(0, 160));
    record('Kontak pembeli disembunyikan secara bawaan (D-9)', !teks.includes(emailTamu) && !teks.includes('0814' + CAP));
    await aff.goto(BASE_URL + '/toko/affiliate?tab=komisi', { waitUntil: 'networkidle' });
    await aff.locator('[data-total-komisi]').waitFor({ timeout: 10000 });
    teks = await aff.locator('[data-total-komisi]').innerText();
    record('Komisi potensial = komisi pesanan, Belum dibayar masih nol', rupiah(komisi).test(ubin(teks, 'Komisi potensial') || '') && rupiah(0).test(ubin(teks, 'Belum dibayar') || ''), teks.replace(/\n/g, ' '));

    // ---------- 7. Admin mengonfirmasi pesanan ----------
    await staff.goto(BASE_URL + '/orders', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 3000, minWaitMs: 2000 });
    await staff.getByRole('button', { name: 'Pesanan Website' }).click();
    await staff.waitForTimeout(1000);
    const barisPesanan = staff.locator('tr', { hasText: nomor });
    await barisPesanan.getByRole('button', { name: 'Konfirmasi' }).click();
    await staff.getByLabel('Ongkos Kirim').fill('15000');
    await staff.waitForTimeout(400);
    await staff.getByRole('button', { name: /Konfirmasi & Potong Stok/i }).click();
    await staff.waitForTimeout(2500);
    record('Konfirmasi pesanan mengubah komisi menjadi Belum dibayar (AC-32)', A.komisiPesanan(idPesanan).join(',') === `1:${Af.id}:${komisi}:added:false`, A.komisiPesanan(idPesanan).join(','));
    await staff.getByRole('button', { name: 'Semua', exact: true }).first().click().catch(() => {});
    await staff.getByPlaceholder('Cari ID / No. Pesanan Platform / meja / pelanggan').fill(nomor);
    await staff.waitForTimeout(800);
    await staff.locator('tr', { hasText: nomor }).first().locator('button[title="Detail"]').click();
    await staff.locator('[data-info-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    const info = await staff.locator('[data-info-affiliate]').innerText().catch(() => '');
    record('Detail pesanan admin menampilkan affiliate, sumber, akuisisi, dan komisinya (FR-20)', info.includes(Af.name) && info.includes(kode) && info.includes('Link affiliate') && info.includes('what / grup-1') && rupiah(komisi).test(info) && info.includes('Belum dibayar'), info.replace(/\n/g, ' ').slice(0, 200));
    await staff.keyboard.press('Escape');

    // ---------- 8. Affiliate: komisi masuk, isi rekening ----------
    await aff.goto(BASE_URL + '/toko/affiliate?tab=komisi', { waitUntil: 'networkidle' });
    await aff.locator('[data-total-komisi]').waitFor({ timeout: 10000 });
    teks = await aff.locator('[data-total-komisi]').innerText();
    record('Setelah konfirmasi: Belum dibayar = komisi, potensial nol', rupiah(komisi).test(ubin(teks, 'Belum dibayar') || '') && rupiah(0).test(ubin(teks, 'Komisi potensial') || ''), teks.replace(/\n/g, ' '));
    record('Affiliate diingatkan mengisi rekening', (await aff.getByText('Isi informasi rekening supaya komisi bisa ditransfer.').count()) > 0);
    await aff.getByRole('button', { name: 'Isi rekening' }).click();
    await aff.locator('#rekening').fill(`BCA 1234567890 a.n. ${Af.name}`);
    await aff.getByRole('button', { name: 'Simpan', exact: true }).click();
    await aff.getByText('Informasi rekening tersimpan.').first().waitFor({ timeout: 10000 }).catch(() => {});
    record('Informasi rekening tersimpan', psql(`select bank_info from public.customers where id = '${Af.id}'`) === `BCA 1234567890 a.n. ${Af.name}`);
    await aff.goto(BASE_URL + '/toko/affiliate?tab=ringkasan', { waitUntil: 'networkidle' });
    await aff.locator('[data-ringkasan-affiliate]').waitFor({ timeout: 10000 });
    teks = await aff.locator('[data-ringkasan-affiliate]').innerText();
    record('Ringkasan: 1 sales, omset = nilai barang tanpa ongkir, komisi masuk (AC-47)', ubin(teks, 'Sales') === '1' && rupiah(P1.price).test(ubin(teks, 'Omset') || '') && rupiah(komisi).test(ubin(teks, 'Komisi') || ''), teks.replace(/\n/g, ' '));
    record('Grafik omset tampil setelah ada penjualan', (await aff.locator('.recharts-bar-rectangle path.recharts-rectangle').count()) > 0 && (await aff.getByText('Belum ada penjualan di periode ini.').count()) === 0);

    // ---------- 9. Admin membayar komisi ----------
    await staff.goto(BASE_URL + '/affiliate?tab=pembayaran', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 1500, minWaitMs: 800 });
    const barisBayar = staff.locator('[data-tabel-pembayaran] tbody tr', { hasText: Af.name });
    record('Tab Pembayaran menampilkan affiliate dengan Belum dibayar yang benar', (await barisBayar.count()) === 1 && rupiah(komisi).test(await barisBayar.innerText()), (await barisBayar.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140));
    await barisBayar.getByRole('button', { name: 'Bayar' }).click();
    const dialog = staff.locator('[data-dialog-bayar]');
    await dialog.waitFor({ timeout: 5000 });
    const teksDialog = await dialog.innerText();
    record('Dialog bayar menampilkan rekening affiliate dan total komisi', teksDialog.includes(`BCA 1234567890 a.n. ${Af.name}`) && rupiah(komisi).test(teksDialog), teksDialog.replace(/\n/g, ' ').slice(0, 160));
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'bukti.png', mimeType: 'image/png', buffer: PNG });
    await dialog.getByAltText('Pratinjau bukti transfer').waitFor({ timeout: 5000 }).catch(() => {});
    await dialog.locator('#catatan-bayar').fill('Transfer BCA uji ' + CAP);
    await dialog.getByRole('button', { name: /Tandai TELAH DIBAYAR/ }).click();
    await staff.getByText(/ditandai TELAH DIBAYAR/).first().waitFor({ timeout: 10000 }).catch(() => {});
    await staff.waitForTimeout(800);
    const bayar = psql(`select trunc(p.amount) || '|' || p.commission_count || '|' || (p.proof_image like 'data:image/%') || '|' || coalesce(p.note, '') || '|' || coalesce(e.category, '-') || '|' || coalesce(trunc(e.amount)::text, '-') from public.affiliate_payouts p left join public.expenses e on e.id = p.expense_id where p.affiliate_id = '${Af.id}'`);
    record('Pembayaran tersimpan dengan bukti, catatan, dan pengeluaran Komisi Affiliate (AC-36)', bayar === `${komisi}|1|true|Transfer BCA uji ${CAP}|komisi_affiliate|${komisi}`, bayar);
    record('Komisi bertanda Sudah dibayar', A.komisiPesanan(idPesanan).join(',') === `1:${Af.id}:${komisi}:added:true`);
    await staff.goto(BASE_URL + '/expenses', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 2500, minWaitMs: 1500 });
    const barisKeluar = staff.locator('tr', { hasText: `Komisi affiliate ${Af.name}` });
    record('Pengeluaran menampilkan baris Komisi Affiliate sebesar komisi', (await barisKeluar.count()) >= 1 && (await barisKeluar.first().innerText()).includes('Komisi Affiliate') && rupiah(komisi).test(await barisKeluar.first().innerText()), (await barisKeluar.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140));
    await staff.goto(BASE_URL + '/reports?tab=pnl', { waitUntil: 'networkidle' });
    await waitForApiIdle(staff, { idleMs: 3000, minWaitMs: 2000 });
    record('Laba Rugi memuat kategori Komisi Affiliate', (await staff.getByText('Komisi Affiliate').count()) > 0);

    // ---------- 10. Affiliate: sudah dibayar, tombol bagikan di produk ----------
    await aff.goto(BASE_URL + '/toko/affiliate?tab=komisi', { waitUntil: 'networkidle' });
    await aff.locator('[data-total-komisi]').waitFor({ timeout: 10000 });
    teks = await aff.locator('[data-total-komisi]').innerText();
    record('Affiliate melihat komisinya Sudah dibayar', rupiah(komisi).test(ubin(teks, 'Sudah dibayar') || '') && rupiah(0).test(ubin(teks, 'Belum dibayar') || ''), teks.replace(/\n/g, ' '));
    record('Baris komisi berlabel Sudah dibayar', (await aff.locator('[data-daftar-komisi-affiliate]').innerText()).includes('Sudah dibayar'));
    await aff.goto(`${BASE_URL}/toko/produk?id=${P1.id}`, { waitUntil: 'networkidle' });
    const tombolKomisi = aff.locator('[data-bagikan-komisi]:visible');
    await tombolKomisi.first().waitFor({ timeout: 15000 }).catch(() => {});
    record('Affiliate melihat tombol Bagikan & dapat komisi di halaman produk', (await tombolKomisi.count()) === 1 && (await tombolKomisi.first().innerText()).includes('Bagikan & dapat komisi'));
    const kotak = await tombolKomisi.first().boundingBox().catch(() => null);
    record('Tombol itu setinggi minimal 44px di HP', !!kotak && kotak.height >= 44, kotak ? `${Math.round(kotak.height)}px` : '-');
    await tombolKomisi.first().click();
    const papan2 = await aff.evaluate(() => navigator.clipboard.readText()).catch((e) => 'GAGAL: ' + e.message);
    record('Tombol itu menyalin link affiliate produk tersebut (AC-18)', papan2 === linkProduk, papan2);
    await tamu.goto(`${BASE_URL}/toko/produk?id=${P1.id}`, { waitUntil: 'networkidle' });
    await tamu.getByRole('button', { name: /Beli sekarang/i }).first().waitFor({ timeout: 15000 });
    await tamu.waitForTimeout(1200);
    record('Member tanpa akses (pembeli tadi) tidak melihat tombol itu (AC-18)', (await tamu.locator('[data-bagikan-komisi]:visible').count()) === 0);

    // ---------- 11. Antrean email ----------
    let antre = '';
    for (let i = 0; i < 40; i += 1) {
      antre = psql(`select string_agg(kind || ':' || status, ',' order by kind) from public.affiliate_outbox where ref_id = '${idPesanan}' or ref_id in (select id from public.affiliate_commissions where order_id = '${idPesanan}') or ref_id in (select id from public.affiliate_payouts where affiliate_id = '${Af.id}')`);
      if (!antre.includes(':pending')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    record('Tiga email affiliate masuk antrean dan dilewati untuk alamat uji (AC-52)', antre === 'komisi_dibayar:skipped,komisi_masuk:skipped,pesanan_baru:skipped', antre);
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(await A.tokenAdmin(), `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    await browser.close();
  }
  ringkas();
})();
