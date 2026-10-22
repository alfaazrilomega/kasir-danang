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
  if (override) return {
    ...override, base: BASE[override.mode],
    merchantCode: String(override.merchantCode || '').trim(),
    apiKey: String(override.apiKey || '').trim(),
    privateKey: String(override.privateKey || '').trim(),
  };
  const mode = (process.env.TRIPAY_MODE || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  return {
    mode,
    base: BASE[mode],
    merchantCode: (process.env.TRIPAY_MERCHANT_CODE || '').trim(),
    apiKey: (process.env.TRIPAY_API_KEY || '').trim(),
    privateKey: (process.env.TRIPAY_PRIVATE_KEY || '').trim(),
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

// Pesan terkontrol: respons mentah penyedia bisa berisi kunci atau HTML proxy.
export class TripayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function panggil(path, { method = 'GET', body } = {}, config) {
  const c = konfigurasi(config);
  if (!c.base) throw new TripayError('MODE', 'Mode Tripay harus sandbox atau production.');
  if (!c.apiKey) throw new TripayError('CREDENTIALS', 'Simpan API Key Tripay terlebih dahulu.');
  let res;
  let teks;
  try {
    res = await fetch(`${c.base}${path}`, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    teks = await res.text();
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
    throw new TripayError(timeout ? 'TIMEOUT' : 'NETWORK', timeout
      ? 'Tripay tidak merespons dalam 15 detik. Coba tes koneksi lagi.'
      : 'Server toko tidak dapat menghubungi Tripay. Periksa DNS, koneksi HTTPS, dan firewall server.');
  }
  let json = null;
  try {
    json = JSON.parse(teks);
  } catch {
    // Ditangani sebagai respons tidak valid, tanpa meneruskan HTML ke UI/log.
  }
  if (!res.ok || json?.success !== true) {
    const pesan = String(json?.message || '').toLowerCase();
    if (res.status === 401 || /invalid api key|api key.*(invalid|tidak valid)/.test(pesan)) {
      throw new TripayError('API_KEY', `API Key ditolak Tripay pada mode ${c.mode}. Gunakan Merchant Code, API Key, dan Private Key dari ${c.mode === 'sandbox' ? 'API & Integrasi > Simulator > Merchant' : 'Merchant produksi'} yang sama, lalu simpan dan tes ulang.`);
    }
    if (res.status === 403) throw new TripayError('FORBIDDEN', 'Akses Tripay ditolak (HTTP 403). Periksa izin merchant, whitelist IP jika digunakan, dan firewall server.');
    if (res.status === 429) throw new TripayError('RATE_LIMIT', 'Batas permintaan Tripay tercapai. Tunggu sebentar lalu coba lagi.');
    if (/signature/.test(pesan)) throw new TripayError('SIGNATURE', 'Signature Tripay ditolak. Cocokkan Merchant Code dan Private Key dengan API Key serta mode yang dipilih.');
    if (res.status >= 500) throw new TripayError('UNAVAILABLE', 'Layanan Tripay sedang bermasalah. Coba lagi beberapa saat.');
    if (!json || json.success !== false) throw new TripayError('RESPONSE', 'Respons Tripay tidak valid. Periksa akses server ke API Tripay.');
    throw new TripayError('REJECTED', 'Permintaan ditolak Tripay. Periksa kanal aktif, batas nominal, dan data transaksi pada merchant yang dipilih.');
  }
  return json.data;
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
  if (!Array.isArray(data)) throw new TripayError('RESPONSE', 'Respons kanal Tripay tidak valid.');
  if (cacheKanal.size >= 100) cacheKanal.clear();
  cacheKanal.set(key, { waktu: sekarang, data });
  return data;
}

export function kanalAktif(kanal) {
  return kanal?.active === true || kanal?.active === 1 || kanal?.active === '1';
}

export function kanalPublik(kanal) {
  return {
    code: kanal.code, name: kanal.name, group: kanal.group, type: kanal.type,
    active: kanalAktif(kanal), icon_url: kanal.icon_url,
    fee_flat: Number(kanal.fee_customer?.flat ?? 0),
    fee_percent: Number(kanal.fee_customer?.percent ?? 0),
    minimum_amount: Number(kanal.minimum_amount ?? 0),
    maximum_amount: Number(kanal.maximum_amount ?? 0),
  };
}

export async function hitungBiaya(amount, config) {
  const data = await panggil(`/merchant/fee-calculator?amount=${amount}`, {}, config);
  if (!Array.isArray(data)) throw new TripayError('RESPONSE', 'Respons biaya Tripay tidak valid.');
  return data;
}

export function nominalSah(kanal, amount) {
  return Number.isSafeInteger(amount) && amount > 0
    && amount >= Number(kanal.minimum_amount || 0)
    && (!Number(kanal.maximum_amount) || amount <= Number(kanal.maximum_amount));
}

/**
 * Buat transaksi closed payment. `amount` wajib sama persis dengan tagihan;
 * Tripay menghitung tanda tangannya dari angka itu.
 */
async function buatTransaksi({ method, merchantRef, amount, customerName, customerEmail, customerPhone, items, callbackUrl, returnUrl, expiredHours = 1 }, config) {
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
  let checkoutUrl;
  try { checkoutUrl = new URL(data?.checkout_url); } catch { /* ditolak di bawah */ }
  if (!data?.reference || !checkoutUrl || checkoutUrl.protocol !== 'https:'
    || (checkoutUrl.hostname !== 'tripay.co.id' && !checkoutUrl.hostname.endsWith('.tripay.co.id'))
    || checkoutUrl.username || checkoutUrl.password) {
    throw new TripayError('RESPONSE', 'Respons transaksi Tripay tidak lengkap. Periksa transaksi di dashboard merchant sebelum menagih ulang.');
  }
  return data;
}

/** Status transaksi menurut Tripay (dipakai saat callback meragukan). */
async function detailTransaksi(reference, config) {
  return panggil(`/transaction/detail?reference=${encodeURIComponent(reference)}`, {}, config);
}

export { konfigurasi, tripayAktif, daftarKanal, buatTransaksi, detailTransaksi, callbackSah, tandaTangan };
