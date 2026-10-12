import { describe, expect, it } from 'vitest';
import {
  PENGATURAN_BAWAAN,
  aksesBerhak,
  bacaTanda,
  bangunRantai,
  cookieBerlaku,
  daftarPlatform,
  gabungPengaturan,
  hitungKomisi,
  kodeAcak,
  kodeDasar,
  memuatTautan,
  normalisasiPengaturan,
  perbaruiCookie,
  pilihCalon,
  rapikanAkuisisi,
  tandatangani,
  tierUntukProduk,
  umurCookieDetik,
} from '../affiliate/inti.js';

const RAHASIA = 'rahasia-uji';

describe('pengaturan affiliate', () => {
  it('memakai nilai bawaan PRD untuk pengaturan kosong', () => {
    const s = gabungPengaturan({});
    expect(s.enabled).toBe(false);
    expect(s.access_mode).toBe('approved');
    expect(s.cookie_days).toBe(30);
    expect(s.general_cookie).toBe(true);
    expect(s.permanent).toBe(false);
    expect(s.commission).toEqual([{ type: 'percentage', value: 10 }]);
    expect(s.invite_days).toBe(7);
    expect(s.invite_daily_limit).toBe(20);
    expect(s.show_buyer_contact).toBe(false);
    expect(daftarPlatform(s.platforms).map((p) => p.key)).toEqual(['fb', 'ins', 'insto', 'what', 'email', 'line', 'tiktok']);
  });

  it('nilai tersimpan yang rusak jatuh ke bawaan saat dibaca', () => {
    const s = gabungPengaturan({ cookie_days: 'abc', commission: 'x', access_mode: 'semua' });
    expect(s.cookie_days).toBe(30);
    expect(s.commission).toEqual(PENGATURAN_BAWAAN.commission);
    expect(s.access_mode).toBe('approved');
  });

  it('menolak persen di atas 100 dengan pesan PRD (AC-8)', () => {
    const r = normalisasiPengaturan({ ...PENGATURAN_BAWAAN, commission: [{ type: 'percentage', value: 120 }] });
    expect(r.galat).toBe('Persentase komisi harus 0 sampai 100.');
  });

  it('menolak tier lebih dari 5 dan tier kosong', () => {
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, commission: [] }).galat).toMatch(/minimal 1 tier/);
    const enam = Array.from({ length: 6 }, () => ({ type: 'percentage', value: 1 }));
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, commission: enam }).galat).toMatch(/maksimal 5 tier/);
  });

  it('kolom angka yang dikosongkan ditolak, bukan dibaca sebagai 0 (selamanya atau komisi 0%)', () => {
    for (const kosong of ['', '  ', null, undefined, true]) {
      expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, cookie_days: kosong }).galat).toBe('Umur cookie harus 0 sampai 3.650 hari.');
      expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, commission: [{ type: 'percentage', value: kosong }] }).galat).toBe(
        'Tipe dan besar komisi wajib diisi.',
      );
    }
    // Angka sebagai teks tetap diterima, dan 0 yang memang diisi tetap berarti selamanya.
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, cookie_days: '45' }).pengaturan.cookie_days).toBe(45);
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, cookie_days: 0 }).pengaturan.cookie_days).toBe(0);
    // Komisi khusus produk yang kosong jatuh ke komisi bawaan toko, tidak menjadi 0%.
    expect(tierUntukProduk({ affiliate_commission: [{ type: 'percentage', value: null }] }, PENGATURAN_BAWAAN)).toEqual(PENGATURAN_BAWAAN.commission);
  });

  it('menolak umur cookie dan baris platform yang tidak sah', () => {
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, cookie_days: 4000 }).galat).toBe('Umur cookie harus 0 sampai 3.650 hari.');
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, platforms: 'fb;Facebook\nsalah sekali' }).galat).toBe(
      'Baris platform ke-2 tidak sah. Gunakan format kode;Nama.',
    );
    expect(normalisasiPengaturan({ ...PENGATURAN_BAWAAN, admin_copy_emails: 'a@b.co, bukan-email' }).galat).toBe(
      'Alamat salinan email tidak valid: bukan-email',
    );
  });

  it('menerima pengaturan sah dan merapikan angka', () => {
    const r = normalisasiPengaturan({ ...PENGATURAN_BAWAAN, enabled: true, cookie_days: '0', commission: [{ type: 'fixed', value: '5000' }] });
    expect(r.galat).toBeNull();
    expect(r.pengaturan.cookie_days).toBe(0);
    expect(r.pengaturan.commission).toEqual([{ type: 'fixed', value: 5000 }]);
  });
});

