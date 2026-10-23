// Pelacakan iklan toko online (butir 15 PERMINTAAN-CLIENT.md): Meta Pixel,
// TikTok Pixel, Google Ads, GA4, dan Google Tag Manager.
//
// Admin mengisi ID-nya di Pengaturan → Toko Online. Kode pemasang resmi tiap
// platform dipasang di sini, hanya kalau ID-nya terisi dan hanya dari halaman
// /toko — halaman admin dan kasir tidak pernah memanggil modul ini.
//
// Halaman memanggil lacakHalaman()/lacakPixel() tanpa perlu tahu apakah data
// toko sudah termuat: sebelum pasangPixel() dipanggil, panggilan ditahan di
// antrean lalu dikirim begitu ID-nya diketahui.
//
// Kode pemasang mengikuti sumber resminya per 3 Okt 2026:
//   Meta   — developers.facebook.com/documentation/meta-pixel/get-started
//   Google — developers.google.com/tag-platform/devguides/conversions
//   TikTok — kode yang terpasang di tiktok.com/business

/** Format ID yang diterima. Sama dengan pemeriksaan di server (POLA_ID_PIXEL). */
export const POLA_ID_PIXEL = {
  meta: /^\d{10,20}$/,
  tiktok: /^[A-Z0-9]{10,40}$/,
  googleAds: /^AW-\d{6,15}$/,
  googleAdsLabel: /^[A-Za-z0-9_-]{4,60}$/,
  googleAnalytics: /^G-[A-Z0-9]{6,20}$/,
  googleTagManager: /^GTM-[A-Z0-9]{4,15}$/,
} as const;

export interface IdPixel {
  meta: string | null;
  tiktok: string | null;
  googleAds: string | null;
  googleAdsLabel: string | null;
  googleAnalytics: string | null;
  googleTagManager: string | null;
}

export interface BarangPixel {
  id: string;
  nama?: string;
  qty: number;
  harga: number;
}

export type PeristiwaPixel =
  | { jenis: 'ViewContent' | 'AddToCart' | 'InitiateCheckout'; barang: BarangPixel[]; nilai: number }
  | { jenis: 'Purchase'; barang: BarangPixel[]; nilai: number; idPesanan: string; nomorPesanan: string; shipping?: number; tax?: number };

interface SumberIdPixel {
  meta_pixel_id?: string | null;
  tiktok_pixel_id?: string | null;
  google_ads_id?: string | null;
  google_ads_purchase_label?: string | null;
  google_analytics_id?: string | null;
  google_tag_manager_id?: string | null;
}

/** ID dari data toko; yang formatnya tidak dikenal dianggap kosong, bukan dipasang apa adanya. */
export function idPixelDariToko(toko: SumberIdPixel | null | undefined): IdPixel {
  const cocok = (nilai: string | null | undefined, pola: RegExp) => {
    const v = (nilai ?? '').trim();
    return v && pola.test(v) ? v : null;
  };
  return {
    meta: cocok(toko?.meta_pixel_id, POLA_ID_PIXEL.meta),
    tiktok: cocok(toko?.tiktok_pixel_id, POLA_ID_PIXEL.tiktok),
    googleAds: cocok(toko?.google_ads_id, POLA_ID_PIXEL.googleAds),
    googleAdsLabel: cocok(toko?.google_ads_purchase_label, POLA_ID_PIXEL.googleAdsLabel),
    googleAnalytics: cocok(toko?.google_analytics_id, POLA_ID_PIXEL.googleAnalytics),
    googleTagManager: cocok(toko?.google_tag_manager_id, POLA_ID_PIXEL.googleTagManager),
  };
}

// Antrean bawaan tiap platform hidup di window dengan bentuk yang ditentukan
// skrip mereka sendiri, jadi diakses longgar lewat satu pintu ini.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jendela = (): any => window;

/** null = data toko belum diketahui, panggilan masih ditahan. */
let terpasang: IdPixel | null = null;
let antre: Array<(ids: IdPixel) => void> = [];
const sudahInit = { meta: '', tiktok: '', googleAds: '', googleAnalytics: '', googleTagManager: '' };
let googleLoader = false;

function jalankan(fn: (ids: IdPixel) => void) {
  if (typeof window === 'undefined') return;
  if (terpasang) { try { fn(terpasang); } catch { /* Analytics cannot interrupt shopping. */ } }
  // Batas supaya antrean tidak tumbuh tanpa akhir kalau data toko gagal dimuat.
  else if (antre.length < 50) antre.push(fn);
}

function muatSkrip(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  const pertama = document.getElementsByTagName('script')[0];
  if (pertama?.parentNode) pertama.parentNode.insertBefore(s, pertama);
  else document.head.appendChild(s);
}

