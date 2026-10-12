// Aturan program affiliate (Sejoli) diuji langsung ke API dan basis data:
// cookie, atribusi (FR-19), komisi bertingkat (FR-21, FR-22), sinkron status
// oleh pemicu (FR-23), pembayaran (FR-26, FR-27), dan pengelolaan member (FR-48).
//
// Suite ini tidak membuka browser. Perjalanan pengguna di layar ada di
// verify_affiliate_flow.cjs.

const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const TEKS = {
  kode: 'Affiliasi tidak terdaftar di database',
  produk: 'Produk tidak terdaftar di database',
  mati: 'Produk ini sudah tidak diaffiliasikan lagi',
  izin: 'Link affiliasi ini tidak diperkenankan. Silahkan hubungi pemilik link affiliasi ini',
};

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const [P1, P2, P3] = A.produkUji(toko, 3);
  const mulaiSuite = psql('select now()::text');
  const dasar = {
    enabled: true,
    access_mode: 'approved',
    cookie_days: 30,
    general_cookie: true,
    permanent: false,
    commission: [{ type: 'percentage', value: 10 }, { type: 'percentage', value: 5 }],
    email_new_order: true,
    email_commission: true,
    email_paid: true,
  };
  const persen = (harga, qty, p) => Math.floor((harga * qty * p) / 100);
  const afiliasiPesanan = (id) => psql(`select coalesce(affiliate_id::text, '-') || '|' || coalesce(affiliate_source, '-') || '|' || coalesce(acquisition_source, '-') || '|' || coalesce(acquisition_media, '-') from public.orders where id = '${id}'`);

  try {
    await A.aturProgram(admin, dasar);

    // U = upline, A1 = affiliate di bawah U, B = affiliate lain.
    const U = await A.daftarPembeli(toko, CAP, 'u');
    const A1 = await A.daftarPembeli(toko, CAP, 'a');
    const B = await A.daftarPembeli(toko, CAP, 'b');
    for (const m of [U, A1, B]) await A.izinkan(admin, m.id);
    const naik = await panggil('PATCH', `/api/admin/affiliate/members/${A1.id}`, { token: admin, body: { referred_by: U.id } });
    record('Admin menjadikan U upline A', naik.status === 200 && psql(`select referred_by || '|' || referral_source from public.customers where id = '${A1.id}'`) === `${U.id}|admin`, naik.error || '');
    const kodeA = await A.kodeAffiliate(A1.token);
    const kodeB = await A.kodeAffiliate(B.token);
    const kodeU = await A.kodeAffiliate(U.token);
    record('Tiap affiliate mendapat kode unik (AC-9)', new Set([kodeA, kodeB, kodeU]).size === 3 && [kodeA, kodeB, kodeU].every((k) => /^[A-Z0-9]{4,20}$/.test(k || '')), [kodeA, kodeB, kodeU].join(' '));

    const Andi = await A.daftarPembeli(toko, CAP, 'andi', { name: 'Andi Saputra' });
    await A.izinkan(admin, Andi.id);
    const kodeAndi = await A.kodeAffiliate(Andi.token);
    record('Member bernama Andi Saputra mendapat kode ANDI diikuti angka (AC-9)', /^ANDI\d{2,4}$/.test(kodeAndi || ''), kodeAndi);

    // ---- Cookie ----------------------------------------------------------
    const k1 = await A.klik(toko, kodeA.toLowerCase(), { productId: P1.id, source: 'FB', media: 'grup crf/jatim' });
    record('Kode tidak peka huruf besar kecil dan klik memasang cookie', k1.status === 200 && k1.cookie.startsWith('gnnk_aff='), k1.error || '');
    record('Cookie HttpOnly, SameSite=Lax, Path=/, umur 30 hari (AC-6, NFR-4)',
      /HttpOnly/i.test(k1.setCookie) && /SameSite=Lax/i.test(k1.setCookie) && /Path=\//.test(k1.setCookie) && /Max-Age=2592000\b/.test(k1.setCookie) && !/;\s*Secure/i.test(k1.setCookie),
      k1.setCookie.replace(/gnnk_aff=[^;]+/, 'gnnk_aff=…'));
    const aman = await panggil('POST', '/api/public/affiliate/click', { headers: { 'X-Forwarded-Proto': 'https' }, body: { store_id: toko, code: kodeA } });
    record('Di belakang HTTPS cookie bertanda Secure', /;\s*Secure/i.test(aman.setCookie), aman.setCookie.replace(/gnnk_aff=[^;]+/, 'gnnk_aff=…'));
    const barisKlik = psql(`select source || '|' || media || '|' || kind from public.affiliate_clicks where affiliate_id = '${A1.id}' and product_id = '${P1.id}'`);
    record('Klik tercatat dengan parameter akuisisi yang dirapikan', barisKlik === 'fb|grup-crf-jatim|link', barisKlik);
    await A.aturProgram(admin, { cookie_days: 0 });
    const selamanya = await A.klik(toko, kodeA);
    record('Umur cookie 0 berarti selamanya, 10 tahun (AC-7)', /Max-Age=315360000\b/.test(selamanya.setCookie), (/Max-Age=\d+/.exec(selamanya.setCookie) || [''])[0]);
    await A.aturProgram(admin, { cookie_days: 30 });

    // ---- Pesan galat Sejoli ---------------------------------------------
    const g1 = await A.klik(toko, 'TIDAKADA' + CAP);
    record('Kode tak dikenal: pesan Sejoli (AC-14)', g1.status === 404 && g1.error === TEKS.kode && !g1.cookie, g1.error);
    const g2 = await A.klik(toko, kodeA, { productId: '00000000-0000-4000-8000-000000000000' });
    record('Produk tak dikenal: pesan Sejoli', g2.status === 404 && g2.error === TEKS.produk && !g2.cookie, g2.error);
    const g3 = await A.klik(toko, kodeA, { productId: 'bukan-uuid' });
    record('Id produk rusak diperlakukan sebagai produk tak dikenal', g3.status === 404 && g3.error === TEKS.produk, g3.error);
    const g4 = await A.klik('bukan-toko', kodeA);
    record('store_id rusak ditolak 400', g4.status === 400, String(g4.status));

    // ---- Atribusi dan komisi dua tier (AC-20, AC-26, AC-30) --------------
    const C1 = await A.daftarPembeli(toko, CAP, 'c1', { cookie: k1.cookie });
    record('Daftar dengan cookie: upline pembeli = A, sumber link (AC-19)', psql(`select referred_by || '|' || referral_source from public.customers where id = '${C1.id}'`) === `${A1.id}|link`);
    const o1 = await A.pesan(toko, C1, [{ product_id: P1.id, qty: 2 }], { cookie: k1.cookie });
    record('Pesanan tercatat atas A, sumber link, akuisisi dari klik (AC-20)', afiliasiPesanan(o1.id) === `${A1.id}|link|fb|grup-crf-jatim`, afiliasiPesanan(o1.id));
    const kom1 = A.komisiPesanan(o1.id);
    record('Tier 1 A 10% dan tier 2 U 5% dari nilai barang (AC-26, AC-30)',
      kom1.join(',') === `1:${A1.id}:${persen(P1.price, 2, 10)}:pending:false,2:${U.id}:${persen(P1.price, 2, 5)}:pending:false`, kom1.join(' | '));
    record('Antrean email order baru dibuat untuk pesanan itu', psql(`select count(*) from public.affiliate_outbox where kind = 'pesanan_baru' and ref_id = '${o1.id}'`) === '1');

    // ---- Beli lewat link sendiri (AC-21) ---------------------------------
    const klikSendiri = Number(psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${A1.id}'`));
    const sendiri = await A.klik(toko, kodeA, { productId: P1.id, token: A1.token });
    const oS = await A.pesan(toko, A1, [{ product_id: P1.id, qty: 1 }], { cookie: sendiri.cookie });
    record('Affiliate membeli lewat link sendiri: tanpa affiliate, tanpa komisi (AC-21)', afiliasiPesanan(oS.id).startsWith('-|') && A.komisiPesanan(oS.id).length === 0, afiliasiPesanan(oS.id));
    record('Klik atas link sendiri tidak menambah hitungan klik (AC-17)', Number(psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${A1.id}'`)) === klikSendiri);

    // ---- Akses dicabut setelah klik (AC-25) ------------------------------
    const kB = await A.klik(toko, kodeB, { productId: P1.id });
    await A.izinkan(admin, B.id, 'blocked');
    const C2 = await A.daftarPembeli(toko, CAP, 'c2');
    const o2 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: kB.cookie });
    record('Cookie dari affiliate yang aksesnya dicabut diabaikan (AC-25)', afiliasiPesanan(o2.id).startsWith('-|') && A.komisiPesanan(o2.id).length === 0, afiliasiPesanan(o2.id));
    const kBlokir = await A.klik(toko, kodeB);
    record('Link affiliate yang diblokir ditolak dengan pesan Sejoli', kBlokir.status === 403 && kBlokir.error === TEKS.izin, kBlokir.error);
    await A.izinkan(admin, B.id, 'allowed');

    // ---- General cookie (AC-24) dan klik terbaru per produk ---------------
    await A.aturProgram(admin, { general_cookie: false });
    const o3 = await A.pesan(toko, C2, [{ product_id: P2.id, qty: 1 }], { cookie: k1.cookie });
    record('General cookie mati, cookie untuk produk lain: tanpa affiliate (AC-24)', afiliasiPesanan(o3.id).startsWith('-|'), afiliasiPesanan(o3.id));
    const o4 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: k1.cookie });
    record('General cookie mati, cookie untuk produk yang dibeli: tercatat atas A', afiliasiPesanan(o4.id).startsWith(`${A1.id}|link`), afiliasiPesanan(o4.id));
    await A.aturProgram(admin, { general_cookie: true });
    const o5 = await A.pesan(toko, C2, [{ product_id: P2.id, qty: 1 }], { cookie: k1.cookie });
    record('General cookie nyala: produk lain pun tercatat atas A', afiliasiPesanan(o5.id).startsWith(`${A1.id}|link`), afiliasiPesanan(o5.id));
    const kTimpa = await A.klik(toko, kodeB, { productId: P1.id, cookie: k1.cookie });
    const o6 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: kTimpa.cookie });
    record('Klik terakhir atas produk yang sama menang (B menimpa A)', afiliasiPesanan(o6.id) === `${B.id}|link|-|-`, afiliasiPesanan(o6.id));
    const kDua = await A.klik(toko, kodeB, { productId: P2.id, cookie: k1.cookie });
    const o7 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }, { product_id: P2.id, qty: 1 }], { cookie: kDua.cookie });
    record('Keranjang berisi dua produk dari dua affiliate: klik terbaru (B) mendapat pesanan', afiliasiPesanan(o7.id).startsWith(`${B.id}|link`) && A.komisiPesanan(o7.id).every((x) => x.split(':')[1] === B.id) && A.komisiPesanan(o7.id).length === 2, afiliasiPesanan(o7.id) + ' ' + A.komisiPesanan(o7.id).length + ' komisi');

    // ---- Cookie palsu (AC-16) --------------------------------------------
    const [isi, tanda] = decodeURIComponent(k1.cookie.slice('gnnk_aff='.length)).split('.');
    const diubah = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(isi, 'base64url').toString()), g: B.id, p: [[P1.id, B.id]] })).toString('base64url');
    const o8 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: `gnnk_aff=${encodeURIComponent(`${diubah}.${tanda}`)}` });
    record('Cookie yang isinya diubah tangan diabaikan (AC-16)', afiliasiPesanan(o8.id).startsWith('-|'), afiliasiPesanan(o8.id));

    // ---- Kaitkan affiliasi (AC-22, AC-23) --------------------------------
    await A.aturProgram(admin, { permanent: true });
    const D = await A.daftarPembeli(toko, CAP, 'd');
    const o9 = await A.pesan(toko, D, [{ product_id: P1.id, qty: 1 }], { cookie: k1.cookie });
    record('Kaitkan affiliasi: pembeli tanpa upline mendapat upline A, sumber checkout (AC-23)',
      psql(`select referred_by || '|' || referral_source from public.customers where id = '${D.id}'`) === `${A1.id}|checkout` && afiliasiPesanan(o9.id).startsWith(`${A1.id}|link`));
    const o10 = await A.pesan(toko, D, [{ product_id: P1.id, qty: 1 }], { cookie: kTimpa.cookie });
    record('Kaitkan affiliasi: cookie B diabaikan, pesanan tetap atas upline A, sumber kaitan (AC-22)', afiliasiPesanan(o10.id) === `${A1.id}|kaitan|-|-`, afiliasiPesanan(o10.id));
    await A.aturProgram(admin, { permanent: false });
    const o11 = await A.pesan(toko, D, [{ product_id: P1.id, qty: 1 }], { cookie: kTimpa.cookie });
    record('Kaitkan affiliasi mati: cookie B kembali berlaku', afiliasiPesanan(o11.id).startsWith(`${B.id}|link`), afiliasiPesanan(o11.id));

    // ---- Pengaturan per produk (FR-10, AC-29) ----------------------------
    psql(`update public.products set affiliate_enabled = false where id = '${P3.id}'`);
    const m1 = await A.klik(toko, kodeA, { productId: P3.id });
    record('Link ke produk yang affiliasinya dimatikan: pesan Sejoli (FR-15)', m1.status === 403 && m1.error === TEKS.mati, m1.error);
    const satuMati = await panggil('GET', `/api/customer/affiliate/products?id=${P3.id}`, { token: A1.token });
    const semuaProduk = await panggil('GET', '/api/customer/affiliate/products', { token: A1.token });
    record('Produk yang affiliasinya mati tidak muncul di pembuat link (AC-11)', satuMati.data?.length === 0 && semuaProduk.data.length > 0 && !semuaProduk.data.some((p) => p.id === P3.id), `${semuaProduk.data?.length} produk`);
    const o12 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }, { product_id: P3.id, qty: 1 }], { cookie: k1.cookie });
    const kom12 = psql(`select string_agg(distinct product_id::text, ',') from public.affiliate_commissions where order_id = '${o12.id}'`);
    record('Barang yang affiliasinya mati tidak menghasilkan komisi, barang lain tetap', kom12 === P1.id, kom12);
    const o13 = await A.pesan(toko, C2, [{ product_id: P3.id, qty: 1 }], { cookie: k1.cookie });
    record('Pesanan yang hanya berisi barang tanpa affiliasi: tanpa affiliate', afiliasiPesanan(o13.id).startsWith('-|'), afiliasiPesanan(o13.id));
    psql(`update public.products set affiliate_enabled = true where id = '${P3.id}'`);

    psql(`update public.products set affiliate_if_bought = true where id = '${P3.id}'`);
    const s1 = await A.klik(toko, kodeB, { productId: P3.id });
    record('Syarat sudah membeli: affiliate yang belum membeli ditolak (AC-15)', s1.status === 403 && s1.error === TEKS.izin, s1.error);
    const beliB = await A.pesan(toko, B, [{ product_id: P3.id, qty: 1 }]);
    await A.konfirmasi(admin, beliB.id);
    const s2 = await A.klik(toko, kodeB, { productId: P3.id });
    record('Syarat sudah membeli: setelah pesanannya selesai link diterima', s2.status === 200 && !!s2.cookie, s2.error || '');
    const daftarProduk = await panggil('GET', `/api/customer/affiliate/products?id=${P3.id}`, { token: A1.token });
    record('Daftar produk affiliate menandai produk bersyarat tidak berhak bagi A', daftarProduk.data?.length === 1 && daftarProduk.data[0].eligible === false, JSON.stringify(daftarProduk.data));
    psql(`update public.products set affiliate_if_bought = false where id = '${P3.id}'`);

    psql(`update public.products set affiliate_commission = '[{"type":"fixed","value":5000}]'::jsonb where id = '${P2.id}'`);
    const kP2 = await A.klik(toko, kodeA, { productId: P2.id });
    const o14 = await A.pesan(toko, C2, [{ product_id: P2.id, qty: 3 }], { cookie: kP2.cookie });
    record('Komisi khusus produk: nilai tetap Rp 5.000 x 3, tanpa tier 2 (AC-28, AC-29)', A.komisiPesanan(o14.id).join(',') === `1:${A1.id}:15000:pending:false`, A.komisiPesanan(o14.id).join(' | '));
    psql(`update public.products set affiliate_commission = null where id = '${P2.id}'`);

    // ---- Rantai upline: dilewati, berputar (AC-31, D-17) ------------------
    await A.aturProgram(admin, { commission: [{ type: 'percentage', value: 10 }, { type: 'percentage', value: 5 }, { type: 'percentage', value: 2 }] });
    const G = await A.daftarPembeli(toko, CAP, 'g');
    await A.izinkan(admin, G.id);
    await panggil('PATCH', `/api/admin/affiliate/members/${U.id}`, { token: admin, body: { referred_by: G.id } });
    await A.izinkan(admin, U.id, 'blocked');
    const o15 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: k1.cookie });
    record('Upline tanpa akses dilewati, rantai lanjut ke tier 3 (D-17)',
      A.komisiPesanan(o15.id).join(',') === `1:${A1.id}:${persen(P1.price, 1, 10)}:pending:false,3:${G.id}:${persen(P1.price, 1, 2)}:pending:false`, A.komisiPesanan(o15.id).join(' | '));
    await A.izinkan(admin, U.id, 'allowed');
    const putar = await panggil('PATCH', `/api/admin/affiliate/members/${G.id}`, { token: admin, body: { referred_by: A1.id } });
    record('Admin tidak bisa membuat upline berputar (AC-41)', putar.status === 400 && /downline/.test(putar.error || ''), putar.error);
    const diri = await panggil('PATCH', `/api/admin/affiliate/members/${A1.id}`, { token: admin, body: { referred_by: A1.id } });
    record('Admin tidak bisa menjadikan member upline dirinya sendiri', diri.status === 400, diri.error);
    // Putaran dipaksa lewat SQL (data rusak): komisi tetap berhenti, tiap orang sekali.
    psql(`update public.customers set referred_by = '${A1.id}' where id = '${G.id}'`);
    const o16 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: k1.cookie });
    const penerima16 = A.komisiPesanan(o16.id).map((x) => x.split(':')[1]);
    record('Rantai upline yang berputar berhenti, tiap orang menerima sekali (AC-31)', penerima16.join(',') === [A1.id, U.id, G.id].join(','), penerima16.length + ' penerima');
    // G menerima komisi tier 3 tetapi belum pernah membuka dashboard, jadi belum punya kode.
    const ringkasAdmin = await panggil('GET', '/api/admin/affiliate/overview', { token: admin });
    const barisG = (ringkasAdmin.data?.affiliates || []).find((x) => x.id === G.id);
    record('Ringkasan admin menampilkan nama asli penerima komisi yang belum punya kode affiliate', !!barisG && barisG.name === G.name && barisG.code === null && barisG.commission_pending > 0, JSON.stringify(barisG || null).slice(0, 160));
    psql(`update public.customers set referred_by = null where id = '${G.id}'`);
    await A.aturProgram(admin, { commission: dasar.commission });

    // ---- Sinkron status oleh pemicu (AC-32 sampai AC-35) ------------------
    const konf = await A.konfirmasi(admin, o1.id, 15000);
    record('Konfirmasi pesanan: semua komisinya Belum dibayar (AC-32)', konf.status === 200 && A.komisiPesanan(o1.id).every((x) => x.endsWith(':added:false')), A.komisiPesanan(o1.id).join(' | '));
    record('Tiap komisi yang masuk membuat satu baris antrean email', psql(`select count(*) from public.affiliate_outbox where kind = 'komisi_masuk' and ref_id in (select id from public.affiliate_commissions where order_id = '${o1.id}')`) === '2');
    record('Ongkir saat konfirmasi tidak mengubah komisi', A.komisiPesanan(o1.id)[0].split(':')[2] === String(persen(P1.price, 2, 10)));
    const tolakan = await A.tolak(admin, o4.id);
    record('Pesanan ditolak: komisinya Dibatalkan (AC-33)', tolakan.status === 200 && A.komisiPesanan(o4.id).every((x) => x.includes(':cancelled:')), A.komisiPesanan(o4.id).join(' | '));
    psql(`update public.orders set order_status = 'canceled' where id = '${o1.id}'`);
    record('Status pesanan diubah dari jalur lain (SQL): pemicu ikut membatalkan komisi', A.komisiPesanan(o1.id).every((x) => x.includes(':cancelled:')));
    psql(`update public.orders set order_status = 'done' where id = '${o1.id}'`);
    record('Pesanan selesai lagi: komisi kembali Belum dibayar', A.komisiPesanan(o1.id).every((x) => x.endsWith(':added:false')));
    psql(`update public.orders set order_status = 'pending' where id = '${o1.id}'`);
    record('Status selain selesai dan batal: komisi Order belum selesai (D-7)', A.komisiPesanan(o1.id).every((x) => x.includes(':pending:')));
    psql(`update public.orders set order_status = 'done' where id = '${o1.id}'`);

    // ---- Pembayaran (AC-36, AC-37) dan aksi massal (AC-38) ----------------
    await A.konfirmasi(admin, o5.id);
    const belumA = Number(psql(`select coalesce(sum(commission), 0) from public.affiliate_commissions where affiliate_id = '${A1.id}' and status = 'added' and not paid`));
    const ringkas0 = await panggil('GET', '/api/admin/affiliate/payouts/summary', { token: admin });
    const barisA = ringkas0.data?.find((x) => x.affiliate_id === A1.id);
    record('Data komisi per affiliasi: Belum dibayar A cocok dengan basis data', barisA && barisA.unpaid === belumA && belumA > 0, `${barisA?.unpaid} vs ${belumA}`);
    const [b1, b2] = await Promise.all([
      panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: A1.id, record_expense: true, note: 'uji bersamaan' } }),
      panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: A1.id, record_expense: true, note: 'uji bersamaan' } }),
    ]);
    const kode2 = [b1.status, b2.status].sort().join(',');
    const dibayar = Number(psql(`select coalesce(sum(amount), 0) from public.affiliate_payouts where affiliate_id = '${A1.id}'`));
    record('Dua pembayaran bersamaan: satu berhasil, satu ditolak 409, tidak dobel (AC-37)', kode2 === '200,409' && dibayar === belumA, `${kode2}, dibayar ${dibayar} dari ${belumA}`);
    const bayar = b1.status === 200 ? b1 : b2;
    record('Pembayaran mencatat pengeluaran Komisi Affiliate sebesar jumlahnya (AC-36)',
      psql(`select category || '|' || trunc(amount) || '|' || payment_method from public.expenses where id = '${bayar.data.expense_id}'`) === `komisi_affiliate|${belumA}|transfer`);
    record('Komisi yang dibayar bertanda paid dan menunjuk pembayarannya', psql(`select count(*) from public.affiliate_commissions where payout_id = '${bayar.data.id}' and paid and paid_at is not null`) === String(bayar.data.commission_count));
    record('Antrean email komisi dibayar dibuat', psql(`select count(*) from public.affiliate_outbox where kind = 'komisi_dibayar' and ref_id = '${bayar.data.id}'`) === '1');

    psql(`update public.orders set order_status = 'canceled' where id = '${o5.id}'`);
    const susulan = await panggil('GET', '/api/admin/affiliate/commissions?followup=true', { token: admin });
    record('Komisi sudah dibayar lalu pesanannya batal: muncul di daftar perlu ditindaklanjuti (AC-38)', (susulan.data || []).some((x) => x.order_id === o5.id && x.status === 'cancelled' && x.paid), String((susulan.data || []).length));
    psql(`update public.orders set order_status = 'done' where id = '${o5.id}'`);

    const idKomisiO1 = psql(`select string_agg(id::text, ',') from public.affiliate_commissions where order_id = '${o1.id}' and affiliate_id = '${A1.id}'`).split(',');
    const nilaiO1 = persen(P1.price, 2, 10);
    const lepas = await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: idKomisiO1, action: 'mark_unpaid' } });
    const sisa = psql(`select trunc(p.amount) || '|' || p.commission_count || '|' || trunc(e.amount) from public.affiliate_payouts p join public.expenses e on e.id = p.expense_id where p.id = '${bayar.data.id}'`);
    record('Batal bayar sebagian: pembayaran dan pengeluarannya ikut berkurang', lepas.data?.updated === 1 && sisa === `${belumA - nilaiO1}|${bayar.data.commission_count - 1}|${belumA - nilaiO1}`, sisa);
    const semuaId = psql(`select string_agg(id::text, ',') from public.affiliate_commissions where payout_id = '${bayar.data.id}'`).split(',');
    const lepasSemua = await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: semuaId, action: 'mark_unpaid' } });
    record('Batal bayar seluruhnya: pembayaran dan pengeluarannya dihapus',
      lepasSemua.status === 200 && psql(`select count(*) from public.affiliate_payouts where id = '${bayar.data.id}'`) === '0' && psql(`select count(*) from public.expenses where id = '${bayar.data.expense_id}'`) === '0',
      `${lepasSemua.status} ${lepasSemua.error || ''}`);
    record('Setelah batal bayar seluruhnya tidak ada komisi A yang masih bertanda dibayar',
      psql(`select count(*) from public.affiliate_commissions where affiliate_id = '${A1.id}' and paid`) === '0');
    const idDua = psql(`select string_agg(id::text, ',') from public.affiliate_commissions where order_id = '${o1.id}'`).split(',');
    const tandai = await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: idDua, action: 'mark_paid' } });
    record('Konfirmasi massal: satu pembayaran per affiliate, tanpa pengeluaran (AC-35)',
      tandai.data?.updated === 2 && psql(`select count(*) || '|' || count(expense_id) from public.affiliate_payouts where id in (select payout_id from public.affiliate_commissions where order_id = '${o1.id}')`) === '2|0');
    const tanpaPilih = await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: [], action: 'mark_paid' } });
    record('Aksi massal tanpa pilihan: pesan Sejoli', tanpaPilih.status === 400 && tanpaPilih.error === 'Anda belum memilih komisi', tanpaPilih.error);
    const menunggu = psql(`select id from public.affiliate_commissions where order_id = '${o9.id}' limit 1`);
    const belumSelesai = await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: [menunggu], action: 'mark_paid' } });
    record('Komisi yang ordernya belum selesai tidak bisa ditandai dibayar', belumSelesai.data?.updated === 0 && psql(`select paid from public.affiliate_commissions where id = '${menunggu}'`) === 'f');
    const buktiSalah = await panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: A1.id, proof_image: 'data:text/html;base64,PGI+' } });
    record('Bukti transfer selain gambar ditolak', buktiSalah.status === 400 && /gambar/.test(buktiSalah.error || ''), buktiSalah.error);

    // ---- Kode affiliate (FR-48) ------------------------------------------
    const kembar = await panggil('PATCH', `/api/admin/affiliate/members/${B.id}`, { token: admin, body: { code: kodeA } });
    record('Kode yang sudah dipakai ditolak 409', kembar.status === 409 && kembar.error === 'Kode ini sudah dipakai affiliate lain.', kembar.error);
    const kecil = await panggil('PATCH', `/api/admin/affiliate/members/${B.id}`, { token: admin, body: { code: kodeA.toLowerCase() } });
    record('Kode yang sama dengan huruf kecil tetap dianggap kembar', kecil.status === 409, String(kecil.status));
    const rusak = await panggil('PATCH', `/api/admin/affiliate/members/${B.id}`, { token: admin, body: { code: 'ab c' } });
    record('Kode berformat salah ditolak 400', rusak.status === 400, rusak.error);
    const baru = `UJI${CAP}`;
    const ganti = await panggil('PATCH', `/api/admin/affiliate/members/${B.id}`, { token: admin, body: { code: baru } });
    const lama = await A.klik(toko, kodeB);
    const kini = await A.klik(toko, baru);
    record('Ganti kode: link lama berhenti, link baru berfungsi (FR-48)', ganti.status === 200 && lama.status === 404 && kini.status === 200, `${lama.status} ${kini.status}`);

    // ---- Jaringan: kedalaman (AC-39) --------------------------------------
    await A.izinkan(admin, C1.id);
    const kodeC1 = await A.kodeAffiliate(C1.token);
    const Cucu = await A.daftarPembeli(toko, CAP, 'cucu', { cookie: (await A.klik(toko, kodeC1)).cookie });
    await A.aturProgram(admin, { downline_depth: 1 });
    const j1 = (await panggil('GET', '/api/customer/affiliate/network', { token: A1.token })).data.nodes;
    await A.aturProgram(admin, { downline_depth: 2 });
    const j2 = (await panggil('GET', '/api/customer/affiliate/network', { token: A1.token })).data.nodes;
    const cucu2 = j2.find((n) => n.id === Cucu.id);
    record('Kedalaman jaringan 1: hanya downline langsung. Kedalaman 2: cucu tampil di bawah induknya (AC-39)',
      j1.some((n) => n.id === C1.id) && !j1.some((n) => n.id === Cucu.id) && j1.every((n) => n.depth === 1) && !!cucu2 && cucu2.depth === 2 && cucu2.parent_id === C1.id,
      `kedalaman 1: ${j1.length} node, kedalaman 2: ${j2.length} node`);

    // ---- Jaringan member di sisi admin: kedua kedalaman dari pengaturan (AC-69) ----
    // Sejoli membatasi tampilan itu dengan kedalaman upline dan downline yang sama.
    const jaringanAdmin = async (id) => (await panggil('GET', `/api/admin/affiliate/members/${id}/network`, { token: admin })).data;
    await A.aturProgram(admin, { upline_depth: 1, downline_depth: 1 });
    const atas1 = (await jaringanAdmin(Cucu.id)).uplines.map((u) => u.id);
    const bawah1 = (await jaringanAdmin(A1.id)).nodes;
    await A.aturProgram(admin, { upline_depth: 2, downline_depth: 2 });
    const atas2 = (await jaringanAdmin(Cucu.id)).uplines.map((u) => u.id);
    const bawah2 = (await jaringanAdmin(A1.id)).nodes;
    record('Jaringan member di admin mengikuti pengaturan: upline 1 lalu 2 tingkat, downline 1 lalu 2 tingkat (AC-69)',
      atas1.join(',') === C1.id && atas2.join(',') === `${C1.id},${A1.id}`
        && bawah1.some((n) => n.id === C1.id) && bawah1.every((n) => n.depth === 1) && bawah2.some((n) => n.id === Cucu.id && n.depth === 2),
      `upline ${atas1.length} lalu ${atas2.length}; downline terdalam ${Math.max(0, ...bawah1.map((n) => n.depth))} lalu ${Math.max(0, ...bawah2.map((n) => n.depth))}`);
    await A.aturProgram(admin, { upline_depth: 1, downline_depth: 1 });

    // ---- Angka: ringkasan dan data akuisisi (AC-47, AC-48, AC-50) ---------
    const Q = await A.daftarPembeli(toko, CAP, 'q');
    await A.izinkan(admin, Q.id);
    const kodeQ = await A.kodeAffiliate(Q.token);
    await A.klik(toko, kodeQ, { source: 'fb', media: 'story-okt' });
    await A.klik(toko, kodeQ, { source: 'fb', media: 'story-okt' });
    const kQ = await A.klik(toko, kodeQ);
    const akq = (await panggil('GET', '/api/customer/affiliate/acquisition', { token: Q.token })).data;
    const barisFb = akq.find((r) => r.source === 'fb' && r.media === 'story-okt');
    const barisLangsung = akq.find((r) => r.source === '');
    record('Data akuisisi: Facebook story-okt View 2 dan Langsung View 1 (AC-48)', akq.length === 2 && barisFb?.views === 2 && barisFb.label === 'Facebook' && barisLangsung?.views === 1 && barisLangsung.label === 'Langsung', JSON.stringify(akq));
    const Rb = await A.daftarPembeli(toko, CAP, 'r', { cookie: kQ.cookie });
    const oq1 = await A.pesan(toko, Rb, [{ product_id: P1.id, qty: 1 }], { cookie: kQ.cookie });
    await A.pesan(toko, Rb, [{ product_id: P1.id, qty: 1 }], { cookie: kQ.cookie });
    await A.konfirmasi(admin, oq1.id);
    const rq = (await panggil('GET', '/api/customer/affiliate', { token: Q.token })).data.summary;
    record('Ringkasan affiliate: Klik 3, Lead 2, Sales 1, Omset nilai barang, Komisi 10%, sama di hari ini, bulan ini, dan semua (AC-47)',
      ['today', 'month', 'all'].every((p) => rq[p].clicks === 3 && rq[p].leads === 2 && rq[p].sales === 1 && rq[p].omset === P1.price && rq[p].commission === persen(P1.price, 1, 10)), JSON.stringify(rq.all));
    const hariIni = psql(`select (now() at time zone 'Asia/Jakarta')::date::text`);
    const kemarin = psql(`select ((now() at time zone 'Asia/Jakarta')::date - 1)::text`);
    const ambilQ = async (bagian, kueri) => (await panggil('GET', `/api/customer/affiliate/${bagian}${kueri}`, { token: Q.token })).data;
    const orderLama = await ambilQ('orders', `?to=${kemarin}`);
    const orderKini = await ambilQ('orders', `?from=${hariIni}&to=${hariIni}`);
    const komisiLama = await ambilQ('commissions', `?to=${kemarin}`);
    const komisiKini = await ambilQ('commissions', `?from=${hariIni}`);
    record('Daftar order dan komisi affiliate mengikuti rentang tanggal, total komisi tetap menghitung semuanya (FR-24, FR-40)',
      orderLama.length === 0 && orderKini.length === 2 && komisiLama.rows.length === 0 && komisiKini.rows.length === 2
        && komisiLama.totals.unpaid === persen(P1.price, 1, 10) && komisiLama.totals.pending === persen(P1.price, 1, 10),
      `order ${orderLama.length}/${orderKini.length}, komisi ${komisiLama.rows.length}/${komisiKini.rows.length}, total ${JSON.stringify(komisiLama.totals)}`);
    const tanggalRusak = await ambilQ('orders', '?from=bukan-tanggal&to=2026-13-99x');
    record('Tanggal yang rusak di alamat diabaikan, bukan galat', Array.isArray(tanggalRusak) && tanggalRusak.length === 2, JSON.stringify(tanggalRusak).slice(0, 80));
    const ovAdmin =(await panggil('GET', `/api/admin/affiliate/overview?from=${hariIni}&to=${hariIni}`, { token: admin })).data.totals;
    const wib = (kolom) => `(${kolom} at time zone 'Asia/Jakarta')::date = '${hariIni}'`;
    const sqlAdmin = psql(`select
        (select count(*) from public.affiliate_clicks where store_id = '${toko}' and ${wib('created_at')}) || '|' ||
        (select count(*) filter (where order_status <> 'canceled') || '|' || count(*) filter (where order_status = 'done') || '|' || coalesce(sum(subtotal - discount) filter (where order_status = 'done'), 0)::bigint
           from public.orders where store_id = '${toko}' and affiliate_id is not null and ${wib('created_at')}) || '|' ||
        (select coalesce(sum(commission) filter (where status = 'pending'), 0)::bigint || '|' || coalesce(sum(commission) filter (where status = 'added' and not paid), 0)::bigint || '|' || coalesce(sum(commission) filter (where status = 'added' and paid), 0)::bigint
           from public.affiliate_commissions where store_id = '${toko}' and ${wib('created_at')})`);
    const layarAdmin = [ovAdmin.clicks, ovAdmin.leads, ovAdmin.sales, Math.round(ovAdmin.omset), Math.round(ovAdmin.pending), Math.round(ovAdmin.unpaid), Math.round(ovAdmin.paid)].join('|');
    record('Ringkasan admin untuk rentang hari ini sama dengan hasil query basis data (AC-50)', layarAdmin === sqlAdmin, `${layarAdmin} vs ${sqlAdmin}`);

    // ---- Mode Semua member dan pesan akses (AC-4, AC-5) -------------------
    const pesanBaru = 'Hubungi admin toko untuk menjadi affiliate.';
    await A.aturProgram(admin, { access_mode: 'all', no_access_text: pesanBaru });
    const N = await A.daftarPembeli(toko, CAP, 'n');
    const sayaN = await panggil('GET', '/api/customer/affiliate', { token: N.token });
    record('Mode Semua member: member baru langsung berhak dan mendapat kode (FR-2)', sayaN.data?.eligible === true && /^[A-Z0-9]{4,20}$/.test(sayaN.data.profile?.code || ''), sayaN.data?.profile?.code);
    await A.izinkan(admin, N.id, 'blocked');
    const blokN = await panggil('GET', '/api/customer/affiliate', { token: N.token });
    const blokOrder = await panggil('GET', '/api/customer/affiliate/orders', { token: N.token });
    record('Mode Semua member: member Diblokir ditolak dengan pesan akses yang baru diubah admin (AC-4, AC-5)',
      blokN.data?.eligible === false && blokN.data.reason === 'blocked' && blokN.data.message === pesanBaru && blokOrder.status === 403 && blokOrder.error === pesanBaru, `${blokN.data?.message} / ${blokOrder.error}`);
    await A.aturProgram(admin, { access_mode: 'approved', no_access_text: 'Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.' });

    // ---- Program dimatikan (AC-1, AC-2) ----------------------------------
    await A.aturProgram(admin, { enabled: false });
    const klikSebelumMati = psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${A1.id}'`);
    const mati = await A.klik(toko, kodeA, { productId: P1.id });
    record('Program mati: membuka link tidak mencatat klik (AC-1)', psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${A1.id}'`) === klikSebelumMati, klikSebelumMati);
    record('Program mati: link tetap membawa ke produk tanpa cookie (AC-1)', mati.status === 200 && mati.data?.redirect === `/toko/produk?id=${P1.id}` && !mati.cookie, mati.setCookie);
    const o17 = await A.pesan(toko, C2, [{ product_id: P1.id, qty: 1 }], { cookie: k1.cookie });
    record('Program mati: cookie lama tidak menghasilkan affiliate', afiliasiPesanan(o17.id).startsWith('-|'), afiliasiPesanan(o17.id));
    await A.konfirmasi(admin, o11.id);
    const bayarMati = await panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: B.id, record_expense: false } });
    record('Program mati: komisi Belum dibayar tetap bisa dibayar admin (AC-2)', bayarMati.status === 200 && bayarMati.data?.amount > 0, `${bayarMati.status} ${bayarMati.error || bayarMati.data?.amount}`);
    const saya = await panggil('GET', '/api/customer/affiliate', { token: A1.token });
    record('Program mati: dashboard affiliate menjawab program_off tanpa data', saya.data?.eligible === false && saya.data.reason === 'program_off' && !saya.data.summary);
    await A.aturProgram(admin, { enabled: true });

    // ---- Validasi pengaturan (AC-8) --------------------------------------
    const kiniS = (await panggil('GET', '/api/admin/affiliate/settings', { token: admin })).data;
    const tolakS = async (ubah, pesan) => {
      const r = await panggil('PUT', '/api/admin/affiliate/settings', { token: admin, body: { ...kiniS, ...ubah } });
      return r.status === 400 && r.error === pesan ? '' : `${r.status} ${r.error}`;
    };
    const galatS = [
      await tolakS({ commission: [{ type: 'percentage', value: 101 }] }, 'Persentase komisi harus 0 sampai 100.'),
      await tolakS({ cookie_days: 4000 }, 'Umur cookie harus 0 sampai 3.650 hari.'),
      await tolakS({ platforms: 'fb;Facebook\nsalah baris' }, 'Baris platform ke-2 tidak sah. Gunakan format kode;Nama.'),
      await tolakS({ admin_copy_emails: 'benar@contoh.id, salah' }, 'Alamat salinan email tidak valid: salah'),
    ].filter(Boolean);
    record('Pengaturan tidak sah ditolak dengan pesan PRD (AC-8)', galatS.length === 0, galatS.join(' ; '));
    record('Pengaturan yang ditolak tidak tersimpan', psql(`select affiliate_settings->>'cookie_days' from public.stores where id = '${toko}'`) === '30');

    // ---- Log audit (NFR-10) -----------------------------------------------
    const audit = psql(`select string_agg(distinct action, ',' order by action) from public.admin_audit_logs where store_id = '${toko}' and action like 'affiliate.%' and created_at >= '${mulaiSuite}'`);
    record('Pengaturan, perubahan member, pembayaran, dan batal bayar tercatat di log audit admin (NFR-10)', audit === 'affiliate.member,affiliate.payout,affiliate.settings,affiliate.unpay', audit);
    const auditMember = psql(`select count(*) from public.admin_audit_logs where store_id = '${toko}' and action = 'affiliate.member' and target_id = '${B.id}' and metadata->>'affiliate_code' = '${baru}' and created_at >= '${mulaiSuite}'`);
    record('Log audit menyimpan kode baru yang diberikan admin ke member', auditMember === '1', auditMember);

    // ---- Pembatas laju, dari IP palsu supaya tidak meracuni suite lain ----
    const ipUji = `203.0.113.${Number(CAP) % 250}`;
    let terakhir = null;
    for (let i = 0; i < 61; i += 1) terakhir = await A.klik(toko, 'TIDAKADA', { ip: ipUji });
    record('Klik ke-61 dalam semenit dari IP yang sama ditolak 429', terakhir.status === 429, String(terakhir.status));
    const ipLain = await A.klik(toko, kodeA);
    record('IP lain tidak ikut terbatasi', ipLain.status === 200, String(ipLain.status));
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    psql(`update public.products set affiliate_enabled = true, affiliate_if_bought = false, affiliate_commission = null where id in ('${P1.id}', '${P2.id}', '${P3.id}')`);
  }
  ringkas();
})();
