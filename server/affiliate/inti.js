// Inti program affiliate: fungsi murni tanpa basis data, supaya aturan Sejoli
// yang dipakai (docs/sejoli-referensi.md) teruji satu per satu.
import crypto from 'node:crypto';

export const TEKS_TANPA_AKSES = 'Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.';

export const PENGATURAN_BAWAAN = Object.freeze({
  enabled: false,
  access_mode: 'approved',
  no_access_text: TEKS_TANPA_AKSES,
  cookie_days: 30,
  general_cookie: true,
  permanent: false,
  commission: [{ type: 'percentage', value: 10 }],
  downline_depth: 1,
  upline_depth: 1,
  show_downline_contact: false,
  show_buyer_contact: false,
  invite_days: 7,
  invite_daily_limit: 20,
  platforms: 'fb;Facebook\nins;Instagram\ninsto;Instagram Story\nwhat;WhatsApp\nemail;Email\nline;Line\ntiktok;TikTok',
  email_new_order: true,
  email_commission: true,
  email_paid: true,
  admin_copy_emails: '',
});

const MAKS_TIER = 5;
const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLA_KODE_PLATFORM = /^[a-z0-9_-]{1,20}$/;

/**
 * Angka dari isian formulir. Kosong, null, dan selain angka atau teks angka
 * menjadi NaN, karena Number('') dan Number(null) bernilai 0: kolom umur cookie
 * yang dikosongkan diam-diam menjadi "selamanya" dan komisi kosong menjadi 0%.
 */
function angkaIsian(nilai) {
  if (typeof nilai === 'number') return nilai;
  if (typeof nilai === 'string' && nilai.trim() !== '') return Number(nilai);
  return NaN;
}

function bulatAntara(nilai, min, max) {
  const n = angkaIsian(nilai);
  if (!Number.isFinite(n)) return null;
  const b = Math.trunc(n);
  return b < min || b > max ? null : b;
}

function benar(nilai, cadangan) {
  return typeof nilai === 'boolean' ? nilai : cadangan;
}

/** Tier komisi yang sah, atau pesan galatnya. */
function periksaTier(daftar) {
  if (!Array.isArray(daftar) || daftar.length === 0) return { galat: 'Komisi bawaan minimal 1 tier.' };
  if (daftar.length > MAKS_TIER) return { galat: `Komisi maksimal ${MAKS_TIER} tier.` };
  const tier = [];
  for (const t of daftar) {
    const type = t?.type === 'fixed' ? 'fixed' : t?.type === 'percentage' ? 'percentage' : null;
    const value = angkaIsian(t?.value);
    if (!type || !Number.isFinite(value)) return { galat: 'Tipe dan besar komisi wajib diisi.' };
    if (type === 'percentage' && (value < 0 || value > 100)) return { galat: 'Persentase komisi harus 0 sampai 100.' };
    if (type === 'fixed' && (value < 0 || value > 100_000_000)) return { galat: 'Nilai tetap komisi harus 0 sampai 100.000.000.' };
    tier.push({ type, value });
  }
  return { tier };
}

/** Baris `kode;Nama` menjadi daftar platform akuisisi. Baris tidak sah dilewati. */
export function daftarPlatform(teks) {
  return String(teks ?? '')
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const [key, ...sisa] = b.split(';');
      return { key: (key ?? '').trim().toLowerCase(), label: sisa.join(';').trim() };
    })
    .filter((p) => POLA_KODE_PLATFORM.test(p.key) && p.label);
}

/**
 * Pengaturan dari admin, diperiksa ketat (PUT). Mengembalikan pengaturan yang
 * sudah dirapikan, atau galat pertama dengan pesan PRD.
 */