function pasangMeta(id: string) {
  const w = jendela();
  if (!w.fbq) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n: any = (w.fbq = (...args: unknown[]) => {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    });
    if (!w._fbq) w._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    // Pixel Meta mengirim PageView sendiri tiap riwayat halaman berubah
    // (pushState). Halaman toko sudah mengirimnya lewat lacakHalaman(), jadi
    // yang otomatis dimatikan supaya satu pindah halaman tidak terhitung dua.
    n.disablePushState = true;
    muatSkrip('https://connect.facebook.net/en_US/fbevents.js');
  }
  if (sudahInit.meta !== id) {
    w.fbq('init', id);
    sudahInit.meta = id;
  }
}

function pasangTikTok(id: string) {
  const w = jendela();
  if (!w.ttq?.load) {
    w.TiktokAnalyticsObject = 'ttq';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ttq: any = (w.ttq = w.ttq || []);
    ttq.methods = [
      'page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias',
      'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent',
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ttq.setAndDefer = (target: any, method: string) => {
      target[method] = (...args: unknown[]) => {
        target.push([method, ...args]);
      };
    };
    for (const m of ttq.methods) ttq.setAndDefer(ttq, m);
    ttq.instance = (pixelId: string) => {
      const inst = ttq._i[pixelId] || [];
      for (const m of ttq.methods) ttq.setAndDefer(inst, m);
      return inst;
    };
    ttq.load = (pixelId: string, opsi?: Record<string, unknown>) => {
      const url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._i = ttq._i || {};
      ttq._i[pixelId] = [];
      ttq._i[pixelId]._u = url;
      ttq._t = ttq._t || {};
      ttq._t[pixelId] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[pixelId] = opsi || {};
      muatSkrip(`${url}?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`);
    };
  }
  if (sudahInit.tiktok !== id) {
    w.ttq.load(id);
    sudahInit.tiktok = id;
  }
}

function pasangGoogle(id: string) {
  const w = jendela();
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    // gtag.js hanya mengenali objek `arguments`; array dari rest parameter
    // dianggap data biasa dan perintahnya diabaikan.
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments);
    };
    w.gtag('js', new Date());
    if (!googleLoader) {
      googleLoader = true;
      muatSkrip(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    }
  }
  if (sudahInit.googleAds !== id) {
    // Aplikasi satu halaman: lihat halaman dikirim sendiri tiap pindah rute
    // (lacakHalaman), jadi kiriman otomatis saat config dimatikan.
    w.gtag('config', id, { send_page_view: false });
    sudahInit.googleAds = id;
  }
}

function pasangGoogleAnalytics(id: string) {
  const w = jendela();
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments);
    };
    w.gtag('js', new Date());
  }
  if (!googleLoader) {
    googleLoader = true;
    muatSkrip(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
  }
  if (sudahInit.googleAnalytics !== id) {
    w.gtag('config', id, { send_page_view: false });
    sudahInit.googleAnalytics = id;
  }
}

function pasangGtm(id: string) {
  const w = jendela();
  w.dataLayer = w.dataLayer || [];
  if (sudahInit.googleTagManager === id) return;
  w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  muatSkrip(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
  sudahInit.googleTagManager = id;
}

/** Pasang skrip platform yang ID-nya terisi, lalu kirim panggilan yang tertahan. */
export function pasangPixel(ids: IdPixel) {
  if (typeof window === 'undefined') return;
  if (ids.meta) pasangMeta(ids.meta);
  if (ids.tiktok) pasangTikTok(ids.tiktok);
  if (ids.googleTagManager) pasangGtm(ids.googleTagManager);
  // Saat GTM dipakai, kirim ecommerce lewat dataLayer saja supaya tag GA4 di
  // container tidak menerima salinan kedua dari gtag.js langsung.
  if (!ids.googleTagManager && ids.googleAnalytics) pasangGoogleAnalytics(ids.googleAnalytics);
  if (ids.googleAds && !ids.googleTagManager) pasangGoogle(ids.googleAds);
  terpasang = ids;
  const tertahan = antre;
  antre = [];
  for (const fn of tertahan) { try { fn(ids); } catch { /* Optional vendor script. */ } }
}

/** Lihat halaman; dipanggil tiap rute /toko berganti. */
export function lacakHalaman() {
  if (typeof window === 'undefined') return;
  const page = { page_location: window.location.origin + window.location.pathname, page_path: window.location.pathname, page_title: document.title };
  jalankan((ids) => {
    const w = jendela();
    if (ids.meta) w.fbq('trackSingle', ids.meta, 'PageView');
    if (ids.tiktok) w.ttq.page();
    if (ids.googleAds && !ids.googleTagManager) {
      w.gtag('event', 'page_view', {
        send_to: ids.googleAds,
        ...page,
      });
    }
    if (ids.googleAnalytics && !ids.googleTagManager) {
      w.gtag('event', 'page_view', {
        send_to: ids.googleAnalytics,
        ...page,
      });
    }
    if (ids.googleTagManager) {
      w.dataLayer.push({ event: 'storefront_page_view', ...page });
    }
  });
}

const NAMA_GOOGLE = {
  ViewContent: 'view_item',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'begin_checkout',
  Purchase: 'purchase',
} as const;

const purchaseMemory = new Set<string>();
function firstPurchase(p: PeristiwaPixel, ids: IdPixel): boolean {
  if (p.jenis !== 'Purchase') return true;
  if (!(ids.meta || ids.tiktok || ids.googleAds || ids.googleAnalytics || ids.googleTagManager)) return false;
  const key = `tokoku.purchase.v2:${Object.values(ids).join(':')}:${p.idPesanan}`;
  if (purchaseMemory.has(key)) return false;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch { /* Memory fallback when storage is unavailable. */ }
  purchaseMemory.add(key);
  return true;
}

export function atribusiMeta(): { fbp?: string; fbc?: string } {
  const result: { fbp?: string; fbc?: string } = {};
  if (typeof document === 'undefined') return result;
  for (const name of ['fbp', 'fbc'] as const) {
    const value = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`_${name}=`))?.slice(5);
    if (value && /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,200}$/.test(value)) result[name] = value;
  }
  return result;
}

