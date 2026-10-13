// Isolasi data dan hak akses program affiliate (NFR-3, rencana uji bagian akses).
//
// Dua affiliate (A punya data, C kosong), satu member tanpa akses, satu member
// diblokir, admin, dan satu kasir. Tiap peran hanya boleh menyentuh miliknya.

const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const TANPA_AKSES = 'Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.';

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const [P1] = A.produkUji(toko, 1);
  let idKasir = null;

  try {
    await A.aturProgram(admin, {
      enabled: true, access_mode: 'approved', general_cookie: true, permanent: false,
      commission: [{ type: 'percentage', value: 10 }], 
    });
    const Af = await A.daftarPembeli(toko, CAP, 'a');
    const C = await A.daftarPembeli(toko, CAP, 'c');
    const M = await A.daftarPembeli(toko, CAP, 'm');
    const X = await A.daftarPembeli(toko, CAP, 'x');
    await A.izinkan(admin, Af.id);
    await A.izinkan(admin, C.id);
    await A.izinkan(admin, X.id, 'blocked');
    const kodeA = await A.kodeAffiliate(Af.token);
    await A.kodeAffiliate(C.token);
    const klik = await A.klik(toko, kodeA, { productId: P1.id, source: 'fb', media: 'iso' });
    const B = await A.daftarPembeli(toko, CAP, 'b', { cookie: klik.cookie });
    const o = await A.pesan(toko, B, [{ product_id: P1.id, qty: 1 }], { cookie: klik.cookie });
    await A.konfirmasi(admin, o.id);
    const und = await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: `aff.undang.iso.${CAP}@contoh.id` } });
    const bayar = await panggil('POST', '/api/admin/affiliate/payouts', { token: admin, body: { affiliate_id: Af.id, record_expense: false, proof_image: 'data:image/png;base64,iVBORw0KGgo=' } });
    record('Persiapan: A punya klik, pesanan, komisi, downline, undangan, pembayaran', und.status === 200 && bayar.status === 200, `${und.status} ${bayar.status}`);

    // ---- A melihat datanya sendiri --------------------------------------
    const ambil = async (token, bagian) => (await panggil('GET', `/api/customer/affiliate${bagian}`, { token })).data;
    const milikA = {
      orders: await ambil(Af.token, '/orders'),
      commissions: await ambil(Af.token, '/commissions'),
      network: await ambil(Af.token, '/network'),
      invitations: await ambil(Af.token, '/invitations'),
      acquisition: await ambil(Af.token, '/acquisition'),
      saya: await ambil(Af.token, ''),
    };
    record('A melihat pesanan, komisi, downline, undangan, dan akuisisinya sendiri',
      milikA.orders.length === 1 && milikA.orders[0].order_number === o.number && milikA.commissions.rows.length === 1 && milikA.network.nodes.length === 1
        && milikA.invitations.rows.length === 1 && milikA.acquisition.length === 1 && milikA.saya.summary.all.clicks === 1);

    // ---- C tidak melihat apa pun milik A (NFR-3) -------------------------
    const milikC = {
      orders: await ambil(C.token, '/orders'),
      commissions: await ambil(C.token, '/commissions'),
      network: await ambil(C.token, '/network'),
      invitations: await ambil(C.token, '/invitations'),
      acquisition: await ambil(C.token, '/acquisition'),
      charts: await ambil(C.token, '/charts'),
      saya: await ambil(C.token, ''),
    };
    const semuaNol = Object.values(milikC.saya.summary).every((p) => Object.values(p).every((n) => n === 0));
    record('Affiliate C tidak melihat pesanan, komisi, downline, undangan, atau akuisisi milik A (NFR-3, AC-34)',
      milikC.orders.length === 0 && milikC.commissions.rows.length === 0 && milikC.network.nodes.length === 0 && milikC.invitations.rows.length === 0 && milikC.acquisition.length === 0);
    record('Ringkasan dan grafik C seluruhnya nol', semuaNol && milikC.commissions.totals.unpaid === 0 && milikC.commissions.totals.paid === 0 && milikC.charts.month.every((t) => t.omset === 0 && t.sales === 0), JSON.stringify(milikC.saya.summary.all));
    const isiC = JSON.stringify(milikC);
    record('Tidak ada nomor pesanan, nama pembeli, atau email milik A di jawaban untuk C', !isiC.includes(o.number) && !isiC.includes(B.name) && !isiC.includes(`aff.undang.iso.${CAP}`) && !isiC.includes(Af.id));
    const ulang = await panggil('POST', `/api/customer/affiliate/invitations/${und.data.id}/resend`, { token: C.token, body: {} });
    record('C mencoba mengirim ulang undangan A: 404, sama seperti undangan yang tidak ada', ulang.status === 404 && ulang.error === 'Undangan tidak ditemukan.', `${ulang.status} ${ulang.error}`);
    const acak = await panggil('POST', '/api/customer/affiliate/invitations/00000000-0000-4000-8000-000000000000/resend', { token: C.token, body: {} });
    record('Pesan untuk undangan orang lain dan undangan yang tidak ada persis sama', acak.status === ulang.status && acak.error === ulang.error);

    // ---- Kontak hanya bila pengaturan mengizinkan (D-9) ------------------
    record('Bawaan: kunci kontak pembeli dan downline tidak dikirim server sama sekali (AC-40, AC-49)',
      !('buyer_phone' in milikA.orders[0]) && !('buyer_email' in milikA.orders[0]) && !('email' in milikA.network.nodes[0]) && !('phone' in milikA.network.nodes[0]), Object.keys(milikA.orders[0]).join(','));
    // D-33: saklar kontak sudah dihapus. Pengaturan lama yang masih menyimpannya tidak membuka kontak.
    psql(`update public.stores set affiliate_settings = affiliate_settings || '{"show_buyer_contact": true, "show_downline_contact": true}'::jsonb where id = '${toko}'`);
    const terbuka = { orders: await ambil(Af.token, '/orders'), network: await ambil(Af.token, '/network') };
    record('Saklar kontak lama tersimpan menyala: kontak pembeli dan downline tetap tidak terkirim (D-33, AC-74)',
      !JSON.stringify(terbuka).includes(B.email) && !('buyer_phone' in terbuka.orders[0]) && !('email' in terbuka.network.nodes[0]), JSON.stringify(terbuka.orders[0]).slice(0, 160));

    // ---- Member tanpa akses dan member diblokir --------------------------
    const sayaM = await ambil(M.token, '');
    record('Member belum diizinkan: eligible false, alasan no_access, tanpa kode dan angka (AC-3)', sayaM.eligible === false && sayaM.reason === 'no_access' && sayaM.message === TANPA_AKSES && !sayaM.profile && !sayaM.summary);
    const sayaX = await ambil(X.token, '');
    record('Member diblokir: alasan blocked', sayaX.eligible === false && sayaX.reason === 'blocked');
    const jalur = [
      ['GET', '/charts'], ['GET', '/acquisition'], ['GET', '/products'], ['GET', '/orders'], ['GET', '/commissions'], ['GET', '/network'], ['GET', '/invitations'],
      ['POST', '/invitations', { email: `aff.undang.m.${CAP}@contoh.id` }], ['POST', `/invitations/${und.data.id}/resend`, {}], ['PATCH', '/bank', { bank_info: 'BCA 1' }],
    ];
    for (const [siapa, akun] of [['belum diizinkan', M], ['diblokir', X]]) {
      const hasil = [];
      for (const [m, p, body] of jalur) {
        const r = await panggil(m, `/api/customer/affiliate${p}`, { token: akun.token, body });
        if (r.status !== 403 || r.error !== TANPA_AKSES) hasil.push(`${m} ${p}: ${r.status}`);
      }
      record(`Member ${siapa}: ${jalur.length} endpoint affiliate menolak 403 dengan pesan pengaturan`, hasil.length === 0, hasil.join(' ; '));
    }
    record('Member tanpa akses tidak mendapat kode atau undangan apa pun', psql(`select coalesce(affiliate_code, '-') from public.customers where id = '${M.id}'`) === '-' && psql(`select count(*) from public.affiliate_invitations where affiliate_id = '${M.id}'`) === '0');

    // ---- Tanpa sesi dan sesi palsu ---------------------------------------
    const publikAman = [];
    for (const [m, p] of [['GET', '/api/customer/affiliate'], ['GET', '/api/customer/affiliate/orders'], ['GET', '/api/admin/affiliate/settings'], ['GET', '/api/admin/affiliate/commissions'], ['POST', '/api/admin/affiliate/payouts']]) {
      const tanpa = await panggil(m, p, { body: m === 'POST' ? {} : undefined });
      const palsu = await panggil(m, p, { token: 'bukan.token.sah', body: m === 'POST' ? {} : undefined });
      if (tanpa.status !== 401 || palsu.status !== 401) publikAman.push(`${m} ${p}: ${tanpa.status}/${palsu.status}`);
    }
    record('Tanpa sesi atau dengan sesi palsu semua endpoint affiliate menjawab 401', publikAman.length === 0, publikAman.join(' ; '));

    // ---- Pembeli (termasuk affiliate) tidak bisa memakai endpoint admin ---
    const adminJalur = [
      ['GET', '/settings'], ['PUT', '/settings', { enabled: false }], ['GET', '/overview'], ['GET', '/commissions'],
      ['POST', '/commissions/bulk', { ids: [milikA.commissions.rows[0].id], action: 'mark_unpaid' }], ['GET', '/payouts/summary'], ['GET', '/payouts'],
      ['GET', `/payouts/${bayar.data.id}/proof`], ['POST', '/payouts', { affiliate_id: Af.id }], ['GET', '/members'],
      ['PATCH', `/members/${Af.id}`, { access: 'allowed' }], ['GET', `/members/${Af.id}/network`], ['GET', `/order/${o.id}`],
    ];
    const bocor = [];
    for (const [m, p, body] of adminJalur) {
      const r = await panggil(m, `/api/admin/affiliate${p}`, { token: Af.token, body });
      if (r.status !== 403) bocor.push(`${m} ${p}: ${r.status}`);
    }
    record(`Affiliate mencoba ${adminJalur.length} endpoint admin: semuanya 403`, bocor.length === 0, bocor.join(' ; '));
    record('Percobaan itu tidak mengubah apa pun', psql(`select affiliate_settings->>'enabled' from public.stores where id = '${toko}'`) === 'true' && psql(`select count(*) from public.affiliate_commissions where affiliate_id = '${Af.id}' and paid`) === '1');

    // ---- Kasir (staf bukan admin) -----------------------------------------
    const kasir = await panggil('POST', '/api/admin/users', { token: admin, body: { email: `aff.kasir.${CAP}@contoh.id`, password: 'rahasia123', full_name: 'Kasir Uji ' + CAP, role: 'cashier' } });
    idKasir = kasir.data?.id ?? kasir.json?.data?.user?.id ?? psql(`select id from public.app_users where lower(email) = 'aff.kasir.${CAP}@contoh.id'`);
    const masukKasir = await panggil('POST', '/api/auth/signin', { body: { email: `aff.kasir.${CAP}@contoh.id`, password: 'rahasia123' } });
    const tKasir = masukKasir.json?.session?.access_token;
    const bocorKasir = [];
    for (const [m, p, body] of adminJalur) {
      const r = await panggil(m, `/api/admin/affiliate${p}`, { token: tKasir, body });
      if (r.status !== 403) bocorKasir.push(`${m} ${p}: ${r.status}`);
    }
    record(`Kasir mencoba ${adminJalur.length} endpoint admin affiliate: semuanya 403`, !!tKasir && bocorKasir.length === 0, tKasir ? bocorKasir.join(' ; ') : 'kasir gagal masuk: ' + masukKasir.error);
    const kasirPembeli = await panggil('GET', '/api/customer/affiliate', { token: tKasir });
    const adminPembeli = await panggil('GET', '/api/customer/affiliate', { token: admin });
    record('Akun staf tidak bisa membuka dashboard affiliate pembeli', kasirPembeli.status === 403 && adminPembeli.status === 403 && adminPembeli.error === 'Halaman ini khusus akun pembeli.', `${kasirPembeli.status} ${adminPembeli.status}`);

    // ---- Jalur umum /api/query tidak membuka data affiliate ----------------
    const q = (token, body) => panggil('POST', '/api/query', { token, body: { columns: '*', filters: [], orderBy: null, limit: 5, payload: null, returning: false, single: false, maybeSingle: false, ...body } });
    const tabel = [];
    for (const t of ['affiliate_commissions', 'affiliate_payouts', 'affiliate_invitations', 'affiliate_clicks', 'affiliate_outbox']) {
      const r = await q(admin, { table: t, action: 'select' });
      if (r.status === 200) tabel.push(t);
    }
    record('Tabel affiliate tidak tersedia lewat /api/query, bahkan untuk admin', tabel.length === 0, tabel.join(','));
    const tulisPesanan = await q(admin, { table: 'orders', action: 'update', payload: { affiliate_id: C.id }, filters: [{ type: 'eq', column: 'id', value: o.id }] });
    const tulisMember = await q(admin, { table: 'customers', action: 'update', payload: { affiliate_access: 'allowed', referred_by: Af.id, affiliate_code: 'CURI' + CAP }, filters: [{ type: 'eq', column: 'id', value: M.id }] });
    record('Kolom affiliate di pesanan dan pelanggan tidak bisa ditulis lewat /api/query',
      tulisPesanan.status >= 400 && tulisMember.status >= 400 && psql(`select affiliate_id from public.orders where id = '${o.id}'`) === Af.id && psql(`select affiliate_access || '|' || coalesce(referred_by::text, '-') from public.customers where id = '${M.id}'`) === 'default|-',
      `${tulisPesanan.status} ${tulisMember.status}`);
    const bacaMember = await q(admin, { table: 'customers', action: 'select', filters: [{ type: 'eq', column: 'id', value: Af.id }] });
    const kunci = Object.keys(bacaMember.data?.[0] ?? {});
    record('Membaca pelanggan lewat /api/query tidak membawa rekening, kode, atau upline', bacaMember.status === 200 && kunci.length > 0 && !kunci.some((k) => ['bank_info', 'affiliate_code', 'referred_by', 'affiliate_access'].includes(k)), kunci.join(','));
    const pembeliQuery = await q(Af.token, { table: 'orders', action: 'select' });
    record('Akun pembeli tidak bisa memakai /api/query untuk membaca pesanan toko', pembeliQuery.status === 403 || (pembeliQuery.status === 200 && (pembeliQuery.data ?? []).length === 0), String(pembeliQuery.status));

    // ---- Bukti transfer hanya untuk admin ---------------------------------
    const bukti = await panggil('GET', `/api/admin/affiliate/payouts/${bayar.data.id}/proof`, { token: admin });
    const daftarBayar = await panggil('GET', '/api/admin/affiliate/payouts', { token: admin });
    record('Admin bisa membuka bukti transfer, daftar pembayaran tidak membawa gambarnya',
      bukti.status === 200 && String(bukti.data?.proof_image).startsWith('data:image/png') && !JSON.stringify(daftarBayar.data).includes('data:image'));
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    if (idKasir) await panggil('DELETE', `/api/admin/users/${idKasir}`, { token: admin }).catch(() => {});
  }
  ringkas();
})();
