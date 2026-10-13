// Jawaban klien 13 Okt 2026 (PRD bagian 14, spesifikasi 0002): tarif per
// affiliate, undangan khusus admin, kontak terkunci, minimal pencairan,
// undangan tanpa batas harian, retur memotong komisi, potongan dari pembayaran
// berikutnya, bonus target bulanan, omset bersih retur.
//
// Semua akun berakhiran @contoh.id (email dilewati pengirim). Data putaran ini
// dihapus di akhir lewat bersihkanUji.

const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (token, body) => panggil('POST', '/api/query', { token, body: { columns: '*', filters: [], orderBy: null, limit: null, payload: null, returning: false, single: false, maybeSingle: false, ...body } });
const komisiDari = (orderId) => psql(`select coalesce(string_agg(trunc(commission) || '/' || trunc(coalesce(commission_awal, commission)) || ':' || status || ':' || paid, ',' order by tier, commission desc), '-') from public.affiliate_commissions where order_id = '${orderId}'`);
const potonganDari = (orderId) => psql(`select coalesce(string_agg(p.jenis || '=' || trunc(p.amount) || ':' || (p.payout_id is not null), ',' order by p.jenis), '-') from public.affiliate_potongan p join public.affiliate_commissions k on k.id = p.commission_id where k.order_id = '${orderId}'`);

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const [P1, P2] = A.produkUji(toko, 2);
  const komisiP2Asli = psql(`select coalesce(affiliate_commission::text, 'null') from public.products where id = '${P2.id}'`);

  /** Retur lewat jalur layar Retur: dua insert lewat /api/query. */
  const retur = async (order, productId, qty, nilai) => {
    const id = psql('select gen_random_uuid()');
    const head = await q(admin, { table: 'order_returns', action: 'insert', payload: { id, store_id: toko, order_id: order.id, order_number: order.number, refund_amount: nilai, reason: 'Uji retur affiliate' } });
    const item = await q(admin, { table: 'order_return_items', action: 'insert', payload: { id: psql('select gen_random_uuid()'), return_id: id, product_id: productId, name: 'Barang uji', qty, refund_price: nilai / qty, restock: false } });
    if (head.status >= 300 || item.status >= 300) throw new Error(`Retur gagal: ${head.error || ''} ${item.error || ''}`);
    return id;
  };
  const bayar = (affiliateId, extra = {}) => panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: affiliateId, note: 'Uji', ...extra } });

  try {
    await A.aturProgram(admin, {
      enabled: true, access_mode: 'approved', general_cookie: true, permanent: false, cookie_days: 30,
      commission: [{ type: 'percentage', value: 10 }], invite_days: 7, invite_daily_limit: 0, payout_minimum: 0,
      bonus_enabled: false, bonus_target: 5_000_000, bonus_type: 'percentage', bonus_value: 0,
    });
    const Af = await A.daftarPembeli(toko, CAP, 'a');
    const Ag = await A.daftarPembeli(toko, CAP, 'g');
    await A.izinkan(admin, Af.id);
    await A.izinkan(admin, Ag.id);
    const kodeA = await A.kodeAffiliate(Af.token);
    const kodeG = await A.kodeAffiliate(Ag.token);
    const C = await A.daftarPembeli(toko, CAP, 'c');
    const kA = await A.klik(toko, kodeA);
    const kG = await A.klik(toko, kodeG);

    // ---------- AC-70: tarif per affiliate, urutan sumber tarif (D-31) ----------
    const dua = await panggil('PATCH', `/api/admin/affiliate/members/${Af.id}`, { token: admin, body: { commission: [{ type: 'percentage', value: 5 }, { type: 'percentage', value: 1 }] } });
    const ubahTarif = await panggil('PATCH', `/api/admin/affiliate/members/${Af.id}`, { token: admin, body: { commission: [{ type: 'percentage', value: 15 }] } });
    psql(`update public.products set affiliate_commission = '[{"type":"fixed","value":5000}]'::jsonb where id = '${P2.id}'`);
    const o70 = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }, { product_id: P2.id, qty: 1 }], { cookie: kA.cookie });
    const o70g = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kG.cookie });
    const harap70 = [Math.floor(P1.price * 0.15), 5000].sort((a, b) => b - a).map((n) => `${n}/${n}:pending:false`).join(',');
    record('Tarif affiliate 15%: produk biasa 15%, produk berkomisi khusus tetap Rp 5.000; affiliate tanpa tarif memakai 10% (AC-70)',
      dua.status === 400 && dua.error === 'Tarif affiliate hanya satu tier.' && ubahTarif.status === 200
        && komisiDari(o70.id) === harap70 && komisiDari(o70g.id) === `${Math.floor(P1.price * 0.1)}/${Math.floor(P1.price * 0.1)}:pending:false`,
      `${komisiDari(o70.id)} | ${komisiDari(o70g.id)}`);
    const me70 = (await panggil('GET', '/api/customer/affiliate', { token: Af.token })).data;
    record('Dashboard affiliate menyebut tarifnya sendiri', JSON.stringify(me70.profile.commission) === JSON.stringify([{ type: 'percentage', value: 15 }]), JSON.stringify(me70.profile.commission));
    psql(`update public.products set affiliate_commission = ${komisiP2Asli === 'null' ? 'null' : `$j$${komisiP2Asli}$j$::jsonb`} where id = '${P2.id}'`);

    // ---------- AC-71, AC-72: undangan khusus admin (D-32) ----------
    const emailInv1 = `aff.inv1.${CAP}@contoh.id`;
    const inv1 = await panggil('POST', '/api/admin/affiliate/invitations', { token: admin, body: { email: emailInv1, name: 'Calon Affiliate', commission: [{ type: 'percentage', value: 10 }] } });
    const ganda = await panggil('POST', '/api/admin/affiliate/invitations', { token: admin, body: { email: emailInv1 } });
    const anggotaLama = await panggil('POST', '/api/admin/affiliate/invitations', { token: admin, body: { email: Af.email } });
    const token1 = `tokenuji${CAP}inv1`;
    psql(`update public.affiliate_invitations set token_hash = '${A.sha256(token1)}' where id = '${inv1.data?.id}'`);
    const buka1 = await panggil('POST', '/api/public/affiliate/invitation', { body: { store_id: toko, token: token1 }, ip: A.ipUji() });
    const I1 = await A.daftarPembeli(toko, CAP, 'inv1', { cookie: buka1.cookie || undefined });
    const baris1 = psql(`select affiliate_access || '|' || coalesce(affiliate_commission::text, '-') || '|' || coalesce(referred_by::text, '-') from public.customers where id = '${I1.id}'`);
    const status1 = psql(`select status || '|' || coalesce(registered_customer_id::text, '-') from public.affiliate_invitations where id = '${inv1.data?.id}'`);
    const me71 = (await panggil('GET', '/api/customer/affiliate', { token: I1.token })).data;
    record('Undangan admin: tersimpan sebagai undangan admin bertarif, email sama dan anggota ditolak 409',
      inv1.status === 200 && inv1.data.commission?.[0]?.value === 10 && ganda.status === 409 && ganda.error === 'Email ini sudah diundang dalam 24 jam terakhir.'
        && anggotaLama.status === 409 && anggotaLama.error === 'Email ini sudah terdaftar sebagai member. Ubah aksesnya di daftar Affiliate.',
      `${inv1.status} ${ganda.status} ${anggotaLama.status}`);
    record('Membuka undangan admin membawa ke daftar dengan email terisi, tanpa cookie affiliate',
      buka1.status === 200 && buka1.data?.redirect === `/toko/masuk?tab=daftar&email=${encodeURIComponent(emailInv1)}` && !buka1.cookie, `${buka1.data?.redirect} cookie=${!!buka1.cookie}`);
    record('Pendaftar undangan admin langsung Diizinkan, bertarif 10%, tanpa upline, undangan Terdaftar, dashboard terbuka (AC-71)',
      baris1 === 'allowed|[{"type": "percentage", "value": 10}]|-' && status1 === `registered|${I1.id}` && me71?.eligible === true && !!me71.profile.code,
      `${baris1} | ${status1} | eligible=${me71?.eligible}`);
    const emailInv2 = `aff.inv2.${CAP}@contoh.id`;
    await panggil('POST', '/api/admin/affiliate/invitations', { token: admin, body: { email: emailInv2 } });
    const I2 = await A.daftarPembeli(toko, CAP, 'inv2');
    record('Mendaftar dengan email yang diundang admin tanpa membuka tautan: Diizinkan, tarif ikut bawaan (AC-72)',
      psql(`select affiliate_access || '|' || coalesce(affiliate_commission::text, '-') from public.customers where id = '${I2.id}'`) === 'allowed|-',
      psql(`select affiliate_access from public.customers where id = '${I2.id}'`));
    const daftarAdmin = (await panggil('GET', '/api/admin/affiliate/invitations', { token: admin })).data || [];
    record('Daftar undangan admin memuat kedua undangan berstatus Terdaftar dengan nama pendaftarnya',
      [emailInv1, emailInv2].every((e) => daftarAdmin.some((u) => u.email === e && u.status === 'registered' && u.registered_name)), `${daftarAdmin.length} undangan`);

    // ---------- AC-73: undangan dari affiliate hanya membentuk jaringan ----------
    const emailTeman = `aff.teman.${CAP}@contoh.id`;
    await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailTeman } });
    const T = await A.daftarPembeli(toko, CAP, 'teman');
    const meT = (await panggil('GET', '/api/customer/affiliate', { token: T.token })).data;
    record('Teman yang diundang affiliate menjadi downline-nya tetapi tidak menjadi affiliate (AC-73)',
      psql(`select coalesce(referred_by::text, '-') || '|' || affiliate_access from public.customers where id = '${T.id}'`) === `${Af.id}|default` && meT?.eligible === false && meT?.reason === 'no_access',
      `${psql(`select coalesce(referred_by::text, '-') || '|' || affiliate_access from public.customers where id = '${T.id}'`)} eligible=${meT?.eligible}`);

    // ---------- AC-74: kontak tidak pernah dikirim (D-33) ----------
    psql(`update public.stores set affiliate_settings = affiliate_settings || '{"show_buyer_contact": true, "show_downline_contact": true}'::jsonb where id = '${toko}'`);
    const ordA = await panggil('GET', '/api/customer/affiliate/orders', { token: Af.token });
    const netA = await panggil('GET', '/api/customer/affiliate/network', { token: Af.token });
    const teksKontak = JSON.stringify([ordA.data, netA.data]);
    record('Pengaturan lama berisi saklar kontak menyala: order dan jaringan affiliate tetap tanpa HP dan email (AC-74)',
      ordA.status === 200 && netA.status === 200 && !/buyer_phone|buyer_email|"phone"|"email"/.test(teksKontak) && !teksKontak.includes(C.email) && !teksKontak.includes(T.email),
      `${ordA.data?.length} order, ${netA.data?.nodes?.length} node`);

    // ---------- AC-76: undangan tanpa batas harian (D-35) ----------
    psql(`insert into public.affiliate_invitations (store_id, affiliate_id, email, token_hash, expires_at)
          select '${toko}', '${Af.id}', 'aff.kuota' || g || '.${CAP}@contoh.id', md5(random()::text || g), now() + interval '7 days' from generate_series(1, 20) g`);
    const ke21 = await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: `aff.kuota21.${CAP}@contoh.id` } });
    const kuota = (await panggil('GET', '/api/customer/affiliate/invitations', { token: Af.token })).data;
    record('Batas harian 0: undangan ke-22 hari ini tetap diterima (AC-76)', ke21.status === 200 && kuota.daily_limit === 0 && kuota.sent_today >= 22, `${ke21.status} ${ke21.error || ''} terkirim ${kuota.sent_today}`);

    // ---------- AC-77: retur memotong komisi yang belum dibayar ----------
    const o77 = await A.pesan(toko, C, [{ product_id: P1.id, qty: 2 }], { cookie: kG.cookie });
    await A.konfirmasi(admin, o77.id);
    const awal77 = Math.floor(P1.price * 2 * 0.1);
    await retur(o77, P1.id, 1, P1.price);
    const setelah1 = komisiDari(o77.id);
    await retur(o77, P1.id, 1, P1.price);
    const setelah2 = komisiDari(o77.id);
    record('Retur 1 dari 2 barang: komisi Belum dibayar menjadi separuh; retur barang kedua: komisi 0 (AC-77)',
      setelah1 === `${Math.floor(awal77 / 2)}/${awal77}:added:false` && setelah2 === `0/${awal77}:added:false`, `${setelah1} lalu ${setelah2}`);
    const komisiG = (await panggil('GET', '/api/customer/affiliate/commissions', { token: Ag.token })).data;
    const baris77 = komisiG.rows.find((k) => k.order_number === o77.number);
    record('Baris komisi affiliate membawa komisi awal untuk ditandai Dipotong retur', baris77?.commission === 0 && baris77?.commission_original === awal77, JSON.stringify(baris77));

    // ---------- AC-78: retur sesudah dibayar menjadi potongan pembayaran berikutnya ----------
    const o78 = await A.pesan(toko, C, [{ product_id: P1.id, qty: 2 }], { cookie: kG.cookie });
    await A.konfirmasi(admin, o78.id);
    const bayar78 = await bayar(Ag.id);
    const komisi78 = Math.floor(P1.price * 2 * 0.1);
    await retur(o78, P1.id, 1, P1.price);
    const pot78 = potonganDari(o78.id);
    const o78b = await A.pesan(toko, C, [{ product_id: P1.id, qty: 2 }], { cookie: kG.cookie });
    await A.konfirmasi(admin, o78b.id);
    const kom78b = Math.floor(P1.price * 2 * 0.1);
    const ringkas78 = (await panggil('GET', '/api/admin/affiliate/payouts/summary', { token: admin })).data.find((r) => r.affiliate_id === Ag.id);
    const bayar78b = await bayar(Ag.id);
    const harapBersih = kom78b - Math.floor(komisi78 / 2);
    const pengeluaran78 = psql(`select trunc(e.amount) from public.expenses e join public.affiliate_payouts p on p.expense_id = e.id where p.id = '${bayar78b.data?.id}'`);
    record('Retur sesudah dibayar: komisi tetap, muncul potongan separuh (AC-78)',
      bayar78.status === 200 && komisiDari(o78.id) === `${komisi78}/${komisi78}:added:true` && pot78 === `retur=${Math.floor(komisi78 / 2)}:false`, `${komisiDari(o78.id)} ${pot78}`);
    record('Ringkasan pembayaran: belum dibayar, potongan, dan bersihnya',
      ringkas78?.unpaid === kom78b && ringkas78?.deductions === Math.floor(komisi78 / 2) && ringkas78?.net === harapBersih, JSON.stringify(ringkas78));
    record('Pembayaran berikutnya mentransfer komisi dikurangi potongan, pengeluaran sama, potongan terpakai (AC-78)',
      bayar78b.status === 200 && bayar78b.data.amount === harapBersih && bayar78b.data.deduction_total === Math.floor(komisi78 / 2) && Number(pengeluaran78) === harapBersih
        && potonganDari(o78.id) === `retur=${Math.floor(komisi78 / 2)}:true`,
      `${bayar78b.status} ${bayar78b.error || ''} transfer ${bayar78b.data?.amount} pengeluaran ${pengeluaran78}`);

    const ditransferG = Number(psql(`select coalesce(sum(amount), 0) from public.affiliate_payouts where affiliate_id = '${Ag.id}'`));
    const totalG = (await panggil('GET', '/api/customer/affiliate/commissions', { token: Ag.token })).data.totals;
    const ringkasG = (await panggil('GET', '/api/admin/affiliate/payouts/summary', { token: admin })).data.find((r) => r.affiliate_id === Ag.id);
    record('Sudah dibayar = uang yang benar-benar ditransfer, potongan yang terpakai tidak dihitung dua kali (QC3 D1)',
      totalG.paid === ditransferG && ringkasG?.paid === ditransferG, `dashboard ${totalG.paid}, admin ${ringkasG?.paid}, transfer ${ditransferG}`);

    // ---------- AC-79: batal sesudah dibayar ----------
    const o79 = await A.pesan(toko, C, [{ product_id: P1.id, qty: 1 }], { cookie: kA.cookie });
    await A.konfirmasi(admin, o79.id);
    await bayar(Af.id);
    const kom79 = Number(psql(`select trunc(commission) from public.affiliate_commissions where order_id = '${o79.id}'`));
    psql(`update public.orders set order_status = 'canceled' where id = '${o79.id}'`);
    const batal79 = potonganDari(o79.id);
    psql(`update public.orders set order_status = 'done' where id = '${o79.id}'`);
    record('Pesanan dibatalkan sesudah komisinya dibayar: potongan sebesar komisi; selesai lagi: potongan hilang (AC-79)',
      batal79 === `batal=${kom79}:false` && potonganDari(o79.id) === '-', `${batal79} lalu ${potonganDari(o79.id)}`);

    // ---------- AC-80: potongan menutup semua komisi ----------
    psql(`update public.orders set order_status = 'canceled' where id = '${o79.id}'`);
    const o80 = await A.pesan(toko, C, [{ product_id: P2.id, qty: 1 }], { cookie: kA.cookie });
    await A.konfirmasi(admin, o80.id);
    const kom80 = Number(psql(`select trunc(commission) from public.affiliate_commissions where order_id = '${o80.id}'`));
    const sebelum80 = psql(`select count(*) from public.affiliate_payouts where affiliate_id = '${Af.id}'`);
    const tolak80 = await bayar(Af.id);
    record('Komisi Belum dibayar lebih kecil dari potongan: Bayar ditolak dengan pesan potongan, tidak ada yang berubah (AC-80)',
      kom80 <= kom79 && tolak80.status === 409 && /^Saldo komisi masih tertutup potongan Rp [\d.]+\. Potongan dipotong dari pembayaran berikutnya\.$/.test(tolak80.error || '')
        && psql(`select count(*) from public.affiliate_payouts where affiliate_id = '${Af.id}'`) === sebelum80,
      `${kom80} vs ${kom79}: ${tolak80.status} ${tolak80.error}`);
    psql(`update public.orders set order_status = 'done' where id = '${o79.id}'`);

    // ---------- AC-75: minimal pencairan ----------
    await A.aturProgram(admin, { payout_minimum: 100_000_000 });
    const ringkas75 = (await panggil('GET', '/api/admin/affiliate/payouts/summary', { token: admin }));
    const barisA75 = ringkas75.data.find((r) => r.affiliate_id === Af.id);
    const tanpa = await bayar(Af.id);
    const dengan = await bayar(Af.id, { abaikan_minimal: true });
    record('Di bawah minimal: ditandai di ringkasan, Bayar tanpa konfirmasi ditolak, dengan konfirmasi berhasil (AC-75)',
      ringkas75.json?.payout_minimum === 100_000_000 && barisA75?.below_minimum === true && tanpa.status === 409 && tanpa.error === 'Komisi belum mencapai minimal pencairan Rp 100.000.000.' && dengan.status === 200,
      `${barisA75?.below_minimum} ${tanpa.status} ${tanpa.error} ${dengan.status} ${dengan.error || ''}`);
    await A.aturProgram(admin, { payout_minimum: 0 });

    // ---------- AC-83: omset bersih retur ----------
    const o83 = await A.pesan(toko, C, [{ product_id: P2.id, qty: 1 }], { cookie: kG.cookie });
    await A.konfirmasi(admin, o83.id);
    await retur(o83, P2.id, 1, 200_000);
    const omsetSql = Number(psql(`select coalesce(sum(o.subtotal - o.discount - coalesce((select sum(r.refund_amount) from public.order_returns r where r.order_id = o.id), 0)), 0) from public.orders o where o.affiliate_id = '${Ag.id}' and o.order_status = 'done'`));
    const meG = (await panggil('GET', '/api/customer/affiliate', { token: Ag.token })).data;
    const ringkasAdmin = (await panggil('GET', '/api/admin/affiliate/overview', { token: admin })).data.affiliates.find((x) => x.id === Ag.id);
    record('Omset di ringkasan affiliate dan admin = pesanan Selesai dikurangi retur (AC-83)',
      meG.summary.all.omset === omsetSql && ringkasAdmin?.omset === omsetSql, `affiliate ${meG.summary.all.omset}, admin ${ringkasAdmin?.omset}, SQL ${omsetSql}`);

    // ---------- AC-81: bonus target bulan berjalan ----------
    const B = await A.daftarPembeli(toko, CAP, 'b');
    await A.izinkan(admin, B.id);
    const kodeB = await A.kodeAffiliate(B.token);
    const kB = await A.klik(toko, kodeB);
    const qtyTarget = Math.ceil(5_000_000 / P1.price) + 1;
    await A.aturProgram(admin, { bonus_enabled: true, bonus_target: 5_000_000, bonus_type: 'percentage', bonus_value: 2 });
    const o81 = await A.pesan(toko, C, [{ product_id: P1.id, qty: qtyTarget }], { cookie: kB.cookie });
    await A.konfirmasi(admin, o81.id);
    await tunggu(5200);
    const meB = (await panggil('GET', '/api/customer/affiliate', { token: B.token })).data;
    const omset81 = P1.price * qtyTarget;
    const bonusBaris = psql(`select status || ':' || trunc(amount) from public.affiliate_bonuses where affiliate_id = '${B.id}'`);
    record('Omset bulan ini melewati target: bonus Berjalan 2% dan kartu target di ringkasan (AC-81)',
      meB.target?.tercapai === true && meB.target.omset === omset81 && meB.target.bonus === Math.floor(omset81 * 0.02) && bonusBaris === `berjalan:${Math.floor(omset81 * 0.02)}`,
      `${JSON.stringify(meB.target)} | ${bonusBaris}`);
    const turun = qtyTarget - Math.floor(5_000_000 / P1.price);
    await retur(o81, P1.id, turun, P1.price * turun);
    await tunggu(5200);
    const meB2 = (await panggil('GET', '/api/customer/affiliate', { token: B.token })).data;
    record('Retur menurunkan omset di bawah target: bonus berjalan hilang (AC-81)',
      meB2.target?.tercapai === false && psql(`select count(*) from public.affiliate_bonuses where affiliate_id = '${B.id}'`) === '0', `${JSON.stringify(meB2.target)}`);

    // ---------- AC-82, AC-84: bonus bulan lalu dibayar, lalu pembayarannya dibatalkan ----------
    const o82 = await A.pesan(toko, C, [{ product_id: P1.id, qty: qtyTarget }], { cookie: kB.cookie });
    await A.konfirmasi(admin, o82.id);
    psql(`update public.orders set created_at = (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '10 days') at time zone 'Asia/Jakarta' where id = '${o82.id}'`);
    const bonus82 = Math.floor(P1.price * qtyTarget * 0.02);
    // Ringkasan menghitung ulang bonus paling sering sekali per 5 detik per toko.
    await tunggu(5200);
    const ringkas82 = (await panggil('GET', '/api/admin/affiliate/payouts/summary', { token: admin })).data.find((r) => r.affiliate_id === B.id);
    const statusBonus = psql(`select status || ':' || trunc(amount) from public.affiliate_bonuses where affiliate_id = '${B.id}'`);
    const bayar82 = await bayar(B.id);
    record('Bonus bulan lalu yang mencapai target berstatus Belum dibayar dan ikut di pembayaran (AC-82)',
      statusBonus === `added:${bonus82}` && ringkas82?.bonus === bonus82 && bayar82.status === 200 && bayar82.data.bonus_total === bonus82
        && psql(`select paid::text from public.affiliate_bonuses where affiliate_id = '${B.id}'`) === 'true',
      `${statusBonus} ringkasan ${ringkas82?.bonus} bayar ${bayar82.status} ${bayar82.error || ''} bonus ${bayar82.data?.bonus_total}`);
    psql(`update public.orders set order_status = 'canceled' where id = '${o82.id}'`);
    await panggil('GET', '/api/admin/affiliate/payouts/summary', { token: admin });
    record('Setelah dibayar, pembatalan pesanan bulan itu tidak mengubah bonusnya (AC-82)',
      psql(`select status || ':' || trunc(amount) || ':' || paid from public.affiliate_bonuses where affiliate_id = '${B.id}'`) === `added:${bonus82}:true`,
      psql(`select status || ':' || trunc(amount) || ':' || paid from public.affiliate_bonuses where affiliate_id = '${B.id}'`));
    psql(`update public.orders set order_status = 'done' where id = '${o82.id}'`);
    const idKomisi82 = psql(`select string_agg(id::text, ',') from public.affiliate_commissions where payout_id = '${bayar82.data?.id}'`).split(',').filter(Boolean);
    const pot84 = psql(`select count(*) from public.affiliate_potongan where payout_id = '${bayar82.data?.id}'`);
    const lepas = await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: idKomisi82, action: 'mark_unpaid' } });
    record('Membatalkan seluruh pembayaran yang memuat bonus: pembayaran hilang, bonus kembali Belum dibayar (AC-84)',
      lepas.status === 200 && psql(`select count(*) from public.affiliate_payouts where id = '${bayar82.data?.id}'`) === '0'
        && psql(`select paid::text || ':' || coalesce(payout_id::text, '-') from public.affiliate_bonuses where affiliate_id = '${B.id}'`) === 'false:-',
      `${lepas.status} pembayaran ${psql(`select count(*) from public.affiliate_payouts where id = '${bayar82.data?.id}'`)} potongan di dalamnya ${pot84}`);
    const idKomisi78 = psql(`select string_agg(id::text, ',') from public.affiliate_commissions where payout_id = '${bayar78b.data?.id}'`).split(',').filter(Boolean);
    await panggil('POST', '/api/admin/affiliate/commissions/bulk', { token: admin, body: { ids: idKomisi78, action: 'mark_unpaid' } });
    record('Membatalkan seluruh pembayaran yang memakai potongan: potongan kembali menunggu (AC-84)',
      potonganDari(o78.id) === `retur=${Math.floor(komisi78 / 2)}:false`, potonganDari(o78.id));

    // ---------- Pengaturan baru tersimpan ----------
    const set = (await panggil('GET', '/api/admin/affiliate/settings', { token: admin })).data;
    const salah = await panggil('PUT', '/api/admin/affiliate/settings', { token: admin, body: { ...set, bonus_type: 'percentage', bonus_value: 150 } });
    record('Pengaturan menyimpan minimal, bonus, dan batas harian 0, tanpa saklar kontak; persen bonus 150 ditolak',
      set.invite_daily_limit === 0 && set.bonus_enabled === true && set.bonus_value === 2 && !('show_buyer_contact' in set) && salah.status === 400 && salah.error === 'Persentase bonus harus 0 sampai 100.',
      `${JSON.stringify({ limit: set.invite_daily_limit, bonus: set.bonus_value, kontak: 'show_buyer_contact' in set })} ${salah.status}`);
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    psql(`update public.products set affiliate_commission = ${komisiP2Asli === 'null' ? 'null' : `$j$${komisiP2Asli}$j$::jsonb`} where id = '${P2.id}'`);
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
  }
  ringkas();
})();