/** Kirim satu peristiwa belanja ke semua platform yang terpasang. Nilai dalam rupiah. */
export function lacakPixel(p: PeristiwaPixel) {
  jalankan((ids) => {
    if (!firstPurchase(p, ids)) return;
    const w = jendela();
    const jumlah = p.barang.reduce((sum, b) => sum + b.qty, 0);

    if (ids.meta) {
      const data = {
        content_ids: p.barang.map((b) => b.id),
        content_type: 'product',
        contents: p.barang.map((b) => ({ id: b.id, quantity: b.qty })),
        value: p.nilai,
        currency: 'IDR',
        num_items: jumlah,
      };
      // eventID pesanan membuat Meta bisa membuang kiriman ganda.
      if (p.jenis === 'Purchase') w.fbq('trackSingle', ids.meta, 'Purchase', data, { eventID: p.idPesanan });
      else w.fbq('trackSingle', ids.meta, p.jenis, data);
    }

    if (ids.tiktok) {
      const data = {
        contents: p.barang.map((b) => ({
          content_id: b.id,
          content_type: 'product',
          content_name: b.nama,
          quantity: b.qty,
          price: b.harga,
        })),
        content_type: 'product',
        value: p.nilai,
        currency: 'IDR',
      };
      if (p.jenis === 'Purchase') w.ttq.track('Purchase', data, { event_id: p.idPesanan });
      else w.ttq.track(p.jenis, data);
    }

    if (ids.googleAds && !ids.googleTagManager) {
      const items = p.barang.map((b) => ({
        id: b.id,
        google_business_vertical: 'retail',
        quantity: b.qty,
        price: b.harga,
      }));
      w.gtag('event', NAMA_GOOGLE[p.jenis], {
        send_to: ids.googleAds,
        value: p.nilai,
        currency: 'IDR',
        items,
        ...(p.jenis === 'Purchase' ? { transaction_id: p.idPesanan } : {}),
      });
      if (p.jenis === 'Purchase' && ids.googleAdsLabel) {
        w.gtag('event', 'conversion', {
          send_to: `${ids.googleAds}/${ids.googleAdsLabel}`,
          value: p.nilai,
          currency: 'IDR',
          transaction_id: p.idPesanan,
        });
      }
    }

    const namaGoogle = NAMA_GOOGLE[p.jenis];
    const ecommerce = {
      currency: 'IDR', value: p.nilai,
      ...(p.jenis === 'Purchase' ? { transaction_id: p.idPesanan, event_id: p.idPesanan, shipping: p.shipping ?? 0, tax: p.tax ?? 0 } : {}),
      items: p.barang.map(b => ({ item_id: b.id, item_name: b.nama || b.id, price: b.harga, quantity: b.qty })),
    };
    if (ids.googleTagManager) {
      w.dataLayer.push({ ecommerce: null });
      w.dataLayer.push({ event: namaGoogle, ecommerce, event_id: p.jenis === 'Purchase' ? p.idPesanan : undefined });
    } else if (ids.googleAnalytics) {
      w.gtag('event', namaGoogle, { send_to: ids.googleAnalytics, ...ecommerce });
    }
  });
}

/** true bila ada platform yang terpasang; dipakai untuk memberi waktu kirim sebelum pindah situs. */
export function pixelAktif(): boolean {
  return !!terpasang && !!(terpasang.meta || terpasang.tiktok || terpasang.googleAds || terpasang.googleAnalytics || terpasang.googleTagManager);
}