export function normalisasiPengaturan(masukan) {
  const m = masukan && typeof masukan === 'object' ? masukan : {};
  const tier = periksaTier(m.commission);
  if (tier.galat) return { pengaturan: null, galat: tier.galat };
  const cookie = bulatAntara(m.cookie_days, 0, 3650);
  if (cookie === null) return { pengaturan: null, galat: 'Umur cookie harus 0 sampai 3.650 hari.' };
  const bawah = bulatAntara(m.downline_depth, 1, 10);
  const atas = bulatAntara(m.upline_depth, 1, 10);
  if (bawah === null || atas === null) return { pengaturan: null, galat: 'Kedalaman jaringan harus 1 sampai 10.' };
  const hari = bulatAntara(m.invite_days, 1, 90);
  if (hari === null) return { pengaturan: null, galat: 'Masa berlaku undangan harus 1 sampai 90 hari.' };
  const batas = bulatAntara(m.invite_daily_limit, 1, 200);
  if (batas === null) return { pengaturan: null, galat: 'Batas undangan per hari harus 1 sampai 200.' };
  if (m.access_mode !== 'all' && m.access_mode !== 'approved') return { pengaturan: null, galat: 'Pilih siapa yang bisa menjadi affiliate.' };
  const teks = String(m.no_access_text ?? '').trim();
  if (teks.length > 1000) return { pengaturan: null, galat: 'Pesan tanpa akses maksimal 1.000 karakter.' };

  const baris = String(m.platforms ?? '').split(/\r?\n/);
  const terisi = baris.map((b) => b.trim()).filter(Boolean);
  if (terisi.length > 30) return { pengaturan: null, galat: 'Daftar platform maksimal 30 baris.' };
  for (let i = 0; i < terisi.length; i += 1) {
    const [key, ...sisa] = terisi[i].split(';');
    const label = sisa.join(';').trim();
    if (!POLA_KODE_PLATFORM.test((key ?? '').trim().toLowerCase()) || !label || label.length > 40) {
      return { pengaturan: null, galat: `Baris platform ke-${i + 1} tidak sah. Gunakan format kode;Nama.` };
    }
  }

  const salinan = String(m.admin_copy_emails ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (salinan.length > 5) return { pengaturan: null, galat: 'Salinan email maksimal 5 alamat.' };
  const salah = salinan.find((e) => !POLA_EMAIL.test(e));
  if (salah) return { pengaturan: null, galat: `Alamat salinan email tidak valid: ${salah}` };

  return {
    galat: null,
    pengaturan: {
      enabled: benar(m.enabled, false),
      access_mode: m.access_mode,
      no_access_text: teks || TEKS_TANPA_AKSES,
      cookie_days: cookie,
      general_cookie: benar(m.general_cookie, true),
      permanent: benar(m.permanent, false),
      commission: tier.tier,
      downline_depth: bawah,
      upline_depth: atas,
      show_downline_contact: benar(m.show_downline_contact, false),
      show_buyer_contact: benar(m.show_buyer_contact, false),
      invite_days: hari,
      invite_daily_limit: batas,
      platforms: terisi.join('\n'),
      email_new_order: benar(m.email_new_order, true),
      email_commission: benar(m.email_commission, true),
      email_paid: benar(m.email_paid, true),
      admin_copy_emails: salinan.join(', '),
    },
  };
}

/** Pengaturan tersimpan digabung bawaan secara longgar: nilai rusak jatuh ke bawaan. */
export function gabungPengaturan(tersimpan) {
  const t = tersimpan && typeof tersimpan === 'object' ? tersimpan : {};
  const hasil = { ...PENGATURAN_BAWAAN, commission: PENGATURAN_BAWAAN.commission.map((x) => ({ ...x })) };
  for (const kunci of Object.keys(PENGATURAN_BAWAAN)) {
    if (!(kunci in t)) continue;
    const coba = normalisasiPengaturan({ ...hasil, [kunci]: t[kunci] });
    if (!coba.galat) hasil[kunci] = coba.pengaturan[kunci];
  }
  return hasil;
}

/** Berhak menjadi affiliate: program aktif dan (diizinkan, atau ikut pengaturan dengan mode semua). */
export function aksesBerhak(pengaturan, akses) {
  if (!pengaturan?.enabled) return false;
  if (akses === 'blocked') return false;
  if (akses === 'allowed') return true;
  return pengaturan.access_mode === 'all';
}

// ---------------------------------------------------------------------------
// Cookie atribusi

export const NAMA_COOKIE = 'gnnk_aff';
// Browser membuang cookie di atas 4096 byte tanpa pesan. 12 produk dengan
// parameter terpanjang menghasilkan sekitar 3,3 KB setelah ditandatangani.
const MAKS_PRODUK_COOKIE = 12;
const MAKS_SUMBER = 20;
const MAKS_MEDIA = 40;

/**
 * Parameter akuisisi yang rapi: kode platform (huruf kecil, maks 20) dan ID
 * (maks 40). Dipakai klik dan cookie supaya baris klik dan pesanan memakai
 * nilai yang persis sama dan bisa dijumlahkan bersama. Tanpa sumber, ID diabaikan.
 */
export function rapikanAkuisisi(sumber, media) {
  const source = String(sumber ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, MAKS_SUMBER);
  return { source, media: source ? String(media ?? '').trim().replace(/[^\w-]/g, '-').slice(0, MAKS_MEDIA) : '' };
}

/**
 * Isi cookie setelah satu klik. Sejoli: affiliate umum (`g`) selalu ditimpa
 * klik terakhir dan affiliate per produk (`p`) ditimpa untuk produk itu.
 * Parameter akuisisi (`a`) mengikuti kliknya: `*` milik klik terakhir, kunci
 * produk milik klik terakhir atas produk itu. Klik tanpa `utm_source`
 * menghapusnya, supaya parameter satu affiliate tidak menempel ke pesanan
 * affiliate lain.
 */
export function perbaruiCookie(lama, { affiliateId, productId = null, source = '', media = '', kind = 'link', invitationId = null }, detik = Math.floor(Date.now() / 1000)) {
  const dasar = lama && typeof lama === 'object' ? lama : {};
  const p = (Array.isArray(dasar.p) ? dasar.p : []).filter((e) => Array.isArray(e) && e[0] !== productId);
  if (productId) p.unshift([productId, affiliateId]);
  const produk = p.slice(0, MAKS_PRODUK_COOKIE);

  const lamaA = dasar.a && typeof dasar.a === 'object' ? dasar.a : {};
  const a = {};
  for (const [pid] of produk) if (Array.isArray(lamaA[pid])) a[pid] = lamaA[pid];
  const rapi = rapikanAkuisisi(source, media);
  const akuisisi = rapi.source ? [rapi.source, rapi.media] : null;
  for (const kunci of productId ? [productId, '*'] : ['*']) {
    if (akuisisi) a[kunci] = akuisisi;
    else delete a[kunci];
  }

  const hasil = { v: 1, g: affiliateId, k: kind === 'undangan' ? 'undangan' : 'link', p: produk, a, t: detik };
  if (kind === 'undangan' && invitationId) hasil.i = invitationId;
  return hasil;
}

export function tandatangani(data, rahasia) {
  const isi = Buffer.from(JSON.stringify(data)).toString('base64url');
  const tanda = crypto.createHmac('sha256', rahasia).update(isi).digest('base64url');
  return `${isi}.${tanda}`;
}

/** Isi cookie bila tanda tangannya cocok, selain itu null (cookie palsu diabaikan). */
export function bacaTanda(nilai, rahasia) {
  if (typeof nilai !== 'string') return null;
  const titik = nilai.lastIndexOf('.');
  if (titik <= 0) return null;
  const isi = nilai.slice(0, titik);
  const tanda = Buffer.from(nilai.slice(titik + 1));
  const harap = Buffer.from(crypto.createHmac('sha256', rahasia).update(isi).digest('base64url'));
  if (tanda.length !== harap.length || !crypto.timingSafeEqual(tanda, harap)) return null;
  try {
    const data = JSON.parse(Buffer.from(isi, 'base64url').toString('utf8'));
    return data && data.v === 1 && typeof data.g === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** Umur cookie dalam detik. 0 berarti selamanya (D-4), disimpan 10 tahun. */
export function umurCookieDetik(hari) {
  const h = Number(hari) > 0 ? Number(hari) : 3650;
  return Math.trunc(h * 86400);
}

/**
 * Cookie masih dalam umurnya. Browser sudah membuang cookie yang lewat umur,
 * tetapi server ikut memeriksa waktu klik terakhir (`t`) supaya pengaturan
 * Umur cookie berlaku seketika dan nilai cookie lama tidak bisa dipakai ulang.
 */
export function cookieBerlaku(cookie, hari, kiniDetik = Math.floor(Date.now() / 1000)) {
  if (!cookie || !Number.isFinite(Number(cookie.t))) return false;
  return kiniDetik - Number(cookie.t) <= umurCookieDetik(hari);
}

/** Ambil nilai cookie dari header Cookie mentah. */
export function ambilCookie(header, nama = NAMA_COOKIE) {
  for (const bagian of String(header ?? '').split(';')) {
    const i = bagian.indexOf('=');
    if (i < 0) continue;
    if (bagian.slice(0, i).trim() === nama) {
      try {
        return decodeURIComponent(bagian.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Atribusi dan komisi

/**
 * Calon affiliate pesanan, berurutan (FR-19). Server memeriksa setiap calon ke
 * basis data (ada, berhak, dan berhak atas minimal satu barang) lalu memakai
 * yang pertama lolos.
 */
export function pilihCalon({ pengaturan, pembeli, cookie, productIds }) {
  const calon = [];
  const sudah = new Set();
  const tambah = (c) => {
    if (!c.affiliateId || c.affiliateId === pembeli?.id || sudah.has(`${c.affiliateId}|${c.source}|${c.productId}`)) return;
    sudah.add(`${c.affiliateId}|${c.source}|${c.productId}`);
    calon.push(c);
  };
  const akuisisi = (kunci) => {
    const a = cookie?.a?.[kunci];
    return Array.isArray(a) ? { source: a[0] ?? '', media: a[1] ?? '' } : { source: '', media: '' };
  };

  if (pengaturan?.permanent && pembeli?.referred_by) {
    tambah({ affiliateId: pembeli.referred_by, source: 'kaitan', productId: null, acquisition: { source: '', media: '' } });
  }
  if (cookie) {
    const diPesan = new Set(productIds ?? []);
    for (const [productId, affiliateId] of Array.isArray(cookie.p) ? cookie.p : []) {
      // Peta per produk hanya diisi klik link; undangan tidak membawa produk.
      if (diPesan.has(productId)) tambah({ affiliateId, source: 'link', productId, acquisition: akuisisi(productId) });
    }
    if (pengaturan?.general_cookie && cookie.g) {
      tambah({ affiliateId: cookie.g, source: cookie.k === 'undangan' ? 'undangan' : 'link', productId: null, acquisition: akuisisi('*') });
    }
  }
  return calon;
}

/**
 * Penerima per tier: indeks 0 = tier 1. Tier berikutnya adalah upline dari
 * penerima tier sebelumnya; berhenti bila tidak ada upline atau orang yang
 * sama muncul lagi (Sejoli: break). Penerima tanpa akses dan pembeli sendiri
 * dilewati (null) tetapi rantainya berlanjut.
 */
export function bangunRantai({ tier1, maksTier, uplineDari, berhak, pembeliId }) {
  const rantai = [];
  const dilihat = new Set();
  let kini = tier1;
  while (kini && rantai.length < maksTier) {
    if (dilihat.has(kini)) break;
    dilihat.add(kini);
    rantai.push(kini !== pembeliId && berhak(kini) ? kini : null);
    kini = uplineDari(kini);
  }
  while (rantai.length && rantai[rantai.length - 1] === null) rantai.pop();
  return rantai;
}

/** Tier komisi produk: komisi khusus bila diisi, selain itu komisi bawaan toko (D-5). */
export function tierUntukProduk(produk, pengaturan) {
  const khusus = produk?.affiliate_commission;
  if (Array.isArray(khusus) && khusus.length > 0) {
    const t = periksaTier(khusus);
    if (!t.galat) return t.tier;
  }
  return pengaturan?.commission ?? PENGATURAN_BAWAAN.commission;
}

/**
 * Komisi per barang per tier (FR-21). Dasar persentase = nilai barang dikurangi
 * bagian diskon pesanan sebanding nilai barang, tanpa ongkir dan pajak. Nilai
 * tetap dikali jumlah barang. Dibulatkan ke bawah per rupiah; komisi 0 tidak
 * dicatat.
 */
export function hitungKomisi({ items, discount, tierPerItem, rantai }) {
  const nilai = items.map((it) => Number(it.price) * Number(it.qty));
  const jumlah = nilai.reduce((s, n) => s + n, 0);
  const potongan = Math.max(0, Number(discount) || 0);
  const baris = [];
  items.forEach((it, i) => {
    const bagian = jumlah > 0 ? (potongan * nilai[i]) / jumlah : 0;
    const dasar = Math.max(0, Math.round((nilai[i] - bagian) * 100) / 100);
    tierPerItem(it).forEach((t, j) => {
      const penerima = rantai[j];
      if (!penerima) return;
      const besar = t.type === 'fixed' ? Math.floor(Number(t.value) * Number(it.qty)) : Math.floor((dasar * Number(t.value)) / 100);
      if (!(besar > 0)) return;
      baris.push({
        order_item_id: it.id,
        product_id: it.product_id ?? null,
        affiliate_id: penerima,
        tier: j + 1,
        base_amount: dasar,
        rate_type: t.type,
        rate_value: Number(t.value),
        commission: besar,
      });
    });
  });
  return baris;
}

const POLA_TAUTAN = [
  /https?:\/\//i,
  /\bwww\./i,
  // nama.tld, kecuali bagian alamat email (didahului @).
  /(?<![@\w-])[a-z0-9-]+\.(com|net|org|id|co|io|ly|me|xyz|info|biz|site|online|shop|store|link|app|dev|gl|cc|tv|us|uk|my|sg|test)\b/i,
];

/**
 * Teks memuat alamat web. Undangan dikirim dari email resmi toko ke alamat
 * mana pun, jadi nama dan pesan pribadi tidak boleh menjadi jalan menitipkan
 * tautan ke penerima.
 */
export function memuatTautan(teks) {
  const s = String(teks ?? '');
  return POLA_TAUTAN.some((p) => p.test(s));
}

/** Teks menjadi satu baris: dipakai judul email, yang tidak boleh membawa baris baru dari nama pengguna. */
export function satuBaris(teks) {
  return String(teks ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Kode affiliate

/** Huruf dari nama depan, maksimal 6, huruf besar; cadangan GNNK. */
export function kodeDasar(nama) {
  const depan = String(nama ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .split(/\s+/)[0] ?? '';
  const huruf = depan.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6);
  return huruf.length >= 2 ? huruf : 'GNNK';
}

export function kodeAcak(nama, digit = 2, acak = Math.random) {
  const batas = 10 ** digit;
  const angka = Math.min(batas - 1, Math.floor(acak() * batas));
  return `${kodeDasar(nama)}${String(angka).padStart(digit, '0')}`;
}

/** Sidik token undangan: hanya ini yang disimpan (NFR-5). */
export function sidikToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function tokenBaru() {
  return crypto.randomBytes(32).toString('base64url');
}