describe('akses berhak (FR-2)', () => {
  const aktif = { ...PENGATURAN_BAWAAN, enabled: true };
  it('mengikuti mode dan akses member', () => {
    expect(aksesBerhak({ ...aktif, access_mode: 'approved' }, 'default')).toBe(false);
    expect(aksesBerhak({ ...aktif, access_mode: 'approved' }, 'allowed')).toBe(true);
    expect(aksesBerhak({ ...aktif, access_mode: 'all' }, 'default')).toBe(true);
    expect(aksesBerhak({ ...aktif, access_mode: 'all' }, 'blocked')).toBe(false);
  });
  it('program mati berarti tidak ada yang berhak', () => {
    expect(aksesBerhak({ ...aktif, enabled: false }, 'allowed')).toBe(false);
  });
});

describe('cookie bertanda tangan (NFR-4, AC-16)', () => {
  it('tanda tangan yang sama terbaca kembali', () => {
    const data = perbaruiCookie(null, { affiliateId: 'a1', productId: 'p1', source: 'fb', media: 'story', kind: 'link' }, 1000);
    const nilai = tandatangani(data, RAHASIA);
    expect(bacaTanda(nilai, RAHASIA)).toEqual(data);
  });
  it('isi yang diubah tangan diabaikan', () => {
    const nilai = tandatangani(perbaruiCookie(null, { affiliateId: 'a1', kind: 'link' }, 1), RAHASIA);
    const [isi, tanda] = nilai.split('.');
    const palsu = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(isi, 'base64url').toString()), g: 'a2' })).toString('base64url');
    expect(bacaTanda(`${palsu}.${tanda}`, RAHASIA)).toBeNull();
    expect(bacaTanda(nilai, 'rahasia-lain')).toBeNull();
    expect(bacaTanda('sampah', RAHASIA)).toBeNull();
    expect(bacaTanda(undefined, RAHASIA)).toBeNull();
  });
  it('klik terakhir menimpa affiliate umum dan per produk, peta produk dibatasi 12', () => {
    let c = perbaruiCookie(null, { affiliateId: 'a1', productId: 'p1', kind: 'link' }, 1);
    c = perbaruiCookie(c, { affiliateId: 'a2', productId: 'p1', kind: 'link' }, 2);
    expect(c.g).toBe('a2');
    expect(c.p).toEqual([['p1', 'a2']]);
    for (let i = 0; i < 40; i += 1) c = perbaruiCookie(c, { affiliateId: 'a3', productId: `x${i}`, source: 'fb', media: `m${i}`, kind: 'link' }, 3);
    expect(c.p).toHaveLength(12);
    expect(c.p[0]).toEqual(['x39', 'a3']);
    // Akuisisi produk yang sudah terdorong keluar ikut dibuang.
    expect(Object.keys(c.a).sort()).toEqual(['*', ...c.p.map((e) => e[0])].sort());
  });
  it('cookie terisi penuh tetap di bawah batas 4096 byte browser', () => {
    const uuid = (n) => `${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;
    let c = null;
    for (let i = 0; i < 40; i += 1) {
      c = perbaruiCookie(c, { affiliateId: uuid(900 + i), productId: uuid(i), source: 's'.repeat(60), media: 'm'.repeat(90), kind: 'link' }, 1_760_000_000);
    }
    expect(`gnnk_aff=${tandatangani(c, RAHASIA)}`.length).toBeLessThan(3800);
    expect(c.a['*']).toEqual(['s'.repeat(20), 'm'.repeat(40)]);
  });
  it('parameter akuisisi mengikuti klik: klik tanpa parameter menghapus milik klik sebelumnya', () => {
    let c = perbaruiCookie(null, { affiliateId: 'A', source: 'fb', media: 'm1', kind: 'link' }, 1);
    expect(c.a['*']).toEqual(['fb', 'm1']);
    c = perbaruiCookie(c, { affiliateId: 'B', kind: 'link' }, 2);
    expect(c.g).toBe('B');
    expect(c.a['*']).toBeUndefined();
    c = perbaruiCookie(c, { affiliateId: 'A', productId: 'P1', source: 'what', media: 'g1', kind: 'link' }, 3);
    expect(c.a.P1).toEqual(['what', 'g1']);
    expect(c.a['*']).toEqual(['what', 'g1']);
  });
  it('undangan menyimpan id undangan, klik link biasa menghapusnya', () => {
    let c = perbaruiCookie(null, { affiliateId: 'a1', kind: 'undangan', invitationId: 'u1' }, 1);
    expect(c.k).toBe('undangan');
    expect(c.i).toBe('u1');
    c = perbaruiCookie(c, { affiliateId: 'a2', kind: 'link' }, 2);
    expect(c.k).toBe('link');
    expect(c.i).toBeUndefined();
  });
  it('parameter akuisisi dirapikan sama untuk klik dan cookie', () => {
    expect(rapikanAkuisisi(' FB ', 'grup crf/jatim')).toEqual({ source: 'fb', media: 'grup-crf-jatim' });
    expect(rapikanAkuisisi('', 'tanpa-sumber')).toEqual({ source: '', media: '' });
    expect(rapikanAkuisisi('<script>', 'x')).toEqual({ source: 'script', media: 'x' });
    const panjang = rapikanAkuisisi('s'.repeat(60), 'm'.repeat(90));
    expect([panjang.source.length, panjang.media.length]).toEqual([20, 40]);
  });
  it('server menolak cookie yang lebih tua dari umur cookie, 0 berarti selamanya', () => {
    const kini = 1_760_000_000;
    const umur = (hari) => perbaruiCookie(null, { affiliateId: 'a1', kind: 'link' }, kini - hari * 86400);
    expect(cookieBerlaku(umur(29), 30, kini)).toBe(true);
    expect(cookieBerlaku(umur(30), 30, kini)).toBe(true);
    expect(cookieBerlaku(umur(31), 30, kini)).toBe(false);
    expect(cookieBerlaku(umur(400), 0, kini)).toBe(true);
    expect(cookieBerlaku(umur(1), 1, kini)).toBe(true);
    expect(cookieBerlaku({ v: 1, g: 'a1' }, 30, kini)).toBe(false);
    expect(cookieBerlaku(null, 30, kini)).toBe(false);
  });
  it('umur cookie 30 hari dan 0 berarti selamanya (AC-6, AC-7)', () => {
    expect(umurCookieDetik(30)).toBe(30 * 86400);
    expect(umurCookieDetik(0)).toBeGreaterThanOrEqual(3650 * 86400);
  });
});

describe('pilih calon affiliate (FR-19)', () => {
  const s = { ...PENGATURAN_BAWAAN, enabled: true };
  const cookie = perbaruiCookie(perbaruiCookie(null, { affiliateId: 'A', productId: 'X', source: 'fb', media: 'm1', kind: 'link' }, 1), { affiliateId: 'A', kind: 'link' }, 2);

  it('cookie per produk lebih dulu, lalu cookie umum', () => {
    const c = pilihCalon({ pengaturan: s, pembeli: { id: 'P', referred_by: null }, cookie, productIds: ['X'] });
    expect(c[0]).toEqual({ affiliateId: 'A', source: 'link', productId: 'X', acquisition: { source: 'fb', media: 'm1' } });
  });
  it('pembeli sendiri tidak pernah menjadi calon (AC-21)', () => {
    const c = pilihCalon({ pengaturan: s, pembeli: { id: 'A', referred_by: null }, cookie, productIds: ['X'] });
    expect(c).toEqual([]);
  });
  it('kaitkan affiliasi memakai upline lebih dulu (AC-22)', () => {
    const c = pilihCalon({ pengaturan: { ...s, permanent: true }, pembeli: { id: 'P', referred_by: 'B' }, cookie, productIds: ['X'] });
    expect(c[0]).toMatchObject({ affiliateId: 'B', source: 'kaitan' });
  });
  it('general cookie mati dan produk lain berarti tanpa calon (AC-24)', () => {
    const c = pilihCalon({ pengaturan: { ...s, general_cookie: false }, pembeli: { id: 'P', referred_by: null }, cookie, productIds: ['Y'] });
    expect(c).toEqual([]);
  });
  it('akuisisi calon per produk tidak meminjam parameter klik affiliate lain', () => {
    let c = perbaruiCookie(null, { affiliateId: 'A', productId: 'X', kind: 'link' }, 1);
    c = perbaruiCookie(c, { affiliateId: 'B', source: 'fb', media: 'm9', kind: 'link' }, 2);
    const calon = pilihCalon({ pengaturan: s, pembeli: { id: 'P', referred_by: null }, cookie: c, productIds: ['X'] });
    expect(calon[0]).toEqual({ affiliateId: 'A', source: 'link', productId: 'X', acquisition: { source: '', media: '' } });
    expect(calon[1]).toEqual({ affiliateId: 'B', source: 'link', productId: null, acquisition: { source: 'fb', media: 'm9' } });
  });
  it('klik produk tetap bersumber link walau cookie terakhir dari undangan', () => {
    let c = perbaruiCookie(null, { affiliateId: 'A', productId: 'X', kind: 'link' }, 1);
    c = perbaruiCookie(c, { affiliateId: 'B', kind: 'undangan', invitationId: 'u1' }, 2);
    const calon = pilihCalon({ pengaturan: s, pembeli: { id: 'P', referred_by: null }, cookie: c, productIds: ['X'] });
    expect(calon.map((x) => [x.affiliateId, x.source])).toEqual([['A', 'link'], ['B', 'undangan']]);
  });
  it('tanpa cookie dan tanpa kaitan berarti tanpa calon', () => {
    expect(pilihCalon({ pengaturan: s, pembeli: { id: 'P', referred_by: 'B' }, cookie: null, productIds: ['X'] })).toEqual([]);
  });
});

describe('rantai upline (FR-22)', () => {
  const upline = new Map([['C', 'B'], ['B', 'A'], ['A', null]]);
  const semuaBerhak = () => true;
  it('tier 1 affiliate, tier berikutnya upline-nya', () => {
    expect(bangunRantai({ tier1: 'C', maksTier: 3, uplineDari: (id) => upline.get(id) ?? null, berhak: semuaBerhak, pembeliId: 'P' })).toEqual(['C', 'B', 'A']);
  });
  it('rantai berputar berhenti, tiap orang sekali (AC-31)', () => {
    const putar = new Map([['A', 'B'], ['B', 'A']]);
    expect(bangunRantai({ tier1: 'A', maksTier: 3, uplineDari: (id) => putar.get(id) ?? null, berhak: semuaBerhak, pembeliId: 'P' })).toEqual(['A', 'B']);
  });
  it('penerima tanpa akses dilewati tetapi rantai berlanjut (D-17)', () => {
    expect(bangunRantai({ tier1: 'C', maksTier: 3, uplineDari: (id) => upline.get(id) ?? null, berhak: (id) => id !== 'B', pembeliId: 'P' })).toEqual(['C', null, 'A']);
  });
  it('pembeli tidak menerima komisi dari pembeliannya sendiri walau ada di rantai', () => {
    expect(bangunRantai({ tier1: 'C', maksTier: 3, uplineDari: (id) => upline.get(id) ?? null, berhak: semuaBerhak, pembeliId: 'B' })).toEqual(['C', null, 'A']);
  });
});

describe('hitung komisi (AC-26 sampai AC-31)', () => {
  const persen = (v) => [{ type: 'percentage', value: v }];
  it('10% dari Rp 655.000, ongkir tidak ikut (AC-26)', () => {
    const rows = hitungKomisi({ items: [{ id: 'i1', product_id: 'p1', price: 655000, qty: 1 }], discount: 0, tierPerItem: () => persen(10), rantai: ['A'] });
    expect(rows).toEqual([
      { order_item_id: 'i1', product_id: 'p1', affiliate_id: 'A', tier: 1, base_amount: 655000, rate_type: 'percentage', rate_value: 10, commission: 65500 },
    ]);
  });
  it('diskon pesanan dibagi sebanding nilai barang (AC-27)', () => {
    const rows = hitungKomisi({
      items: [
        { id: 'i1', product_id: 'p1', price: 100000, qty: 1 },
        { id: 'i2', product_id: 'p2', price: 300000, qty: 1 },
      ],
      discount: 40000,
      tierPerItem: () => persen(10),
      rantai: ['A'],
    });
    expect(rows.map((r) => r.commission)).toEqual([9000, 27000]);
    expect(rows.map((r) => r.base_amount)).toEqual([90000, 270000]);
  });
  it('nilai tetap dikali jumlah barang (AC-28)', () => {
    const rows = hitungKomisi({ items: [{ id: 'i1', product_id: 'p1', price: 50000, qty: 3 }], discount: 0, tierPerItem: () => [{ type: 'fixed', value: 5000 }], rantai: ['A'] });
    expect(rows[0].commission).toBe(15000);
  });
  it('komisi khusus produk mengalahkan bawaan (AC-29)', () => {
    const pengaturan = { ...PENGATURAN_BAWAAN, commission: persen(10) };
    expect(tierUntukProduk({ affiliate_commission: persen(5) }, pengaturan)).toEqual(persen(5));
    expect(tierUntukProduk({ affiliate_commission: [] }, pengaturan)).toEqual(persen(10));
    expect(tierUntukProduk({ affiliate_commission: null }, pengaturan)).toEqual(persen(10));
  });
  it('dua tier: C 10%, B 2% (AC-30)', () => {
    const rows = hitungKomisi({ items: [{ id: 'i1', product_id: 'p1', price: 100000, qty: 1 }], discount: 0, tierPerItem: () => [...persen(10), ...persen(2)], rantai: ['C', 'B', 'A'] });
    expect(rows.map((r) => [r.affiliate_id, r.tier, r.commission])).toEqual([
      ['C', 1, 10000],
      ['B', 2, 2000],
    ]);
  });
  it('tier yang dilewati tidak menghasilkan komisi, dan komisi 0 tidak dicatat', () => {
    const rows = hitungKomisi({ items: [{ id: 'i1', product_id: 'p1', price: 9, qty: 1 }], discount: 0, tierPerItem: () => [...persen(10), ...persen(50)], rantai: ['C', null] });
    expect(rows).toEqual([]);
  });
  it('dibulatkan ke bawah per rupiah', () => {
    const rows = hitungKomisi({ items: [{ id: 'i1', product_id: 'p1', price: 99999, qty: 1 }], discount: 0, tierPerItem: () => persen(10), rantai: ['A'] });
    expect(rows[0].commission).toBe(9999);
  });
});

describe('kode affiliate (FR-11, AC-9)', () => {
  it('huruf dari nama depan, maksimal 6, huruf besar', () => {
    expect(kodeDasar('Andi Saputra')).toBe('ANDI');
    expect(kodeDasar('Muhammad Rizky')).toBe('MUHAMM');
    expect(kodeDasar('Élodie')).toBe('ELODIE');
    expect(kodeDasar('  ')).toBe('GNNK');
    expect(kodeDasar('X')).toBe('GNNK');
  });
  it('ditambah angka sejumlah digit', () => {
    expect(kodeAcak('Andi Saputra', 2, () => 0.243)).toBe('ANDI24');
    expect(kodeAcak('Andi Saputra', 3, () => 0.05)).toBe('ANDI050');
    expect(kodeAcak('Andi', 2, () => 0)).toMatch(/^ANDI\d{2}$/);
  });
});

describe('isi undangan tidak boleh membawa tautan', () => {
  it('mengenali alamat web dalam berbagai bentuk', () => {
    for (const teks of ['Promo di https://contoh.test/hadiah', 'HTTP://CONTOH.TEST', 'cek www.contoh.test ya', 'bit.ly/hadiah', 'kunjungi contoh-lain.com sekarang', 'toko.co.id', 't.me/grup', 'wa.me/628123']) {
      expect(memuatTautan(teks), teks).toBe(true);
    }
  });
  it('tidak menuduh teks biasa, harga, gelar, dan alamat email', () => {
    for (const teks of ['Gear set CRF150 Rp 955.000, kualitas no.1! Cek ya.', 'Pak Budi, S.Kom.', 'Jl. Merdeka No.5', 'hubungi budi@gmail.com', 'v2.0 sudah rilis', '', null, undefined]) {
      expect(memuatTautan(teks), String(teks)).toBe(false);
    }
  });
});
