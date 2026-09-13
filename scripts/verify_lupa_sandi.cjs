// Verifikasi halaman masuk ala Shopee (tanpa navbar/footer, tidak bisa digulir),
// masuk dengan nomor HP / email, lupa kata sandi (kode 6 digit lewat email),
// dan lokasi toko di kartu produk yang bisa diatur di Pengaturan.
//
// Butuh server lokal TANPA SMTP: email disimpan ke server/.outbox, dari sana kode dibaca.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { loginAdmin, trackApi, BASE_URL, DB_PASSWORD } = require('./lib/harness.cjs');

const BASE = BASE_URL;
const OUTBOX = path.join(__dirname, '..', 'server', '.outbox');
const sql = (q) =>
  execFileSync('C:/Program Files/PostgreSQL/16/bin/psql.exe', ['-U', 'kasir_user', '-h', '127.0.0.1', '-d', 'kasir', '-tAqc', q], {
    env: { ...process.env, PGPASSWORD: DB_PASSWORD },
    encoding: 'utf8',
  }).trim();
const first = (q) => sql(q).split('\n')[0].trim();

const hasil = [];
function record(nama, ok, info = '') {
  hasil.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nama}${info ? ' — ' + info : ''}`);
}

const TS = Date.now().toString().slice(-7);
const EMAIL = `uji.sandi.${TS}@contoh.id`;
const HP = `0813${TS}`;
const KUNCI_TOKEN = 'tokoku.customer.token.v1';

function isiOutbox() {
  return fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.json')).sort() : [];
}
function kodeTerbaru(sebelum) {
  const baru = isiOutbox().filter((f) => !sebelum.includes(f));
  for (const f of baru.reverse()) {
    const m = JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8'));
    const to = (m.to || []).map((t) => t.address || t).join(',');
    const kode = /(\d{6})/.exec(m.subject || '');
    if (to.includes(EMAIL) && kode) return kode[1];
  }
  return null;
}

(async () => {
  const S = first('select id from public.stores order by created_at limit 1;');
  const kotaAwal = first(`select coalesce(shop_city, '') from public.stores where id='${S}';`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const t = await ctx.newPage();
  t.setDefaultTimeout(20000);
  t.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
  const api = (url, body) =>
    t.evaluate(
      async ([u, b]) => {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [url, body],
    );

  try {
    await t.goto(BASE + '/toko/masuk', { waitUntil: 'networkidle' });
    const daftar = await api('/api/customer/signup', {
      store_id: S, name: 'Uji Sandi', email: EMAIL, phone: HP, password: 'lama123', privacy_accepted: true,
    });
    record('Akun pembeli uji dibuat', daftar.status === 200, String(daftar.status));

    // ---------- Tampilan halaman masuk ----------
    await t.reload({ waitUntil: 'networkidle' });
    await t.waitForTimeout(800);
    record('Halaman masuk tanpa navbar dan footer',
      (await t.locator('header').count()) === 0 && (await t.locator('footer').count()) === 0);
    const gulir = await t.evaluate(() => {
      window.scrollTo(0, 600);
      return {
        y: window.scrollY,
        tinggi: document.documentElement.scrollHeight,
        layar: window.innerHeight,
        overflow: getComputedStyle(document.documentElement).overflow,
      };
    });
    record('Satu layar penuh, tidak bisa digulir', gulir.y === 0 && gulir.overflow === 'hidden', JSON.stringify(gulir));
    const teks = await t.locator('body').innerText();
    record('Opsi masuk hanya No. HP/Email dan Google (tanpa Facebook)',
      (await t.getByLabel('No. Handphone/Email').count()) === 1 && /Google/.test(teks) && !/Facebook/i.test(teks));
    const tombol = t.locator('main form button[type="submit"]');
    record('Tombol MASUK nonaktif selama kolom kosong', await tombol.isDisabled());
    await t.screenshot({ path: path.join(__dirname, 'screenshots', 'lupa_masuk.png') }).catch(() => {});

    // ---------- Masuk dengan nomor HP ----------
    await t.getByLabel('No. Handphone/Email').fill(HP.replace(/^0/, '+62 '));
    await t.getByLabel('Kata sandi').fill('salah999');
    await tombol.click();
    await t.waitForTimeout(1200);
    record('Kata sandi salah menampilkan pesan', /salah/i.test(await t.locator('[role="alert"]').allInnerTexts().then((x) => x.join(' '))));
    await t.getByLabel('Kata sandi').fill('lama123');
    await tombol.click();
    await t.waitForURL((u) => u.pathname.includes('/toko/akun'), { timeout: 15000 }).catch(() => {});
    record('Masuk dengan nomor HP (format +62) berhasil', t.url().includes('/toko/akun'), t.url());
    const lewatEmail = await api('/api/customer/signin', { store_id: S, identifier: EMAIL, password: 'lama123' });
    record('Masuk dengan email berhasil', lewatEmail.status === 200, String(lewatEmail.status));
    await t.evaluate((k) => localStorage.removeItem(k), KUNCI_TOKEN);

    // ---------- Daftar: nomor HP ganda ditolak ----------
    await t.goto(BASE + '/toko/masuk?tab=daftar', { waitUntil: 'networkidle' });
    await t.waitForTimeout(600);
    await t.getByLabel('Nama lengkap').fill('Uji Ganda');
    await t.getByLabel('Email', { exact: true }).fill(`uji.sandi.${TS}b@contoh.id`);
    await t.getByLabel('Nomor HP / WhatsApp').fill(HP);
    await t.getByLabel('Kata sandi').fill('rahasia1');
    await t.locator('main form input[type="checkbox"]').check();
    await t.locator('main form button[type="submit"]').click();
    await t.waitForTimeout(1200);
    record('Daftar dengan nomor HP yang sudah dipakai ditolak',
      /sudah terdaftar/i.test((await t.locator('[role="alert"]').allInnerTexts()).join(' ')));

    // ---------- Lupa kata sandi ----------
    await t.getByRole('button', { name: 'Masuk', exact: true }).click();
    await t.getByLabel('No. Handphone/Email').fill(HP);
    await t.getByRole('link', { name: 'Lupa Kata Sandi?' }).click();
    await t.waitForURL((u) => u.pathname.includes('/toko/lupa-sandi'), { timeout: 10000 }).catch(() => {});
    await t.waitForTimeout(600);
    record('Tautan "Lupa Kata Sandi?" membuka halaman reset dengan nomor terisi',
      t.url().includes('/toko/lupa-sandi') && (await t.getByLabel('No. Handphone/Email').inputValue()) === HP);
    record('Halaman reset tanpa navbar dan footer',
      (await t.locator('header').count()) === 0 && (await t.locator('footer').count()) === 0);
    const sebelum = isiOutbox();
    await t.getByRole('button', { name: /Berikutnya/i }).click();
    await t.getByLabel('Kode verifikasi').waitFor({ timeout: 10000 });
    await t.waitForTimeout(500);
    const kode = kodeTerbaru(sebelum);
    record('Kode 6 digit dikirim ke email akun', !!kode, kode ? 'kode diterima' : 'tidak ada email');
    record('Kirim ulang kode menunggu hitung mundur', /Kirim ulang kode dalam \d+ detik/.test(await t.locator('body').innerText()));
    await t.screenshot({ path: path.join(__dirname, 'screenshots', 'lupa_kode.png') }).catch(() => {});

    await t.getByLabel('Kode verifikasi').fill(kode === '000000' ? '111111' : '000000');
    await t.getByRole('button', { name: /Berikutnya/i }).click();
    await t.waitForTimeout(1000);
    record('Kode salah ditolak dengan sisa percobaan', /Sisa 4 percobaan/.test(await t.locator('body').innerText()));
    await t.getByLabel('Kode verifikasi').fill(kode || '');
    await t.getByRole('button', { name: /Berikutnya/i }).click();
    await t.getByLabel('Kata sandi baru', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
    record('Kode benar lanjut ke kata sandi baru', (await t.getByLabel('Kata sandi baru', { exact: true }).count()) === 1);
    await t.getByLabel('Kata sandi baru', { exact: true }).fill('baru456');
    await t.getByLabel('Ulangi kata sandi baru').fill('baru457');
    await t.getByRole('button', { name: /Simpan/i }).click();
    await t.waitForTimeout(500);
    record('Kata sandi yang tidak sama ditolak', /belum sama/.test(await t.locator('body').innerText()));
    await t.getByLabel('Ulangi kata sandi baru').fill('baru456');
    await t.getByRole('button', { name: /Simpan/i }).click();
    await t.getByText('Kata Sandi Diperbarui').waitFor({ timeout: 10000 }).catch(() => {});
    record('Kata sandi tersimpan dan langsung masuk',
      (await t.getByText('Kata Sandi Diperbarui').count()) === 1 && !!(await t.evaluate((k) => localStorage.getItem(k), KUNCI_TOKEN)));
    await t.getByRole('button', { name: /Lanjut Belanja/i }).click();
    await t.waitForURL((u) => u.pathname.includes('/toko/akun'), { timeout: 10000 }).catch(() => {});
    record('Lanjut Belanja membuka akun', t.url().includes('/toko/akun'), t.url());

    const lama = await api('/api/customer/signin', { store_id: S, identifier: EMAIL, password: 'lama123' });
    const baru = await api('/api/customer/signin', { store_id: S, identifier: HP, password: 'baru456' });
    record('Kata sandi lama tidak berlaku, yang baru berlaku', lama.status === 401 && baru.status === 200, `${lama.status}/${baru.status}`);
    const ulangKode = await api('/api/customer/password/reset', { store_id: S, identifier: HP, code: kode, password: 'lagi789' });
    record('Kode yang sudah dipakai tidak bisa dipakai lagi', ulangKode.status === 400, String(ulangKode.status));
    const sebelum2 = isiOutbox();
    const hantu = await api('/api/customer/password/forgot', { store_id: S, identifier: 'tidak.ada.' + TS + '@contoh.id' });
    record('Akun yang tidak ada dijawab sama (tidak bisa ditebak) dan tidak mengirim email',
      hantu.status === 200 && isiOutbox().length === sebelum2.length, String(hantu.status));

    // ---------- Lokasi toko di kartu ----------
    sql(`update public.stores set shop_city = null where id='${S}';`);
    await t.goto(BASE + '/toko?semua=1', { waitUntil: 'networkidle' });
    await t.waitForTimeout(1200);
    const kartu1 = await t.locator('a[data-kartu-produk]').first().innerText();
    record('Kartu hasil cari menampilkan lokasi contoh', /Kota Jakarta Barat/.test(kartu1));
    sql(`update public.stores set shop_city = 'Kota Bekasi' where id='${S}';`);
    await t.reload({ waitUntil: 'networkidle' });
    await t.waitForTimeout(1200);
    record('Lokasi dari Pengaturan tampil di kartu', /Kota Bekasi/.test(await t.locator('a[data-kartu-produk]').first().innerText()));

    const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    trackApi(admin);
    await loginAdmin(admin);
    await admin.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {});
    await admin.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    await admin.waitForTimeout(1500);
    const kolomKota = admin.getByLabel('Lokasi toko (kota)');
    record('Pengaturan > Toko Online punya kolom "Lokasi toko (kota)"',
      (await kolomKota.count()) === 1 && (await kolomKota.inputValue()) === 'Kota Bekasi');
  } catch (e) {
    record('Skrip berjalan tanpa error', false, e.message.split('\n').slice(0, 3).join(' | '));
  } finally {
    sql(`update public.stores set shop_city = ${kotaAwal ? `'${kotaAwal.replace(/'/g, "''")}'` : 'null'} where id='${S}';`);
    sql(`delete from public.customers where email like 'uji.sandi.%@contoh.id';`);
    sql(`delete from public.profiles where email like 'uji.sandi.%@contoh.id';`);
    sql(`delete from public.app_users where email like 'uji.sandi.%@contoh.id';`);
    await browser.close();
    const lulus = hasil.filter(Boolean).length;
    console.log(`\n${lulus}/${hasil.length} lulus`);
    process.exit(lulus === hasil.length ? 0 : 1);
  }
})();
