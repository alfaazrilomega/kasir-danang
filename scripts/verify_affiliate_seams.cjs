// Sambungan program affiliate dengan fitur lain yang sudah ada: varian produk,
// hapus pesanan massal, pelanggan, rentang tanggal, batas hari WIB, umur
// cookie, dan sesi yang berubah di tengah jalan. Bagian-bagiannya sudah diuji
// di suite lain; yang diuji di sini adalah titik temu antarbagian.

const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { trackApi, waitForApiIdle, loginAdmin, envValue, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const KUNCI_TOKEN = 'tokoku.customer.token.v1';
const afiliasi = (id) => psql(`select coalesce(affiliate_id::text, '-') || '|' || coalesce(affiliate_source, '-') || '|' || coalesce(acquisition_source, '-') from public.orders where id = '${id}'`);
const q = (token, body) => panggil('POST', '/api/query', { token, body: { columns: '*', filters: [], orderBy: null, limit: null, payload: null, returning: false, single: false, maybeSingle: false, ...body } });

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const [P1, P2] = A.produkUji(toko, 2);
  // Dua varian dari satu produk: SKU Induk sama, baris produk berbeda.
  const varian = psql(
    `select string_agg(id::text, ',') from (
       select id from public.products
        where store_id = '${toko}' and is_active and stock_qty >= 10 and base_price >= 10000
          and jsonb_array_length(coalesce(sizes, '[]'::jsonb)) = 0
          and parent_sku = (
            select parent_sku from public.products
             where store_id = '${toko}' and is_active and stock_qty >= 10 and base_price >= 10000 and btrim(coalesce(parent_sku, '')) <> ''
               and jsonb_array_length(coalesce(sizes, '[]'::jsonb)) = 0
             group by parent_sku having count(*) >= 2 order by parent_sku limit 1)
        order by id limit 2) v`,
  ).split(',');
  const [V1, V2] = varian;
  const browser = await chromium.launch();
  let idProdukForm = null;
  let idKasir = null;

  try {
    const dasar = {
      enabled: true, access_mode: 'approved', cookie_days: 30, general_cookie: true, permanent: false,
      commission: [{ type: 'percentage', value: 10 }], 
    };
    await A.aturProgram(admin, dasar);
    const Af = await A.daftarPembeli(toko, CAP, 'a');
    const Bf = await A.daftarPembeli(toko, CAP, 'b');
    await A.izinkan(admin, Af.id);
    await A.izinkan(admin, Bf.id);
    const kodeA = await A.kodeAffiliate(Af.token);
    const kodeB = await A.kodeAffiliate(Bf.token);
    const C = await A.daftarPembeli(toko, CAP, 'c');

    // ---------- 1. Varian produk: link satu varian berlaku untuk variannya yang lain ----------
    record('Data uji punya dua varian dari satu SKU Induk', !!V1 && !!V2 && V1 !== V2, varian.join(' '));
    await A.aturProgram(admin, { general_cookie: false });
    const kV1 = await A.klik(toko, kodeA, { productId: V1, source: 'fb', media: 'varian' });
    const oV2 = await A.pesan(toko, C, [{ product_id: V2, qty: 1 }], { cookie: kV1.cookie });
    record('Link varian A, pembeli membeli varian B dari produk yang sama: tetap tercatat (General cookie mati) (AC-53)', afiliasi(oV2.id) === `${Af.id}|link|fb`, afiliasi(oV2.id));
    const oLain = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kV1.cookie });
    record('Produk lain yang bukan variannya tetap tanpa affiliate (General cookie mati)', afiliasi(oLain.id).startsWith('-|'), afiliasi(oLain.id));
    await A.aturProgram(admin, { general_cookie: true });
    const kUmumB = await A.klik(toko, kodeB, { cookie: kV1.cookie });
    const oV2b = await A.pesan(toko, C, [{ product_id: V2, qty: 1 }], { cookie: kUmumB.cookie });
    record('Klik produk oleh A mengalahkan klik umum B, juga untuk varian lain produk itu', afiliasi(oV2b.id).startsWith(`${Af.id}|link`), afiliasi(oV2b.id));
    psql(`update public.products set affiliate_if_bought = true where id in ('${V1}', '${V2}')`);
    const belum = await A.klik(toko, kodeB, { productId: V2 });
    const beli = await A.pesan(toko, Bf, [{ product_id: V1, qty: 1 }]);
    await A.konfirmasi(admin, beli.id);
    const sudah = await A.klik(toko, kodeB, { productId: V2 });
    record('Syarat sudah membeli terpenuhi oleh pembelian varian mana pun dari produk itu (AC-54)', belum.status === 403 && sudah.status === 200, `${belum.status} lalu ${sudah.status}`);
    psql(`update public.products set affiliate_if_bought = false where id in ('${V1}', '${V2}')`);

    // ---------- 2. Hapus dan batal pesanan massal ----------
    const kA = await A.klik(toko, kodeA, { productId: P1.id });
    const oBatal = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kA.cookie });
    const oHapus = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kA.cookie });
    const oBayar = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kA.cookie });
    for (const o of [oBatal, oHapus, oBayar]) await A.konfirmasi(admin, o.id);
    const batal = await panggil('POST', '/api/rpc/void_orders', { token: admin, body: { p_order_ids: [oBatal.id], p_delete: false } });
    record('Batal pesanan massal: komisinya ikut Dibatalkan', batal.status === 200 && A.komisiPesanan(oBatal.id).join(',').includes(':cancelled:'), A.komisiPesanan(oBatal.id).join(','));
    const idKomisiBayar = psql(`select id from public.affiliate_commissions where order_id = '${oBayar.id}'`);
    await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: [idKomisiBayar], action: 'mark_paid' } });
    const hapusBayar = await panggil('POST', '/api/rpc/void_orders', { token: admin, body: { p_order_ids: [oHapus.id, oBayar.id], p_delete: true } });
    record('Hapus pesanan yang komisinya sudah dibayar ditolak dengan pesan yang menyebut nomornya (AC-58)',
      hapusBayar.status === 409 && String(hapusBayar.error).includes(oBayar.number) && /komisi affiliate/i.test(hapusBayar.error || ''), `${hapusBayar.status} ${hapusBayar.error || ''}`);
    record('Penolakan itu tidak menghapus apa pun, termasuk pesanan lain di permintaan yang sama',
      psql(`select count(*) from public.orders where id in ('${oHapus.id}', '${oBayar.id}')`) === '2' && psql(`select paid from public.affiliate_commissions where id = '${idKomisiBayar}'`) === 't');
    const hapusBiasa = await panggil('POST', '/api/rpc/void_orders', { token: admin, body: { p_order_ids: [oHapus.id], p_delete: true } });
    record('Hapus pesanan yang komisinya belum dibayar: pesanan dan komisinya hilang bersama',
      hapusBiasa.status === 200 && psql(`select count(*) from public.orders where id = '${oHapus.id}'`) === '0' && psql(`select count(*) from public.affiliate_commissions where order_id = '${oHapus.id}'`) === '0');
    await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: [idKomisiBayar], action: 'mark_unpaid' } });
    const hapusSetelah = await panggil('POST', '/api/rpc/void_orders', { token: admin, body: { p_order_ids: [oBayar.id], p_delete: true } });
    record('Setelah pembayaran komisinya dibatalkan, pesanan itu bisa dihapus (AC-58)', hapusSetelah.status === 200 && psql(`select count(*) from public.orders where id = '${oBayar.id}'`) === '0');
    const ringkasA = (await panggil('GET', '/api/customer/affiliate', { token: Af.token })).data.summary.all;
    const hitung = psql(`select count(*) filter (where order_status <> 'canceled') || '|' || count(*) filter (where order_status = 'done') from public.orders where affiliate_id = '${Af.id}'`);
    record('Ringkasan affiliate mengikuti pesanan yang tersisa setelah batal dan hapus', `${ringkasA.leads}|${ringkasA.sales}` === hitung, `${ringkasA.leads}|${ringkasA.sales} vs ${hitung}`);

    // ---------- 3. Pelanggan yang punya komisi tidak bisa dihapus diam-diam ----------
    const hapusAff = await q(admin, { table: 'customers', action: 'delete', filters: [{ type: 'eq', column: 'id', value: Af.id }] });
    record('Menghapus pelanggan yang punya komisi affiliate ditolak dengan pesan, bukan galat 500',
      hapusAff.status >= 400 && hapusAff.status < 500 && psql(`select count(*) from public.customers where id = '${Af.id}'`) === '1', `${hapusAff.status} ${hapusAff.error || ''}`);

    // ---------- 4. Rentang tanggal: ringkasan dan pembayaran memakai aturan yang sama ----------
    const oRentang = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kA.cookie });
    await A.konfirmasi(admin, oRentang.id);
    const kemarin = psql(`select ((now() at time zone 'Asia/Jakarta')::date - 1)::text`);
    const hariIni = psql(`select (now() at time zone 'Asia/Jakarta')::date::text`);
    const belumA = Number(psql(`select coalesce(sum(commission), 0) from public.affiliate_commissions where affiliate_id = '${Af.id}' and status = 'added' and not paid`));
    const rKemarin = await panggil('GET', `/api/admin/affiliate/payouts/summary?to=${kemarin}`, { token: admin });
    const bayarKemarin = await panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: Af.id, to: kemarin, record_expense: false } });
    record('Rentang sampai kemarin: ringkasan tidak memuat komisi hari ini dan pembayaran ditolak 409',
      belumA > 0 && !(rKemarin.data || []).some((x) => x.affiliate_id === Af.id && x.unpaid > 0) && bayarKemarin.status === 409, `${bayarKemarin.status}`);
    const rHari = await panggil('GET', `/api/admin/affiliate/payouts/summary?from=${hariIni}&to=${hariIni}`, { token: admin });
    const bayarHari = await panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: Af.id, from: hariIni, to: hariIni, record_expense: false } });
    record('Rentang hari ini: jumlah di ringkasan sama dengan yang dibayarkan', (rHari.data || []).find((x) => x.affiliate_id === Af.id)?.unpaid === belumA && bayarHari.data?.amount === belumA, `${bayarHari.data?.amount} vs ${belumA}`);

    // ---------- 5. Batas hari WIB di ringkasan affiliate ----------
    const oWaktu = await A.pesan(toko, C, [{ product_id: P2.id, qty: 1 }], { cookie: kUmumB.cookie });
    await A.konfirmasi(admin, oWaktu.id);
    const salesHari = async () => (await panggil('GET', '/api/customer/affiliate', { token: Bf.token })).data.summary.today.sales;
    const awal = await salesHari();
    // 00.30 WIB hari ini = 17.30 UTC kemarin: masih terhitung "hari ini".
    psql(`update public.orders set created_at = ((now() at time zone 'Asia/Jakarta')::date + time '00:30') at time zone 'Asia/Jakarta' where id = '${oWaktu.id}'`);
    const dini = await salesHari();
    // 23.30 WIB kemarin: bukan hari ini lagi.
    psql(`update public.orders set created_at = ((now() at time zone 'Asia/Jakarta')::date - 1 + time '23:30') at time zone 'Asia/Jakarta' where id = '${oWaktu.id}'`);
    const malam = await salesHari();
    record('Pesanan pukul 00.30 WIB terhitung hari ini, pukul 23.30 WIB kemarin tidak', dini === awal && malam === awal - 1, `awal ${awal}, 00.30 ${dini}, 23.30 kemarin ${malam}`);

    // ---------- 6. Umur cookie ditegakkan server, bukan hanya browser ----------
    const { perbaruiCookie, tandatangani } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'affiliate', 'inti.js')).href);
    const rahasia = envValue('AUTH_SECRET') || envValue('SESSION_SECRET') || 'dev-only-change-me';
    const kini = Math.floor(Date.now() / 1000);
    const kue = (detik) => `gnnk_aff=${encodeURIComponent(tandatangani(perbaruiCookie(null, { affiliateId: Af.id, productId: P1.id, kind: 'link' }, detik), rahasia))}`;
    const oSegar = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kue(kini - 29 * 86400) });
    const oBasi = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kue(kini - 31 * 86400) });
    record('Cookie berumur 29 hari masih berlaku, 31 hari tidak (umur cookie 30 hari) (AC-55)', afiliasi(oSegar.id).startsWith(`${Af.id}|`) && afiliasi(oBasi.id).startsWith('-|'), `${afiliasi(oSegar.id)} / ${afiliasi(oBasi.id)}`);
    const Dbasi = await A.daftarPembeli(toko, CAP, 'd1', { cookie: kue(kini - 31 * 86400) });
    record('Daftar dengan cookie kedaluwarsa tidak membuat upline', psql(`select coalesce(referred_by::text, '-') from public.customers where id = '${Dbasi.id}'`) === '-');
    await A.aturProgram(admin, { cookie_days: 0 });
    const oAbadi = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kue(kini - 400 * 86400) });
    record('Umur cookie 0 (selamanya): cookie berumur 400 hari tetap berlaku (AC-55)', afiliasi(oAbadi.id).startsWith(`${Af.id}|`), afiliasi(oAbadi.id));
    await A.aturProgram(admin, { cookie_days: 30 });

    // ---------- 7. Undangan dan kode ----------
    const emailTeman = `aff.undang.s.${CAP}@contoh.id`;
    const und = await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailTeman } });
    await panggil('POST', '/api/customer/signup', { ip: A.ipUji(), cookie: (await A.klik(toko, kodeB)).cookie, body: { store_id: toko, email: emailTeman, password: 'rahasia123', name: 'Teman S ' + CAP, phone: '0816' + CAP + '21', privacy_accepted: true } });
    record('Penerima undangan yang mendaftar lewat link affiliate lain menjadi downline pemilik link itu', psql(`select referred_by || '|' || referral_source from public.customers where lower(email) = '${emailTeman}'`) === `${Bf.id}|link`);
    psql(`update public.affiliate_invitations set sent_at = now() - interval '25 hours' where id = '${und.data.id}'`);
    const ulang = await panggil('POST', `/api/customer/affiliate/invitations/${und.data.id}/resend`, { token: Af.token, body: {} });
    record('Undangan ke email yang sudah menjadi member tidak bisa dikirim ulang (AC-61)', ulang.status === 409 && ulang.error === 'Email ini sudah terdaftar sebagai member.', `${ulang.status} ${ulang.error || ''}`);
    const kodeTerlarang = await panggil('PATCH', `/api/admin/affiliate/members/${Bf.id}`, { token: admin, body: { code: 'UNDANGAN' } });
    record('Kode UNDANGAN ditolak karena bertabrakan dengan alamat undangan (AC-62)', kodeTerlarang.status === 400 && psql(`select affiliate_code from public.customers where id = '${Bf.id}'`) === kodeB, `${kodeTerlarang.status} ${kodeTerlarang.error || ''}`);

    // ---------- 8. Akses dicabut dan program dimatikan saat dashboard terbuka ----------
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [KUNCI_TOKEN, Bf.token]);
    const hal = await ctx.newPage();
    trackApi(hal);
    const galatKonsol = [];
    hal.on('pageerror', (e) => galatKonsol.push(e.message));
    await hal.goto(BASE_URL + '/toko/affiliate?tab=order', { waitUntil: 'networkidle' });
    await hal.locator('[data-daftar-order-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    await A.izinkan(admin, Bf.id, 'blocked');
    await hal.locator('nav[aria-label="Menu affiliate"]:visible').getByRole('button', { name: 'Komisi' }).click();
    await hal.waitForTimeout(1500);
    await hal.reload({ waitUntil: 'networkidle' });
    await hal.locator('[data-affiliate-tanpa-akses]').waitFor({ timeout: 10000 }).catch(() => {});
    record('Akses dicabut saat dashboard terbuka: muat ulang menampilkan pesan tanpa akses, tanpa galat halaman', (await hal.locator('[data-affiliate-tanpa-akses]').count()) === 1 && galatKonsol.length === 0, galatKonsol.join(' ; '));
    await A.izinkan(admin, Bf.id, 'allowed');
    await A.aturProgram(admin, { enabled: false });
    await hal.reload({ waitUntil: 'networkidle' });
    await hal.locator('[data-affiliate-tanpa-akses]').waitFor({ timeout: 10000 }).catch(() => {});
    record('Program dimatikan: dashboard menyebut program belum dibuka', (await hal.getByText('Program affiliate belum dibuka').count()) === 1);
    await hal.goto(BASE_URL + '/toko/akun', { waitUntil: 'networkidle' });
    await waitForApiIdle(hal, { idleMs: 1200, minWaitMs: 800 });
    record('Program dimatikan: menu Affiliate hilang dari halaman akun, menu kembali empat kolom',
      (await hal.locator('nav[aria-label="Menu akun"]:visible').getByRole('button', { name: 'Affiliate' }).count()) === 0 && (await hal.locator('nav[aria-label="Menu akun"]:visible button').count()) === 4);
    await A.aturProgram(admin, { enabled: true });

    // ---------- 9. Ekspor CSV komisi memakai format bersama aplikasi ----------
    const staffCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const staff = await staffCtx.newPage();
    trackApi(staff);
    await loginAdmin(staff);
    await staff.goto(BASE_URL + '/affiliate?tab=komisi', { waitUntil: 'networkidle' });
    await staff.locator('[data-tabel-komisi-admin]').waitFor({ timeout: 15000 }).catch(() => {});
    const [unduhan] = await Promise.all([staff.waitForEvent('download', { timeout: 15000 }), staff.getByRole('button', { name: 'Export CSV' }).click()]);
    const mentah = require('fs').readFileSync(await unduhan.path(), 'utf8');
    const isi = mentah.charCodeAt(0) === 0xfeff ? mentah.slice(1) : mentah;
    const baris = isi.split(/\r?\n/);
    record('Ekspor CSV komisi: baris sep=; lalu kolom dipisah titik koma seperti ekspor lain',
      baris[0] === 'sep=;' && baris[1] === 'Tanggal;No. Pesanan;Affiliate;Produk;Tier;Komisi;Status' && baris.length > 2 && baris[2].split(';').length >= 7, baris.slice(0, 3).join(' // ').slice(0, 200));
    record('Kolom Komisi di CSV berupa angka polos yang bisa dijumlahkan Excel', /^\d+$/.test((baris[2] || '').split(';').slice(-2)[0] || ''), (baris[2] || '').split(';').slice(-2)[0]);

    // ---------- 10. Bagian Affiliasi di formulir produk (FR-10) ----------
    idProdukForm = P2.id;
    const skuP2 = psql(`select sku from public.products where id = '${P2.id}'`);
    const afProduk = () => psql(`select affiliate_enabled || '|' || affiliate_if_bought || '|' || coalesce(affiliate_commission::text, 'null') from public.products where id = '${P2.id}'`);
    const bukaFormProduk = async () => {
      await staff.goto(BASE_URL + '/products', { waitUntil: 'networkidle' });
      await waitForApiIdle(staff, { idleMs: 2500, minWaitMs: 1500 });
      await staff.getByPlaceholder('Cari nama / SKU / barcode').fill(skuP2);
      await staff.waitForTimeout(900);
      await staff.locator('tr', { hasText: skuP2 }).first().locator('button[title="Edit"]').click();
      await staff.locator('[data-seksi-affiliasi]').waitFor({ timeout: 10000 });
      await staff.locator('[data-seksi-affiliasi]').scrollIntoViewIfNeeded();
    };
    const simpanProduk = async () => {
      await staff.getByRole('button', { name: 'Simpan', exact: true }).last().click();
      await staff.waitForTimeout(1800);
    };
    await bukaFormProduk();
    const seksi = staff.locator('[data-seksi-affiliasi]');
    record('Formulir produk punya bagian Affiliasi dengan dua pilihan Sejoli, bawaan aktif dan tanpa syarat',
      (await seksi.getByLabel('Aktifkan fitur affiliasi pada produk ini').isChecked()) && !(await seksi.getByLabel('Aktifkan fitur affiliasi jika user telah membeli produk ini').isChecked())
        && (await seksi.getByText('Produk memakai komisi bawaan toko.').count()) === 1);
    await seksi.getByRole('button', { name: 'Tambah tier' }).click();
    await seksi.getByLabel('Tipe komisi tier 1').selectOption('fixed');
    await seksi.getByLabel('Besar komisi tier 1').fill('7500');
    await seksi.getByLabel('Aktifkan fitur affiliasi jika user telah membeli produk ini').check();
    await simpanProduk();
    record('Komisi khusus dan syarat sudah membeli tersimpan dari formulir (AC-63)', afProduk() === 'true|true|[{"type": "fixed", "value": 7500}]', afProduk());
    await bukaFormProduk();
    record('Membuka lagi formulir menampilkan nilai yang tersimpan (AC-63)',
      (await seksi.getByLabel('Tipe komisi tier 1').inputValue()) === 'fixed' && (await seksi.getByLabel('Besar komisi tier 1').inputValue()) === '7500'
        && (await seksi.getByLabel('Aktifkan fitur affiliasi jika user telah membeli produk ini').isChecked()));
    await seksi.getByLabel('Tipe komisi tier 1').selectOption('percentage');
    await seksi.getByLabel('Besar komisi tier 1').fill('150');
    await simpanProduk();
    record('Persentase 150 ditolak formulir dan tidak tersimpan (AC-63)', (await staff.getByText('Persentase komisi harus 0 sampai 100.').count()) > 0 && afProduk() === 'true|true|[{"type": "fixed", "value": 7500}]', afProduk());
    await seksi.getByLabel('Hapus tier 1').click();
    await seksi.getByLabel('Aktifkan fitur affiliasi pada produk ini').uncheck();
    record('Affiliasi dimatikan: pilihan komisi disembunyikan dan syarat sudah membeli dinonaktifkan',
      (await seksi.getByText('Komisi khusus produk').count()) === 0 && (await seksi.getByLabel('Aktifkan fitur affiliasi jika user telah membeli produk ini').isDisabled()));
    await simpanProduk();
    record('Affiliasi produk dimatikan dari formulir, komisi khusus kembali kosong', afProduk().startsWith('false|') && afProduk().endsWith('|null'), afProduk());
    const linkMati = await A.klik(toko, kodeA, { productId: P2.id });
    record('Link ke produk yang baru dimatikan langsung ditolak', linkMati.status === 403 && linkMati.error === 'Produk ini sudah tidak diaffiliasikan lagi', `${linkMati.status} ${linkMati.error || ''}`);
    psql(`update public.products set affiliate_enabled = true, affiliate_if_bought = false, affiliate_commission = null where id = '${P2.id}'`);

    // ---------- 11. Sesi rusak dan tautan dalam dari email ----------
    const ctxSesi = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    const sesi = await ctxSesi.newPage();
    trackApi(sesi);
    await sesi.goto(BASE_URL + '/toko', { waitUntil: 'domcontentloaded' });
    await sesi.evaluate((k) => localStorage.setItem(k, 'sesi.rusak.sekali'), KUNCI_TOKEN);
    await sesi.goto(BASE_URL + '/toko/affiliate?tab=komisi', { waitUntil: 'networkidle' });
    await sesi.waitForURL((u) => u.pathname === '/toko/masuk', { timeout: 15000 }).catch(() => {});
    const tujuan = new URL(sesi.url());
    record('Sesi rusak di dashboard affiliate: dibawa ke halaman masuk, bukan layar galat (AC-64)', tujuan.pathname === '/toko/masuk' && tujuan.searchParams.get('next') === '/toko/affiliate?tab=komisi', sesi.url());
    await sesi.locator('#masuk-id').fill(Af.email);
    await sesi.locator('#masuk-sandi').fill('rahasia123');
    await sesi.locator('form[data-auth] button[type="submit"]').click();
    await sesi.waitForURL((u) => u.pathname === '/toko/affiliate', { timeout: 15000 }).catch(() => {});
    await sesi.locator('[data-total-komisi]').waitFor({ timeout: 10000 }).catch(() => {});
    record('Setelah masuk, pengguna tiba di tab yang dituju tautan (Komisi) (AC-64)', new URL(sesi.url()).searchParams.get('tab') === 'komisi' && (await sesi.locator('[data-total-komisi]').count()) === 1, sesi.url());

    // ---------- 12. Layar sempit dengan nilai terpanjang ----------
    const namaPanjang = `Muhammad Fathurrahman Al Ghifari Kusumawardhana Putra Wijayakusuma Adiningrat Suryodiningrat Hadikusumo ${CAP}`.slice(0, 118);
    const L = await A.daftarPembeli(toko, CAP, 'panjang', { name: namaPanjang });
    await A.izinkan(admin, L.id);
    const kodeL = await A.kodeAffiliate(L.token);
    const kL = await A.klik(toko, kodeL, { productId: P1.id, source: 'what', media: 'grup-whatsapp-komunitas-trail-jawa-timur-2026' });
    const K = await A.daftarPembeli(toko, CAP, 'pembelipanjang', { cookie: kL.cookie, name: namaPanjang.replace('Muhammad', 'Siti Nurhaliza') });
    const oL1 = await A.pesan(toko, K, [{ product_id: P1.id, qty: 9 }, { product_id: P2.id, qty: 9 }], { cookie: kL.cookie });
    await A.konfirmasi(admin, oL1.id);
    await A.pesan(toko, K, [{ product_id: P1.id, qty: 1 }], { cookie: kL.cookie });
    await panggil('POST', '/api/customer/affiliate/invitations', { token: L.token, body: { email: `aff.undang.alamat.email.yang.sangat.panjang.sekali.untuk.uji.${CAP}@contoh.id`, name: namaPanjang.slice(0, 80) } });
    await panggil('PATCH', '/api/customer/affiliate/bank', { token: L.token, body: { bank_info: `Bank Central Asia (BCA) Kantor Cabang Pembantu Surabaya Darmo, nomor rekening 1234567890123456, atas nama ${namaPanjang}`.slice(0, 300) } });
    const ctxUkur = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    await ctxUkur.addInitScript(([k, t]) => localStorage.setItem(k, t), [KUNCI_TOKEN, L.token]);
    const ukur = await ctxUkur.newPage();
    trackApi(ukur);
    const bersih = (r, sentuh) => r.ada && r.diperiksa > 20 && !r.geser && r.jumlahKeluar === 0 && r.terpotong.length === 0 && (!sentuh || (r.sentuh > 0 && r.jumlahKecil === 0));
    for (const lebar of [360, 393]) {
      const buruk = [];
      let jumlah = 0;
      await ukur.setViewportSize({ width: lebar, height: 740 });
      for (const t of ['ringkasan', 'link', 'order', 'komisi', 'jaringan', 'undang', 'rekening']) {
        await ukur.goto(`${BASE_URL}/toko/affiliate?tab=${t}`, { waitUntil: 'networkidle' });
        await ukur.locator('[data-affiliate-layar] section h1').waitFor({ timeout: 10000 }).catch(() => {});
        await ukur.waitForTimeout(500);
        const r = await ukur.evaluate(A.UKUR_LAYAR, 44);
        jumlah += r.diperiksa || 0;
        if (!bersih(r, true)) buruk.push(`${t}: ${A.ringkasUkur(r)}`);
      }
      record(`Dashboard affiliate ${lebar}px dengan nama, email, dan angka terpanjang: 7 tab tanpa geser, tanpa elemen keluar layar, semua kontrol 44px`, buruk.length === 0 && jumlah > 300, buruk.length ? buruk.join(' || ') : `${jumlah} elemen diukur`);
    }
    await ukur.setViewportSize({ width: 360, height: 740 });
    await ukur.goto(`${BASE_URL}/toko/affiliate?tab=rekening`, { waitUntil: 'networkidle' });
    await ukur.locator('#rekening').waitFor({ timeout: 10000 }).catch(() => {});
    await ukur.waitForTimeout(400);
    const tabAktif = await ukur.evaluate(() => {
      const el = document.querySelector('nav[aria-label="Menu affiliate"] [aria-current="page"]');
      const tampak = Array.from(document.querySelectorAll('nav[aria-label="Menu affiliate"] [aria-current="page"]')).find((x) => x.getBoundingClientRect().width > 0) || el;
      const b = tampak.getBoundingClientRect();
      return { teks: tampak.innerText.trim(), kiri: Math.round(b.left), kanan: Math.round(b.right), lebar: innerWidth };
    });
    record('Dibuka langsung di tab Rekening (HP 360px): tab aktif terlihat utuh di bilah menu', tabAktif.teks === 'Rekening' && tabAktif.kiri >= 0 && tabAktif.kanan <= tabAktif.lebar, JSON.stringify(tabAktif));
    await ukur.goto(`${BASE_URL}/toko/affiliate?tab=ringkasan`, { waitUntil: 'networkidle' });
    await ukur.locator('[data-ringkasan-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    const tinggiPeriode = await ukur.evaluate(() => Array.from(document.querySelectorAll('[role="tablist"][aria-label="Periode"] [role="tab"]')).map((b) => Math.round(b.getBoundingClientRect().height)));
    record('Pilihan periode di HP 360px satu baris semua (tinggi sama, tidak terlipat)', tinggiPeriode.length === 3 && new Set(tinggiPeriode).size === 1 && tinggiPeriode[0] <= 48, tinggiPeriode.join(','));
    for (const lebar of [360, 393]) {
      await ukur.setViewportSize({ width: lebar, height: 740 });
      await ukur.goto(`${BASE_URL}/toko/akun`, { waitUntil: 'networkidle' });
      await waitForApiIdle(ukur, { idleMs: 1200, minWaitMs: 800 });
      const akun = await ukur.evaluate(() => {
        const tombol = Array.from(document.querySelectorAll('nav[aria-label="Menu akun"] button')).filter((b) => b.getBoundingClientRect().width > 0);
        const aff = tombol.find((b) => b.innerText.trim() === 'Affiliate');
        return { halaman: document.documentElement.scrollWidth, layar: document.documentElement.clientWidth, menu: tombol.length, kananAff: aff ? Math.round(aff.getBoundingClientRect().right) : -1 };
      });
      record(`Halaman akun ${lebar}px dengan nama 118 huruf: tidak bergeser, kelima menu termasuk Affiliate di dalam layar`, akun.halaman <= akun.layar && akun.menu === 5 && akun.kananAff > 0 && akun.kananAff <= akun.layar, JSON.stringify(akun));
    }
    // Rentang tanggal di tab Order dan Komisi, dan grafik Sales (FR-24, FR-38, FR-40), di HP.
    await ukur.setViewportSize({ width: 393, height: 852 });
    await ukur.goto(`${BASE_URL}/toko/affiliate?tab=order`, { waitUntil: 'networkidle' });
    await ukur.locator('[data-daftar-order-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    const orderAwal = await ukur.locator('[data-daftar-order-affiliate] > li').count();
    await ukur.locator('#sampai-tanggal').fill(kemarin);
    await ukur.getByText('Tidak ada order di rentang tanggal ini.').waitFor({ timeout: 10000 }).catch(() => {});
    const orderKosong = (await ukur.getByText('Tidak ada order di rentang tanggal ini.').count()) === 1 && (await ukur.locator('[data-daftar-order-affiliate]').count()) === 0;
    await ukur.getByRole('button', { name: 'Semua tanggal' }).click();
    await ukur.locator('[data-daftar-order-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    const orderKembali = await ukur.locator('[data-daftar-order-affiliate] > li').count();
    record('Tab Order: rentang sampai kemarin mengosongkan daftar, Semua tanggal mengembalikannya (FR-40)', orderAwal > 0 && orderKosong && orderKembali === orderAwal, `${orderAwal} lalu kosong=${orderKosong} lalu ${orderKembali}`);
    await ukur.goto(`${BASE_URL}/toko/affiliate?tab=komisi`, { waitUntil: 'networkidle' });
    await ukur.locator('[data-daftar-komisi-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    const totalAwal = await ukur.locator('[data-total-komisi]').innerText();
    const komisiAwal = await ukur.locator('[data-daftar-komisi-affiliate] > li').count();
    await ukur.locator('#dari-tanggal').fill(hariIni);
    await ukur.waitForTimeout(1200);
    const komisiHariIni = await ukur.locator('[data-daftar-komisi-affiliate] > li').count();
    await ukur.locator('#dari-tanggal').fill('');
    await ukur.locator('#sampai-tanggal').fill(kemarin);
    await ukur.getByText('Tidak ada komisi di rentang tanggal ini.').waitFor({ timeout: 10000 }).catch(() => {});
    record('Tab Komisi: rentang tanggal menyaring daftar, tiga total di atas tidak berubah (FR-24)',
      komisiAwal > 0 && komisiHariIni === komisiAwal && (await ukur.getByText('Tidak ada komisi di rentang tanggal ini.').count()) === 1 && (await ukur.locator('[data-total-komisi]').innerText()) === totalAwal,
      `${komisiAwal} baris, hari ini ${komisiHariIni}`);
    const rentangUkur = await ukur.evaluate(A.UKUR_LAYAR, 44);
    record('Kolom rentang tanggal di HP 393px: tanpa geser, tanpa elemen keluar layar, 44px', rentangUkur.ada && !rentangUkur.geser && rentangUkur.jumlahKeluar === 0 && rentangUkur.jumlahKecil === 0, A.ringkasUkur(rentangUkur));
    await ukur.goto(`${BASE_URL}/toko/affiliate?tab=ringkasan`, { waitUntil: 'networkidle' });
    await ukur.locator('[data-ringkasan-affiliate]').waitFor({ timeout: 10000 }).catch(() => {});
    await ukur.getByRole('group', { name: 'Angka grafik' }).getByRole('button', { name: 'Sales' }).click();
    await ukur.waitForTimeout(700);
    const sumbuSales = await ukur.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
    record('Grafik bisa menampilkan Sales selain Omset, sumbunya bilangan bulat (FR-38)',
      (await ukur.getByRole('heading', { name: 'Grafik sales' }).count()) === 1 && (await ukur.locator('.recharts-bar-rectangle path.recharts-rectangle').count()) > 0 && sumbuSales.length > 1 && sumbuSales.every((t) => /^\d+$/.test(t.trim())), sumbuSales.join(' '));
    for (const lebar of [393, 768, 1024, 1280]) {
      const buruk = [];
      let jumlah = 0;
      await staff.setViewportSize({ width: lebar, height: 900 });
      for (const t of ['ringkasan', 'komisi', 'pembayaran', 'affiliate', 'pengaturan']) {
        await staff.goto(`${BASE_URL}/affiliate?tab=${t}`, { waitUntil: 'networkidle' });
        await waitForApiIdle(staff, { idleMs: 1200, minWaitMs: 700 });
        const r = await staff.evaluate(A.UKUR_LAYAR, lebar < 640 ? 44 : 0);
        jumlah += r.diperiksa || 0;
        if (!bersih(r, lebar < 640)) buruk.push(`${t}: ${A.ringkasUkur(r)}`);
      }
      record(`Admin affiliate ${lebar}px: 5 tab tanpa geser, tanpa tabel terpotong${lebar < 640 ? ', semua kontrol 44px' : ''}`, buruk.length === 0 && jumlah > 300, buruk.length ? buruk.join(' || ') : `${jumlah} elemen diukur`);
    }
    // ---------- 13. Admin: calon upline dan pilih semua di tampilan kartu ----------
    await staff.setViewportSize({ width: 1400, height: 1000 });
    await staff.goto(`${BASE_URL}/affiliate?tab=ringkasan`, { waitUntil: 'networkidle' });
    await staff.locator('[data-ringkasan-admin]').waitFor({ timeout: 15000 }).catch(() => {});
    await staff.getByRole('button', { name: 'Semua', exact: true }).first().click();
    await waitForApiIdle(staff, { idleMs: 1200, minWaitMs: 700 });
    const ovSemua = (await panggil('GET', '/api/admin/affiliate/overview', { token: admin })).data;
    const ubinAdmin = await staff.locator('[data-ringkasan-admin]').innerText();
    const nilaiKomisi = (/Komisi\s*\n\s*(Rp[^\n]+)\n\s*Belum \+ sudah dibayar/.exec(ubinAdmin) || [])[1] || '';
    record('Ubin Komisi admin berarti belum + sudah dibayar, sama dengan arti Komisi di dashboard affiliate (D-10)',
      Number(nilaiKomisi.replace(/[^\d]/g, '')) === Math.round(ovSemua.totals.unpaid + ovSemua.totals.paid) && ovSemua.totals.unpaid + ovSemua.totals.paid > 0, `${nilaiKomisi} vs ${ovSemua.totals.unpaid + ovSemua.totals.paid}`);
    await A.izinkan(admin, L.id, 'blocked');
    const ovBlokir = (await panggil('GET', '/api/admin/affiliate/overview', { token: admin })).data;
    await A.izinkan(admin, L.id, 'allowed');
    record('Affiliate aktif dihitung di antara yang berhak: memblokir affiliate aktif mengurangi keduanya, aktif tidak melebihi berhak',
      ovBlokir.active_affiliates === ovSemua.active_affiliates - 1 && ovBlokir.eligible_affiliates === ovSemua.eligible_affiliates - 1 && ovBlokir.active_affiliates <= ovBlokir.eligible_affiliates,
      `${ovSemua.active_affiliates}/${ovSemua.eligible_affiliates} menjadi ${ovBlokir.active_affiliates}/${ovBlokir.eligible_affiliates}`);
    await staff.goto(`${BASE_URL}/affiliate?tab=affiliate`, { waitUntil: 'networkidle' });
    await staff.getByLabel('Cari member').fill(L.email);
    await staff.waitForTimeout(900);
    await staff.locator('[data-tabel-anggota] tbody tr', { hasText: L.email }).getByRole('button', { name: 'Ubah' }).click();
    await staff.locator('[data-dialog-anggota]').waitFor({ timeout: 5000 });
    await staff.waitForTimeout(1200);
    const pilihanUpline = await staff.locator('#upline-member option').allInnerTexts();
    record('Dialog ubah member menawarkan upline dari semua member, bukan hanya hasil pencarian di tab', pilihanUpline.length > 3 && pilihanUpline.some((t) => t.includes(Af.name)) && !pilihanUpline.some((t) => t.includes(L.name)), `${pilihanUpline.length} pilihan`);
    await staff.keyboard.press('Escape');
    await staff.setViewportSize({ width: 1024, height: 900 });
    await staff.goto(`${BASE_URL}/affiliate?tab=komisi`, { waitUntil: 'networkidle' });
    await staff.locator('[data-kartu-komisi-admin]').waitFor({ timeout: 15000 }).catch(() => {});
    const jumlahKartu = await staff.locator('[data-kartu-komisi-admin] > li').count();
    await staff.getByLabel('Pilih semua').locator('visible=true').first().check();
    record('Tampilan kartu (1024px) punya Pilih semua yang memilih semua komisi yang tampil', jumlahKartu > 0 && (await staff.getByText(`${jumlahKartu} dipilih`).count()) === 1, `${jumlahKartu} kartu`);
    await staff.setViewportSize({ width: 1400, height: 1000 });

    // ---------- 14. Kasir tidak bisa membuka halaman admin affiliate ----------
    const emailKasir = `aff.kasir.${CAP}@contoh.id`;
    const kasir = await panggil('POST', '/api/admin/users', { token: admin, body: { email: emailKasir, password: 'rahasia123', full_name: 'Kasir Uji ' + CAP, role: 'cashier' } });
    idKasir = psql(`select id from public.app_users where lower(email) = '${emailKasir}'`);
    const ctxKasir = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const hk = await ctxKasir.newPage();
    trackApi(hk);
    await hk.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
    await hk.fill('input[type="email"]', emailKasir);
    await hk.fill('input[type="password"]', 'rahasia123');
    await hk.click('button[type="submit"]');
    await hk.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 }).catch(() => {});
    await waitForApiIdle(hk, { idleMs: 2500, minWaitMs: 1500 });
    const menuKasir = await hk.getByRole('link', { name: 'Affiliate', exact: true }).count();
    await hk.goto(BASE_URL + '/affiliate?tab=pengaturan', { waitUntil: 'networkidle' });
    await hk.waitForTimeout(1500);
    record('Kasir: menu Affiliate tidak tampil dan alamat /affiliate dialihkan (TC-7)',
      !!idKasir && kasir.status < 300 && menuKasir === 0 && new URL(hk.url()).pathname !== '/affiliate' && (await hk.locator('[data-affiliate-layar]').count()) === 0, `${kasir.status} ${hk.url()}`);
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    if (V1 && V2) psql(`update public.products set affiliate_if_bought = false where id in ('${V1}', '${V2}')`);
    if (idProdukForm) psql(`update public.products set affiliate_enabled = true, affiliate_if_bought = false, affiliate_commission = null where id = '${idProdukForm}'`);
    if (idKasir) await panggil('DELETE', `/api/admin/users/${idKasir}`, { token: admin }).catch(() => {});
    await browser.close();
  }
  ringkas();
})();
