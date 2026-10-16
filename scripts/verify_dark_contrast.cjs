// Keterbacaan teks di mode gelap, seluruh isi layar.
//
// verify_dark_mode yang sudah ada hanya memeriksa kontras tombol di header
// beberapa rute. Sisa isi layar tidak pernah diperiksa, dan di sana teks
// redup jatuh jauh di bawah ambang: text-ink-500 2,33:1, text-brand-600
// 2,8:1, cip varian POS 2,1:1.
//
// Yang diukur: rasio kontras WCAG antara warna teks sebuah elemen dan latar
// efektifnya - latar elemen itu sendiri ditumpuk ke atas latar para induknya.
// Latar elemen sendiri WAJIB ikut: lencana dan tombol punya latar sendiri,
// dan membandingkannya ke latar induk menuduh yang benar.
//
// Ambangnya 3:1. Itu batas WCAG untuk teks besar, dan dipakai di sini sebagai
// lantai keterbacaan, bukan sebagai sertifikasi AA.
const { chromium } = require('playwright');
const { BASE_URL, trackApi, loginAdmin } = require('./lib/harness.cjs');

const RUTE_ADMIN = ['/', '/menu', '/orders', '/returns', '/customers', '/products', '/suppliers',
  '/purchases', '/promos', '/shifts', '/stock-mutation', '/stock-opname', '/feedback',
  '/expenses', '/reports', '/users', '/settings'];
const RUTE_TOKO = ['/toko', '/toko/keranjang', '/toko/masuk', '/toko/lupa-sandi',
  '/toko/kebijakan-privasi', '/toko/syarat-ketentuan', '/toko/checkout', '/toko/selesai'];

const PERIKSA = () => {
  const urai = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const timpa = (atas, bawah) => {
    if (!atas) return bawah;
    if (atas.a >= 1) return atas;
    const a = atas.a;
    return {
      r: atas.r * a + bawah.r * (1 - a),
      g: atas.g * a + bawah.g * (1 - a),
      b: atas.b * a + bawah.b * (1 - a),
      a: 1,
    };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const rasio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const latarEfektif = (el) => {
    let hasil = { r: 255, g: 255, b: 255, a: 1 };
    const tumpuk = [];
    for (let p = el; p; p = p.parentElement) tumpuk.push(p);
    for (let i = tumpuk.length - 1; i >= 0; i -= 1) {
      const c = urai(getComputedStyle(tumpuk[i]).backgroundColor);
      if (c && c.a > 0) hasil = timpa(c, hasil);
    }
    return hasil;
  };

  const gagal = [];
  let diperiksa = 0;
  document.querySelectorAll('body *').forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 8 || b.height < 8) return;
    if (b.bottom < 0 || b.top > innerHeight * 3) return;
    diperiksa += 1;
    if (b.width * b.height < 150) return;
    // Hanya elemen yang memuat teksnya sendiri, bukan pembungkusnya.
    const punyaTeks = Array.from(el.childNodes)
      .some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!punyaTeks) return;
    const cs = getComputedStyle(el);
    const fg = urai(cs.color);
    if (!fg || fg.a < 0.3) return;
    const bg = latarEfektif(el);
    const r = rasio(timpa(fg, bg), bg);
    if (r >= 3) return;
    gagal.push({
      rasio: Math.round(r * 100) / 100,
      teks: (el.innerText || '').trim().slice(0, 22),
      fg: cs.color,
      bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      kelas: String(el.className || '').slice(0, 46),
    });
  });
  return { gelapAktif: document.documentElement.classList.contains('dark'), diperiksa, gagal };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  trackApi(page);
  const hasil = [];
  const record = (n, p, d) => {
    hasil.push({ n, p });
    console.log((p ? 'PASS  ' : 'FAIL  ') + n + (d ? ' — ' + d : ''));
  };

  try {
    await loginAdmin(page, { theme: 'dark' });

    for (const rute of [...RUTE_ADMIN, ...RUTE_TOKO]) {
      const publik = rute.startsWith('/toko');
      // Navigasi kadang digugurkan saat halaman sebelumnya masih menyinkron
      // (net::ERR_ABORTED). Itu bukan cacat produk, jadi dicoba ulang.
      for (let coba = 0; coba < 3; coba += 1) {
        try {
          await page.goto(BASE_URL + rute, { waitUntil: 'domcontentloaded' });
          break;
        } catch (e) {
          if (coba === 2) throw e;
          await page.waitForTimeout(1500);
        }
      }
      await page
        .waitForSelector(publik ? 'main' : '[class*="max-w-[1400px]"]', { timeout: 45000 })
        .catch(() => {});
      await page.waitForTimeout(2200);
      const m = await page.evaluate(PERIKSA);
      record(rute + ': mode gelap aktif', m.gelapAktif === true, 'dark=' + m.gelapAktif);
      record(rute + ': pengukuran sah', m.diperiksa > 30, 'elemen diperiksa=' + m.diperiksa);
      record(rute + ': teks kontras >= 3:1', m.gagal.length === 0,
        m.gagal.length + ' teks, mis. ' + m.gagal.slice(0, 3)
          .map((x) => x.rasio + ':1 "' + x.teks + '" ' + x.fg + ' di ' + x.bg + ' [' + x.kelas + ']')
          .join(' ; '));
    }
  } catch (e) {
    console.log('ERROR: ' + e.message);
    record('Suite selesai tanpa galat', false, e.message.slice(0, 120));
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('--- RINGKASAN ---');
  const pass = hasil.filter((h) => h.p).length;
  console.log(pass + '/' + hasil.length + ' lolos');
  process.exitCode = pass === hasil.length ? 0 : 1;
})();
