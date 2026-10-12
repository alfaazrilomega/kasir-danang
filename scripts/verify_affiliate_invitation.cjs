// Undangan email bertoken (FR-33 sampai FR-38, AC-42 sampai AC-46).
//
// Token mentah hanya ada di email, dan email ke alamat contoh.id tidak
// dikirim. Supaya tautan bisa dibuka, suite ini menimpa sidik token di basis
// data dengan sidik token yang diketahuinya.

const { chromium } = require('playwright');
const { trackApi, waitForApiIdle, BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');
const { psql, panggil } = A;

const CAP = Date.now().toString().slice(-6);
const { record, ringkas } = A.pencatat();
const KUNCI_TOKEN = 'tokoku.customer.token.v1';
const TEKS = {
  hilang: 'Undangan tidak ditemukan. Minta pengundang mengirim ulang.',
  lewat: 'Undangan ini sudah kedaluwarsa. Minta pengundang mengirim ulang.',
  izin: 'Link affiliasi ini tidak diperkenankan. Silahkan hubungi pemilik link affiliasi ini',
};
const emailUndang = (n) => `aff.undang.${n}.${CAP}@contoh.id`;
const undangan = (email) => psql(`select id || '|' || status || '|' || token_hash || '|' || resend_count || '|' || coalesce(registered_customer_id::text, '-') || '|' || round(extract(epoch from (expires_at - sent_at)) / 86400) from public.affiliate_invitations where email = '${email}' order by created_at desc limit 1`).split('|');
const pakaiToken = (email, token) => psql(`update public.affiliate_invitations set token_hash = '${A.sha256(token)}' where email = '${email}'`);

(async () => {
  const toko = A.idToko();
  const admin = await A.tokenAdmin();
  const asli = psql(`select affiliate_settings::text from public.stores where id = '${toko}'`);
  const browser = await chromium.launch();

  try {
    await A.aturProgram(admin, { enabled: true, access_mode: 'approved', cookie_days: 30, general_cookie: true, permanent: false, invite_days: 7, invite_daily_limit: 20 });
    const Af = await A.daftarPembeli(toko, CAP, 'a');
    const A2 = await A.daftarPembeli(toko, CAP, 'a2');
    await A.izinkan(admin, Af.id);
    await A.izinkan(admin, A2.id);

    const affCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    await affCtx.addInitScript(([k, t]) => localStorage.setItem(k, t), [KUNCI_TOKEN, Af.token]);
    const aff = await affCtx.newPage();
    trackApi(aff);
    const bukaUndang = async () => {
      await aff.goto(BASE_URL + '/toko/affiliate?tab=undang', { waitUntil: 'networkidle' });
      await aff.locator('[data-kuota-undangan]').waitFor({ timeout: 10000 });
    };

    // ---------- 1. Mengirim undangan dari layar (AC-42) ----------
    await bukaUndang();
    record('Kuota undangan mulai dari 0 dari 20', (await aff.locator('[data-kuota-undangan]').innerText()).trim() === '0 dari 20 undangan hari ini');
    await aff.locator('#undang-email').fill('salah');
    await aff.getByRole('button', { name: 'Kirim undangan' }).click();
    record('Email tidak valid ditolak di layar', (await aff.locator('#undang-galat').innerText().catch(() => '')) === 'Email tidak valid.');
    await aff.locator('#undang-email').fill(emailUndang(1));
    await aff.locator('#undang-nama').fill('Teman Uji');
    await aff.locator('#undang-pesan').fill('Ini toko part racing langgananku <b>ori</b>.');
    await aff.getByRole('button', { name: 'Kirim undangan' }).click();
    await aff.getByText(`Undangan terkirim ke ${emailUndang(1)}.`).first().waitFor({ timeout: 10000 }).catch(() => {});
    let u1 = undangan(emailUndang(1));
    record('Undangan tersimpan: status Terkirim, berlaku 7 hari, token disimpan sebagai sidik (AC-42)', u1[1] === 'sent' && /^[0-9a-f]{64}$/.test(u1[2]) && u1[5] === '7', u1.slice(1).join(' '));
    record('Nama dan pesan tersimpan apa adanya sebagai teks', psql(`select name || '|' || message from public.affiliate_invitations where id = '${u1[0]}'`) === 'Teman Uji|Ini toko part racing langgananku <b>ori</b>.');
    let daftar = await aff.locator('[data-daftar-undangan]').innerText();
    record('Daftar undangan menampilkan email itu berstatus Terkirim, kuota 1 dari 20', daftar.includes(emailUndang(1)) && daftar.includes('Terkirim') && (await aff.locator('[data-kuota-undangan]').innerText()).trim() === '1 dari 20 undangan hari ini');
    record('Undangan yang baru dikirim belum bisa dikirim ulang', (await aff.getByRole('button', { name: 'Kirim ulang' }).count()) === 0);

    // ---------- 2. Penolakan (AC-43) ----------
    await aff.locator('#undang-email').fill(emailUndang(1).toUpperCase());
    await aff.getByRole('button', { name: 'Kirim undangan' }).click();
    await aff.locator('#undang-galat').waitFor({ timeout: 5000 }).catch(() => {});
    record('Email yang sama dalam 24 jam ditolak (AC-43)', (await aff.locator('#undang-galat').innerText().catch(() => '')) === 'Email ini sudah kamu undang dalam 24 jam terakhir.');
    await aff.locator('#undang-email').fill(A2.email);
    await aff.getByRole('button', { name: 'Kirim undangan' }).click();
    await aff.getByText('Email ini sudah terdaftar sebagai member.').first().waitFor({ timeout: 5000 }).catch(() => {});
    record('Email yang sudah menjadi member ditolak (AC-43)', (await aff.locator('#undang-galat').innerText().catch(() => '')) === 'Email ini sudah terdaftar sebagai member.');
    // Undangan dikirim dari email resmi toko ke alamat mana pun, jadi isinya tidak boleh membawa tautan.
    const bertautan = [];
    for (const [name, message] of [[undefined, 'Promo di https://contoh-lain.test/hadiah'], [undefined, 'cek www.contoh-lain.test ya'], ['bit.ly/hadiah', undefined], [undefined, 'kunjungi contoh-lain.com sekarang']]) {
      const r = await panggil('POST', '/api/customer/affiliate/invitations', { token: A2.token, body: { email: emailUndang(9), name, message } });
      if (r.status !== 400 || r.error !== 'Nama dan pesan undangan tidak boleh memuat tautan.') bertautan.push(`${name || message}: ${r.status}`);
    }
    record('Nama atau pesan undangan yang memuat tautan ditolak dan tidak tersimpan (AC-59)', bertautan.length === 0 && psql(`select count(*) from public.affiliate_invitations where email = '${emailUndang(9)}'`) === '0', bertautan.join(' ; '));
    const wajar = await panggil('POST', '/api/customer/affiliate/invitations', { token: A2.token, body: { email: emailUndang(9), name: 'Pak Budi, S.Kom.', message: 'Gear set CRF150 Rp 955.000, kualitas no.1! Cek ya.' } });
    record('Pesan wajar dengan titik, koma, dan harga tetap diterima (AC-59)', wajar.status === 200, `${wajar.status} ${wajar.error || ''}`);

    // ---------- 3. Batas harian (AC-44) ----------
    await A.aturProgram(admin, { invite_daily_limit: 2 });
    const kedua = await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailUndang(2) } });
    const ketiga = await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailUndang(3) } });
    record('Undangan melewati batas harian ditolak 429 dengan pesan PRD (AC-44)', kedua.status === 200 && ketiga.status === 429 && ketiga.error === 'Batas undangan hari ini sudah tercapai (2 undangan). Coba lagi besok.', `${kedua.status} ${ketiga.status} ${ketiga.error}`);
    await bukaUndang();
    const tombolPenuh = aff.getByRole('button', { name: 'Batas hari ini tercapai' });
    record('Di layar tombol kirim mati dan menyebut batas tercapai', (await tombolPenuh.count()) === 1 && (await tombolPenuh.isDisabled()) && (await aff.locator('[data-kuota-undangan]').innerText()).trim() === '2 dari 2 undangan hari ini');
    await A.aturProgram(admin, { invite_daily_limit: 20 });

    // ---------- 4. Penerima membuka undangan dan mendaftar (AC-45, AC-46) ----------
    pakaiToken(emailUndang(1), 'tokenuji' + CAP);
    const tamuCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const tamu = await tamuCtx.newPage();
    trackApi(tamu);
    await tamu.goto(`${BASE_URL}/aff/undangan/tokenuji${CAP}`, { waitUntil: 'networkidle' });
    await tamu.waitForURL((u) => u.pathname === '/toko/masuk', { timeout: 15000 }).catch(() => {});
    const alamat = new URL(tamu.url());
    record('Undangan membawa ke halaman daftar dengan email di alamat (AC-45)', alamat.pathname === '/toko/masuk' && alamat.searchParams.get('tab') === 'daftar' && alamat.searchParams.get('email') === emailUndang(1), tamu.url());
    await tamu.getByLabel('Email', { exact: true }).waitFor({ timeout: 10000 });
    record('Kolom email pendaftaran sudah terisi email undangan (AC-45)', (await tamu.getByLabel('Email', { exact: true }).inputValue()) === emailUndang(1));
    u1 = undangan(emailUndang(1));
    record('Membuka undangan mengubah status menjadi Dibuka dan memasang cookie', u1[1] === 'opened' && (await tamuCtx.cookies()).some((c) => c.name === 'gnnk_aff' && c.httpOnly));
    record('Pembukaan undangan tercatat sekali sebagai klik berjenis undangan', psql(`select count(*) from public.affiliate_clicks where affiliate_id = '${Af.id}' and kind = 'undangan'`) === '1');
    await tamu.getByLabel('Nama lengkap').fill('Teman Uji ' + CAP);
    await tamu.getByLabel('Nomor HP / WhatsApp', { exact: true }).fill('0815' + CAP + '31');
    await tamu.getByLabel('Kata sandi').fill('rahasia123');
    await tamu.locator('form[data-auth] input[type="checkbox"]').check();
    await tamu.locator('form[data-auth] button[type="submit"]').click();
    await tamu.waitForURL((u) => !u.pathname.includes('/toko/masuk'), { timeout: 15000 }).catch(() => {});
    await tamu.waitForTimeout(800);
    const idTeman = psql(`select id from public.customers where lower(email) = '${emailUndang(1)}'`);
    record('Pendaftaran dari undangan: upline = pengundang, sumber undangan (AC-45)', !!idTeman && psql(`select referred_by || '|' || referral_source from public.customers where id = '${idTeman}'`) === `${Af.id}|undangan`);
    u1 = undangan(emailUndang(1));
    record('Undangan berstatus Terdaftar dan menunjuk akun barunya (AC-45)', u1[1] === 'registered' && u1[4] === idTeman, u1.slice(1).join(' '));
    await bukaUndang();
    daftar = await aff.locator('[data-daftar-undangan] li', { hasText: emailUndang(1) }).innerText();
    record('Pengundang melihat undangan itu Terdaftar tanpa tombol kirim ulang', daftar.includes('Terdaftar') && !daftar.includes('Kirim ulang'), daftar.replace(/\n/g, ' '));
    await aff.goto(BASE_URL + '/toko/affiliate?tab=jaringan', { waitUntil: 'networkidle' });
    await aff.locator('[data-pohon-jaringan]').waitFor({ timeout: 10000 }).catch(() => {});
    const pohon = await aff.locator('[data-pohon-jaringan]').innerText().catch(() => '');
    record('Halaman Jaringan menampilkan teman yang mendaftar, tanpa kontak (FR-29, AC-40)', pohon.includes('Teman Uji ' + CAP) && !pohon.includes(emailUndang(1)) && !pohon.includes('0815' + CAP), pohon.replace(/\n/g, ' ').slice(0, 120));
    const ulangBuka = await panggil('POST', '/api/public/affiliate/invitation', { body: { store_id: toko, token: 'tokenuji' + CAP } });
    record('Undangan yang sudah dipakai membawa ke halaman masuk, bukan galat', ulangBuka.status === 200 && ulangBuka.data?.redirect === '/toko/masuk', JSON.stringify(ulangBuka.json));

    // ---------- 5. Kirim ulang ----------
    const u2 = undangan(emailUndang(2));
    const terlaluCepat = await panggil('POST', `/api/customer/affiliate/invitations/${u2[0]}/resend`, { token: Af.token, body: {} });
    record('Kirim ulang sebelum 24 jam ditolak', terlaluCepat.status === 409 && terlaluCepat.error === 'Undangan baru bisa dikirim ulang 24 jam setelah pengiriman terakhir.', terlaluCepat.error);
    pakaiToken(emailUndang(2), 'lama' + CAP);
    psql(`update public.affiliate_invitations set sent_at = now() - interval '25 hours', expires_at = now() + interval '1 day' where id = '${u2[0]}'`);
    await bukaUndang();
    const barisDua = aff.locator('[data-daftar-undangan] li', { hasText: emailUndang(2) });
    await barisDua.getByRole('button', { name: 'Kirim ulang' }).click();
    await aff.getByText(`Undangan dikirim ulang ke ${emailUndang(2)}.`).first().waitFor({ timeout: 10000 }).catch(() => {});
    const u2b = undangan(emailUndang(2));
    record('Kirim ulang dari layar: token baru, hitungan bertambah, masa berlaku diperbarui', u2b[2] !== A.sha256('lama' + CAP) && u2b[3] === '1' && u2b[5] === '7' && u2b[1] === 'sent', u2b.slice(1).join(' '));
    await tamu.goto(`${BASE_URL}/aff/undangan/lama${CAP}`, { waitUntil: 'networkidle' });
    await tamu.locator('[data-affiliate-buka="galat"]').waitFor({ timeout: 10000 }).catch(() => {});
    record('Token lama tidak berlaku setelah kirim ulang: pesan di layar', (await tamu.locator('[role="alert"]').innerText().catch(() => '')) === TEKS.hilang);
    const orangLain = await panggil('POST', `/api/customer/affiliate/invitations/${u2[0]}/resend`, { token: A2.token, body: {} });
    record('Affiliate lain tidak bisa mengirim ulang undangan orang (404)', orangLain.status === 404, String(orangLain.status));

    // ---------- 6. Kedaluwarsa dan tidak dikenal ----------
    await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailUndang(3) } });
    pakaiToken(emailUndang(3), 'lewat' + CAP);
    psql(`update public.affiliate_invitations set expires_at = now() - interval '1 minute' where email = '${emailUndang(3)}'`);
    const tamu2Ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    const tamu2 = await tamu2Ctx.newPage();
    trackApi(tamu2);
    await tamu2.goto(`${BASE_URL}/aff/undangan/lewat${CAP}`, { waitUntil: 'networkidle' });
    await tamu2.locator('[data-affiliate-buka="galat"]').waitFor({ timeout: 10000 }).catch(() => {});
    record('Undangan kedaluwarsa: pesan PRD di layar HP (AC-46)', (await tamu2.locator('[role="alert"]').innerText().catch(() => '')) === TEKS.lewat);
    record('Undangan kedaluwarsa tidak memasang cookie (AC-46)', !(await tamu2Ctx.cookies()).some((c) => c.name === 'gnnk_aff'));
    const tanpa = tamu2.getByRole('link', { name: 'Daftar tanpa undangan' });
    const kotak = await tanpa.boundingBox().catch(() => null);
    record('Layar galat menawarkan Daftar tanpa undangan, tombol 44px', (await tanpa.getAttribute('href').catch(() => '')) === '/toko/masuk?tab=daftar' && !!kotak && kotak.height >= 44, kotak ? `${Math.round(kotak.height)}px` : '-');
    await bukaUndang();
    record('Pengundang melihat undangan itu Kedaluwarsa', (await aff.locator('[data-daftar-undangan] li', { hasText: emailUndang(3) }).innerText()).includes('Kedaluwarsa'));
    await tamu2.goto(`${BASE_URL}/aff/undangan/tidakada${CAP}`, { waitUntil: 'networkidle' });
    await tamu2.locator('[data-affiliate-buka="galat"]').waitFor({ timeout: 10000 }).catch(() => {});
    record('Token tidak dikenal: pesan PRD di layar', (await tamu2.locator('[role="alert"]').innerText().catch(() => '')) === TEKS.hilang);
    const panjang = await panggil('POST', '/api/public/affiliate/invitation', { body: { store_id: toko, token: 'x'.repeat(500) } });
    record('Token kepanjangan ditolak seperti token tidak dikenal', panjang.status === 404 && panjang.error === TEKS.hilang, String(panjang.status));
    record('Token mentah tidak pernah tersimpan di basis data', psql(`select count(*) from public.affiliate_invitations where token_hash in ('tokenuji${CAP}', 'lama${CAP}', 'lewat${CAP}')`) === '0');

    // ---------- 7. Daftar tanpa membuka tautan (FR-35) ----------
    await panggil('POST', '/api/customer/affiliate/invitations', { token: Af.token, body: { email: emailUndang(4) } });
    const langsung = await panggil('POST', '/api/customer/signup', { ip: A.ipUji(), body: { store_id: toko, email: emailUndang(4), password: 'rahasia123', name: 'Daftar Langsung ' + CAP, phone: '0815' + CAP + '44', privacy_accepted: true } });
    record('Email yang diundang lalu mendaftar tanpa membuka tautan tetap menjadi downline pengundang', langsung.status === 200 && psql(`select referred_by || '|' || referral_source from public.customers where lower(email) = '${emailUndang(4)}'`) === `${Af.id}|undangan` && undangan(emailUndang(4))[1] === 'registered');

    // ---------- 8. Pengundang kehilangan akses ----------
    await panggil('POST', '/api/customer/affiliate/invitations', { token: A2.token, body: { email: emailUndang(5) } });
    pakaiToken(emailUndang(5), 'blokir' + CAP);
    await A.izinkan(admin, A2.id, 'blocked');
    const diblokir = await panggil('POST', '/api/public/affiliate/invitation', { body: { store_id: toko, token: 'blokir' + CAP } });
    record('Undangan dari affiliate yang diblokir ditolak dengan pesan Sejoli', diblokir.status === 403 && diblokir.error === TEKS.izin && !diblokir.cookie, diblokir.error);
    const kirimBlokir = await panggil('POST', '/api/customer/affiliate/invitations', { token: A2.token, body: { email: emailUndang(6) } });
    record('Affiliate yang diblokir tidak bisa mengirim undangan', kirimBlokir.status === 403, String(kirimBlokir.status));
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    // Akun, pesanan (stok dikembalikan), komisi, dan pembayaran putaran ini dihapus,
    // supaya suite lain tidak membaca data uji affiliate.
    await A.bersihkanUji(admin, `aff.%.${CAP}@contoh.id`).catch((e) => record('Data uji putaran ini terhapus', false, e.message));
    psql(`update public.stores set affiliate_settings = $j$${asli || '{}'}$j$::jsonb where id = '${toko}'`);
    await browser.close();
  }
  ringkas();
})();
