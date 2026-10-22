// DOKU Checkout (non SNAP): pembeli dibawa ke halaman bayar DOKU, lalu status
// dipastikan lewat Check Status API. Notifikasi DOKU hanya mempercepat; tanpa
// alamat notifikasi di Back Office, pemeriksaan berkala tetap melunasi pesanan.
// Dokumentasi: developers.doku.com (Checkout backend integration, Signature
// component from request header, Check Status API non SNAP).
import crypto from 'node:crypto';

const BASE = { sandbox: 'https://api-sandbox.doku.com', production: 'https://api.doku.com' };
export const JALUR_NOTIFIKASI = '/api/doku/notifikasi';

export class DokuError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function dokuAktif(config) {
  return config?.enabled === true && !!config.clientId && !!config.secretKey && !!BASE[config.mode];
}

export function digest(body) {
  return crypto.createHash('sha256').update(body, 'utf8').digest('base64');
}

/** HMACSHA256=base64(HMAC(secret, baris komponen dipisah \n)); Digest hanya untuk request berbadan. */
export function tandaTangan({ clientId, requestId, timestamp, target, body }, secretKey) {
  const baris = [`Client-Id:${clientId}`, `Request-Id:${requestId}`, `Request-Timestamp:${timestamp}`, `Request-Target:${target}`];
  if (body !== undefined && body !== null) baris.push(`Digest:${digest(body)}`);
  return `HMACSHA256=${crypto.createHmac('sha256', secretKey).update(baris.join('\n')).digest('base64')}`;
}

// DOKU meminta UTC ISO 8601 tanpa milidetik, contoh 2020-08-11T08:45:42Z.
const waktuSekarang = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

async function request(method, target, config, payload) {
  if (!BASE[config?.mode] || !config.clientId || !config.secretKey) throw new DokuError('Simpan mode, Client ID, dan Secret Key DOKU terlebih dahulu.');
  const requestId = crypto.randomUUID();
  const timestamp = waktuSekarang();
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  let response;
  let json = null;
  try {
    response = await fetch(`${BASE[config.mode]}${target}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000), body,
      headers: {
        'Client-Id': config.clientId, 'Request-Id': requestId, 'Request-Timestamp': timestamp,
        Signature: tandaTangan({ clientId: config.clientId, requestId, timestamp, target, body }, config.secretKey),
        Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const teks = await response.text();
    try { json = teks ? JSON.parse(teks) : null; } catch { json = null; }
  } catch {
    throw new DokuError('DOKU tidak dapat dihubungi. Periksa koneksi server sebelum mencoba ulang.');
  }
  // DOKU sandbox menolak kunci salah dengan 400 invalid_signature / invalid_client_id
  // (diuji langsung 17 Okt 2026), bukan 401; keduanya tetap dianggap kunci ditolak.
  const kodeGalat = String(json?.error?.code ?? '');
  if ([401, 403].includes(response.status) || ['invalid_signature', 'invalid_client_id'].includes(kodeGalat)) {
    throw new DokuError(`Client ID atau Secret Key DOKU ditolak pada mode ${config.mode}.`);
  }
  if (response.status === 429) throw new DokuError('Batas permintaan DOKU tercapai. Tunggu sebelum mencoba kembali.');
  return { status: response.status, json, requestId };
}

// expired_date DOKU berbentuk yyyyMMddHHmmss dalam WIB (UTC+7).
export function waktuKedaluwarsa(nilai) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(nilai ?? ''));
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export async function buatTransaksi({ orderNumber, amount, customerName, customerEmail, customerPhone, callbackUrl }, config) {
  if (!dokuAktif(config) || !Number.isSafeInteger(amount) || amount <= 0) throw new DokuError('Konfigurasi atau nominal pembayaran DOKU tidak valid.');
  const { status, json, requestId } = await request('POST', '/checkout/v1/payment', config, {
    order: {
      amount, invoice_number: orderNumber, currency: 'IDR',
      ...(callbackUrl ? { callback_url: callbackUrl, auto_redirect: true } : {}),
    },
    payment: { payment_due_date: 60 },
    customer: {
      name: String(customerName || 'Pembeli').slice(0, 255),
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(customerPhone ? { phone: String(customerPhone).replace(/\D/g, '').slice(0, 16) } : {}),
    },
  });
  const payment = json?.response?.payment;
  let url;
  try { url = new URL(payment?.url); } catch { /* ditangani di bawah */ }
  if (status >= 300 || !url || url.protocol !== 'https:' || url.username || url.password || typeof payment?.token_id !== 'string') {
    throw new DokuError('Pembayaran DOKU belum dapat dibuat. Periksa metode pembayaran aktif di DOKU Back Office.');
  }
  return {
    reference: payment.token_id, transactionId: requestId, checkout_url: url.href, amount,
    expiresAt: waktuKedaluwarsa(payment.expired_date) || new Date(Date.now() + 3600000).toISOString(),
  };
}

export async function cekStatus(invoiceNumber, config) {
  if (!/^[A-Za-z0-9-_]{1,64}$/.test(String(invoiceNumber || ''))) throw new DokuError('Nomor invoice DOKU tidak valid.');
  const { status, json } = await request('GET', `/orders/v1/status/${encodeURIComponent(invoiceNumber)}`, config);
  if (status === 404) throw new DokuError('Transaksi DOKU tidak ditemukan.', 404);
  if (status >= 300 || !json) throw new DokuError('Status transaksi DOKU belum dapat dibaca.');
  return json;
}

/** Kunci dianggap sah bila DOKU tidak menolak autentikasi (invoice acak boleh tidak ditemukan). */
export async function tesKoneksi(config) {
  await request('GET', `/orders/v1/status/TES-${crypto.randomBytes(6).toString('hex').toUpperCase()}`, config);
}

export function verifiedPayment(order, data) {
  if (String(data?.order?.invoice_number ?? '') !== order.order_number || Number(data?.order?.amount) !== Number(order.payment_amount)) {
    throw new DokuError('Nomor invoice atau nominal pembayaran DOKU tidak sesuai pesanan.');
  }
  const status = String(data?.transaction?.status ?? '').toUpperCase();
  return {
    paid: status === 'SUCCESS',
    unpaid: ['PENDING', 'REDIRECT', ''].includes(status),
    closed: ['FAILED', 'EXPIRED', 'TIMEOUT'].includes(status),
    expires: order.payment_expires_at ? new Date(order.payment_expires_at).getTime() : null,
  };
}

/** Tanda tangan notifikasi dihitung dengan Request-Target = jalur notifikasi toko. */
export function notifikasiSah(header, rawBody, config) {
  if (!config?.secretKey || !header?.signature) return false;
  const harapan = tandaTangan({
    clientId: header.clientId, requestId: header.requestId, timestamp: header.timestamp,
    target: JALUR_NOTIFIKASI, body: rawBody,
  }, config.secretKey);
  const a = Buffer.from(harapan);
  const b = Buffer.from(String(header.signature));
  return header.clientId === config.clientId && a.length === b.length && crypto.timingSafeEqual(a, b);
}
