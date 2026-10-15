// Verifikasi dua langkah staf (TOTP, RFC 6238), 15 Okt 2026.
//
// Akun staf uji (uji.mfa.<cap>@contoh.id, peran admin di toko lokal) dibuat
// lewat SQL dan dihapus di akhir. Kode TOTP dihitung oleh implementasi
// mandiri di suite ini yang lebih dulu dicek terhadap vektor uji RFC 6238.

const crypto = require('crypto');
const { chromium } = require('playwright');
const { BASE_URL } = require('./lib/harness.cjs');
const A = require('./lib/affiliate.cjs');

const API = 'http://127.0.0.1:3000';
const CAP = Date.now().toString().slice(-6);
const EMAIL = `uji.mfa.${CAP}@contoh.id`;
const SANDI = `Sandi-Uji-${CAP}`;
const { record, ringkas } = A.pencatat();

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function dariBase32(s) {
  let bits = 0, nilai = 0;
  const out = [];
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    nilai = (nilai << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((nilai >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(rahasia, waktu = Date.now(), digit = 6) {
  const pesan = Buffer.alloc(8);
  pesan.writeBigUInt64BE(BigInt(Math.floor(waktu / 30000)));
  const h = crypto.createHmac('sha1', dariBase32(rahasia)).update(pesan).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digit).padStart(digit, '0');
}
const panggil = (method, jalur, { token, body } = {}) =>
  fetch(API + jalur, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
const masuk = (password = SANDI) => panggil('POST', '/api/auth/signin', { body: { email: EMAIL, password } });
const tungguLangkahBaru = async () => {
  // Kode yang sudah dipakai ditolak (anti-ulang): tunggu langkah 30 detik berikutnya.
  await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
};

(async () => {
  const toko = A.idToko();
  const dibuat = [EMAIL];
  const buatAkun = (email) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = `scrypt:${salt}:${crypto.scryptSync(SANDI, salt, 64).toString('hex')}`;
    const id = A.psql(`insert into public.app_users (email, password_hash) values ('${email}', '${hash}') returning id`).split(/\s/)[0];
    A.psql(`insert into public.profiles (id, store_id, full_name, email, role) values ('${id}', '${toko}', 'Uji MFA ${CAP}', '${email}', 'admin')`);
    return id;
  };
  const browser = await chromium.launch();
  try {
    record('Implementasi TOTP uji cocok dengan vektor RFC 6238 (T=59 -> 94287082)',
      totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59 * 1000, 8) === '94287082');

    const id = buatAkun(EMAIL);

    let r = await masuk();
    const token = r.j.session?.access_token;
    record('Akun tanpa verifikasi dua langkah masuk seperti biasa', r.status === 200 && !!token && !r.j.mfa_required);
    r = await panggil('GET', '/api/auth/mfa', { token });
    record('Status awal: belum aktif', r.status === 200 && r.j.data?.enabled === false && r.j.data?.available === true, JSON.stringify(r.j.data));

    r = await panggil('POST', '/api/auth/mfa/setup', { token, body: {} });
    const rahasia = r.j.data?.secret;
    record('Pemasangan memberi kunci base32 dan tautan otpauth', r.status === 200 && /^[A-Z2-7]{32}$/.test(rahasia || '') && (r.j.data?.otpauth || '').startsWith('otpauth://totp/'), (r.j.data?.otpauth || '').slice(0, 60));
    r = await panggil('POST', '/api/auth/mfa/enable', { token, body: { code: '000000' } });
    record('Kode salah saat mengaktifkan ditolak', r.status === 400, r.j.error);
    r = await panggil('POST', '/api/auth/mfa/enable', { token, body: { code: totp(rahasia) } });
    const pemulihan = r.j.data?.recovery_codes || [];
    record('Kode benar mengaktifkan dan memberi 8 kode pemulihan', r.status === 200 && pemulihan.length === 8, pemulihan[0]);
    const simpanan = A.psql(`select totp_secret || '|' || totp_enabled || '|' || jsonb_array_length(totp_recovery) from public.app_users where id = '${id}'`);
    record('Rahasia tersimpan terenkripsi (v1:...) dan kode pemulihan hanya sidiknya',
      simpanan.startsWith('v1:') && !simpanan.includes(rahasia) && simpanan.endsWith('|true|8') && !A.psql(`select totp_recovery::text from public.app_users where id = '${id}'`).includes(pemulihan[0]), simpanan.slice(0, 20));

    r = await masuk();
    const mfaToken = r.j.mfa_token;
    record('Setelah aktif, sandi benar tidak lagi memberi sesi: minta langkah kedua', r.status === 200 && r.j.mfa_required === true && !r.j.session && !!mfaToken);
    r = await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: mfaToken, code: '111111' } });
    record('Langkah kedua: kode salah ditolak', r.status === 401, r.j.error);
    await tungguLangkahBaru();
    const kodeKini = totp(rahasia);
    r = await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: mfaToken, code: kodeKini } });
    record('Langkah kedua: kode benar memberi sesi', r.status === 200 && !!r.j.session?.access_token);
    r = await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: (await masuk()).j.mfa_token, code: kodeKini } });
    record('Kode yang sama tidak bisa dipakai dua kali', r.status === 401, r.j.error);
    r = await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: (await masuk()).j.mfa_token, code: pemulihan[0].toLowerCase() } });
    const r2 = await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: (await masuk()).j.mfa_token, code: pemulihan[0] } });
    record('Kode pemulihan berlaku sekali (huruf kecil tetap diterima)', r.status === 200 && r2.status === 401, `${r.status}/${r2.status}`);
    r = await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: 'palsu.123.abc', code: totp(rahasia) } });
    record('Token langkah kedua palsu ditolak', r.status === 401, r.j.error);

    // ---------- Browser: halaman masuk dan kartu di Pengaturan ----------
    await tungguLangkahBaru();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', EMAIL);
    await p.fill('input[type="password"]', SANDI);
    await p.click('button[type="submit"]');
    await p.locator('[data-langkah-mfa]').waitFor({ timeout: 15000 });
    record('Browser: setelah sandi muncul langkah verifikasi dua langkah, belum masuk konsol', new URL(p.url()).pathname === '/login' && (await p.getByText('ADMIN CONSOLE').count()) === 0);
    await p.screenshot({ path: require('path').join(__dirname, 'screenshots', 'mfa-langkah-dua.png') }).catch(() => {});
    await p.getByLabel('Kode verifikasi').fill(totp(rahasia));
    await p.getByRole('button', { name: 'Verifikasi' }).click();
    await p.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    record('Browser: kode benar masuk ke konsol', new URL(p.url()).pathname === '/' && (await p.getByText('ADMIN CONSOLE').count()) > 0, new URL(p.url()).pathname);
    await p.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    const kartu = p.locator('[data-keamanan-akun]');
    await kartu.waitFor({ timeout: 15000 });
    record('Browser: kartu Verifikasi dua langkah di Pengaturan menyebut Aktif dan sisa kode', /Aktif/.test(await kartu.innerText()) && /Sisa kode pemulihan: 7 dari 8/.test(await kartu.innerText()), (await kartu.innerText()).replace(/\s+/g, ' ').slice(0, 120));
    await ctx.close();

    // ---------- Akun kedua: mematikan, pemasangan lewat layar, reset admin, batas ----------
    // Akun pertama sudah mengumpulkan 5 kegagalan yang disengaja di atas, dan
    // penghitung per akun mengunci percobaan berikutnya (perilaku yang benar).
    const EMAIL2 = `uji.mfa2.${CAP}@contoh.id`;
    dibuat.push(EMAIL2);
    const id2 = buatAkun(EMAIL2);
    const masuk2 = () => panggil('POST', '/api/auth/signin', { body: { email: EMAIL2, password: SANDI } });
    const awal2 = (await masuk2()).j.session?.access_token;
    const rahasia2 = (await panggil('POST', '/api/auth/mfa/setup', { token: awal2, body: {} })).j.data?.secret;
    await panggil('POST', '/api/auth/mfa/enable', { token: awal2, body: { code: totp(rahasia2) } });
    await tungguLangkahBaru();
    const sesi = (await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: (await masuk2()).j.mfa_token, code: totp(rahasia2) } })).j.session?.access_token;
    r = await panggil('POST', '/api/auth/mfa/disable', { token: sesi, body: { password: 'salah', code: totp(rahasia2) } });
    record('Mematikan butuh sandi benar', r.status === 400, r.j.error);
    await tungguLangkahBaru();
    r = await panggil('POST', '/api/auth/mfa/disable', { token: sesi, body: { password: SANDI, code: totp(rahasia2) } });
    const lagi = await masuk2();
    record('Dimatikan dengan sandi + kode: masuk kembali tanpa langkah kedua', r.status === 200 && !!lagi.j.session?.access_token && !lagi.j.mfa_required, `${r.status} ${r.j.error || ''}`);

    const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx2.addInitScript((t) => localStorage.setItem('kasir.auth.token.v1', t), lagi.j.session.access_token);
    const h = await ctx2.newPage();
    await h.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    await h.locator('[data-keamanan-akun]').waitFor({ timeout: 15000 });
    await h.getByRole('button', { name: /Aktifkan verifikasi dua langkah/ }).click();
    await h.locator('[data-kunci-mfa]').waitFor({ timeout: 10000 });
    const kunciLayar = (await h.locator('[data-kunci-mfa]').innerText()).replace(/\s/g, '');
    await h.getByLabel('Kode', { exact: true }).fill(totp(kunciLayar));
    await h.getByRole('button', { name: 'Aktifkan', exact: true }).click();
    await h.locator('[data-kode-pemulihan]').waitFor({ timeout: 10000 });
    const kodeLayar = await h.locator('[data-kode-pemulihan] li').count();
    const teksKartu = await h.locator('[data-keamanan-akun]').innerText();
    record('Saat kode pemulihan tampil, kartu sudah Aktif dan tombol aktifkan hilang',
      !/Belum aktif/.test(teksKartu) && (await h.getByRole('button', { name: /Aktifkan verifikasi dua langkah/ }).count()) === 0, teksKartu.replace(/\s+/g, ' ').slice(0, 90));
    await h.locator('[data-kode-pemulihan]').scrollIntoViewIfNeeded();
    await h.screenshot({ path: require('path').join(__dirname, 'screenshots', 'mfa-kode-pemulihan-hp.png') }).catch(() => {});
    const lebar = await h.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    record('HP: pemasangan lewat layar Pengaturan berhasil dan menampilkan 8 kode pemulihan tanpa gulir samping',
      kodeLayar === 8 && A.psql(`select totp_enabled::text from public.app_users where id = '${id2}'`) === 'true' && lebar[0] === lebar[1], `${kodeLayar} kode, ${lebar.join('/')}`);
    await ctx2.close();

    const mt = (await masuk2()).j.mfa_token;
    const st = [];
    for (let i = 0; i < 6; i += 1) st.push((await panggil('POST', '/api/auth/mfa/verify', { body: { mfa_token: mt, code: '00000' + i } })).status);
    // Akun ini sudah punya 1 kegagalan (matikan dengan sandi salah), jadi kunci jatuh pada kegagalan ke-5 akun itu.
    const kunciKe = st.indexOf(429);
    record('Lima kegagalan per akun: percobaan berikutnya dikunci (429)', kunciKe === 4 && st.slice(0, 4).every((x) => x === 401), st.join(','));

    const admin = await A.tokenAdmin();
    r = await panggil('POST', `/api/admin/users/${id2}/mfa/reset`, { token: admin, body: {} });
    record('Admin me-reset verifikasi dua langkah staf lain', r.status === 200 && A.psql(`select totp_enabled::text from public.app_users where id = '${id2}'`) === 'false', `${r.status}`);
  } catch (e) {
    record('Suite berjalan sampai selesai', false, e.stack || e.message);
  } finally {
    await browser.close();
    for (const e of dibuat) {
      A.psql(`delete from public.profiles where email = '${e}'`);
      A.psql(`delete from public.app_users where email = '${e}'`);
    }
  }
  ringkas();
})();
