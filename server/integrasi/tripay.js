// Tripay: payment gateway (virtual account, e-wallet, QRIS dinamis, retail).
//
// Aktif hanya bila TRIPAY_MERCHANT_CODE, TRIPAY_API_KEY, dan TRIPAY_PRIVATE_KEY
// terisi. Selama kosong, toko tetap memakai pembayaran manual (COD, transfer,
// QRIS statis) dan endpoint kanal mengembalikan daftar kosong — jadi aplikasi
// tidak pernah bergantung pada kunci yang belum diberikan client.
//
// Mode sandbox memakai host api-sandbox: transaksinya uji coba, tidak menagih
// uang sungguhan. Ganti TRIPAY_MODE=production setelah lolos uji.

import crypto from 'node:crypto';

const BASE = {
  sandbox: 'https://tripay.co.id/api-sandbox',
  production: 'https://tripay.co.id/api',
};

function konfigurasi(override) {
  if (override) return { ...override, base: BASE[override.mode] };
  const mode = (process.env.TRIPAY_MODE || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  return {
    mode,
    base: BASE[mode],
    merchantCode: process.env.TRIPAY_MERCHANT_CODE || '',
    apiKey: process.env.TRIPAY_API_KEY || '',
    privateKey: process.env.TRIPAY_PRIVATE_KEY || '',
  };
}

function tripayAktif(config) {
  const c = konfigurasi(config);
  return c.enabled !== false && !!(c.merchantCode && c.apiKey && c.privateKey);
}

/** Tanda tangan transaksi: HMAC-SHA256(kodeMerchant + refMerchant + jumlah). */
function tandaTangan(merchantRef, amount, config) {
  const c = konfigurasi(config);
  return crypto.createHmac('sha256', c.privateKey).update(`${c.merchantCode}${merchantRef}${amount}`).digest('hex');
}

/** Tanda tangan callback dihitung dari body mentah, bukan dari objek hasil parse. */
function callbackSah(rawBody, signature, config) {
  const c = konfigurasi(config);
  if (!c.privateKey || !signature) return false;
  const hitung = crypto.createHmac('sha256', c.privateKey).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hitung), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

async function panggil(path, { method = 'GET', body } = {}, config) {
  const c = konfigurasi(config);
  const res = await fetch(`${c.base}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${c.apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const teks = await res.text();
  let json = null;
  try {
    json = JSON.parse(teks);
  } catch {
    /* biarkan json null; pesan galat memakai teks mentah */
  }
  if (!res.ok || json?.success === false) {
    const pesan = json?.message || teks.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`Tripay: ${pesan}`);
  }
  return json?.data ?? json;
}

const cacheKanal = new Map();

/**
 * Daftar kanal pembayaran aktif di akun merchant. Di-cache 5 menit supaya
 * halaman checkout tidak memanggil Tripay tiap kali dibuka.
 */
async function daftarKanal(config, refresh = false) {
  const c = konfigurasi(config);
  if (!c.apiKey || (!refresh && !tripayAktif(c))) return [];
  const key = crypto.createHash('sha256').update(`${c.mode}:${c.apiKey}`).digest('hex');
  const sekarang = Date.now();
  const cached = cacheKanal.get(key);
  if (!refresh && cached && sekarang - cached.waktu < 5 * 60 * 1000) return cached.data;
  const data = await panggil('/merchant/payment-channel', {}, c);
  if (!Array.isArray(data)) throw new Error('Respons kanal Tripay tidak valid.');
  if (cacheKanal.size >= 100) cacheKanal.clear();
  cacheKanal.set(key, { waktu: sekarang, data });
  return data;
}

/**
 * Buat transaksi closed payment. `amount` wajib sama persis dengan tagihan;
 * Tripay menghitung tanda tangannya dari angka itu.
 */
async function buatTransaksi({ method, merchantRef, amount, customerName, customerEmail, customerPhone, items, callbackUrl, returnUrl, expiredHours = 24 }, config) {
  if (!tripayAktif(config)) throw new Error('Tripay belum dikonfigurasi.');
  const data = await panggil('/transaction/create', {
    method: 'POST',
    body: {
      method,
      merchant_ref: merchantRef,
      amount,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      order_items: items,
      callback_url: callbackUrl || undefined,
      return_url: returnUrl || undefined,
      expired_time: Math.floor(Date.now() / 1000) + expiredHours * 3600,
      signature: tandaTangan(merchantRef, amount, config),
    },
  }, config);
  return data;
}

/** Status transaksi menurut Tripay (dipakai saat callback meragukan). */
async function detailTransaksi(reference, config) {
  return panggil(`/transaction/detail?reference=${encodeURIComponent(reference)}`, {}, config);
}

export { konfigurasi, tripayAktif, daftarKanal, buatTransaksi, detailTransaksi, callbackSah, tandaTangan };
