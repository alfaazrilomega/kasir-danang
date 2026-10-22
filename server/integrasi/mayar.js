const BASE = { sandbox: 'https://api.mayar.io/hl/v2', production: 'https://api.mayar.id/hl/v2' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class MayarError extends Error {
  constructor(message) { super(message); this.status = 502; }
}
export function mayarAktif(config) { return config?.enabled === true && !!config.apiKey && !!BASE[config.mode]; }

async function request(path, config, body) {
  if (!BASE[config?.mode] || !config.apiKey) throw new MayarError('Simpan mode dan API Key Mayar terlebih dahulu.');
  let response, json;
  try {
    response = await fetch(`${BASE[config.mode]}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    json = await response.json();
  } catch { throw new MayarError('Mayar tidak dapat dihubungi atau responsnya tidak valid. Periksa koneksi server dan dashboard Mayar sebelum mencoba ulang.'); }
  if (!response.ok || ![200, 201].includes(Number(json?.statusCode))) {
    if ([401, 403].includes(response.status)) throw new MayarError(`API Key Mayar ditolak pada mode ${config.mode}. Periksa kunci dan izin Read & Write.`);
    if (response.status === 429) throw new MayarError('Batas permintaan Mayar tercapai. Tunggu sebelum mencoba kembali.');
    throw new MayarError('Permintaan ditolak Mayar. Periksa izin API, kanal aktif, dan data pembayaran di dashboard Mayar.');
  }
  return json.data;
}

export async function daftarKanal(config) {
  const data = await request('/payment-channels', config);
  if (!Array.isArray(data?.config)) throw new MayarError('Respons kanal Mayar tidak valid.');
  return data.config.filter((c) => c.type !== 'qris_static').map((c) => ({
    code: `${c.type}/${c.code || c.type}`, name: String(c.name || c.code || c.type),
    group: String(c.type), active: c.status === true, fee_flat: 0, fee_percent: 0,
  }));
}

// Only channels documented to return a QR payload or VA number can be displayed inline.
export function inlineMethod(channel) {
  const type = String(channel?.group || '').toLowerCase();
  const code = String(channel?.code || '').split('/').pop().toLowerCase();
  if (type === 'qris' && code === 'qris') return 'qris';
  if (type === 'va' && ['bni', 'bri', 'mandiri', 'cimb', 'permata', 'bjb', 'bsi'].includes(code)) return `va/${code}`;
  return null;
}

export function checkoutChannels(channels) {
  return channels.filter((c) => c.active && inlineMethod(c)).map((c) => ({
    ...c, code: inlineMethod(c).toUpperCase(), group: inlineMethod(c) === 'qris' ? 'QRIS' : 'Virtual Account',
    description: 'Kode pembayaran ditampilkan di checkout toko.', fee_customer: 0, minimum_amount: 1,
  }));
}

// The public docs describe the payment code but omit its response schema.
// Accept only explicit string fields; missing or unknown structures stay unavailable.
export function paymentInstructions(data, method) {
  if (method === 'qris') {
    const raw = data?.qrString ?? data?.paymentCode;
    if (typeof raw === 'string' && raw.length <= 4096 && raw.startsWith('000201') && /6304[0-9A-Fa-f]{4}$/.test(raw)) {
      return { kind: 'qris', qr_string: raw };
    }
  } else if (/^va\/(bni|bri|mandiri|cimb|permata|bjb|bsi)$/.test(method || '')) {
    const code = data?.paymentCode;
    if (typeof code === 'string' && /^\d{8,32}$/.test(code)) return { kind: 'va', pay_code: code, bank: method.slice(3).toUpperCase() };
  }
  return null;
}

// Request Payment memakai pilihan kanal pada hosted checkout Mayar.
export async function buatTransaksi({ orderId, orderNumber, amount, customerName, customerEmail, customerPhone, paymentMethod }, config) {
  if (!mayarAktif(config) || !Number.isSafeInteger(amount) || amount <= 0) throw new MayarError('Konfigurasi atau nominal pembayaran Mayar tidak valid.');
  if (paymentMethod && !/^(qris|va\/(bni|bri|mandiri|cimb|permata|bjb|bsi))$/.test(paymentMethod)) throw new MayarError('Kanal pembayaran langsung tidak didukung.');
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const data = await request('/payments/create', config, {
    name: orderNumber, amount, email: customerEmail, mobile: customerPhone,
    description: `Pesanan ${orderNumber} — ${customerName}`, expiredAt: expiresAt,
    extraData: { orderId, orderNumber },
    ...(paymentMethod ? { paymentMethod } : {}),
  });
  let url;
  try { url = new URL(data?.link); } catch { /* handled below */ }
  // Mayar supports custom merchant domains. Never fetch this URL on the server.
  if (!UUID.test(data?.id) || !UUID.test(data?.transactionId) || !url || url.protocol !== 'https:' || url.username || url.password) {
    throw new MayarError('Respons transaksi Mayar tidak lengkap. Periksa dashboard Mayar sebelum menagih ulang.');
  }
  return { reference: data.id, transactionId: data.transactionId, checkout_url: url.href, expiresAt, amount, instructions: paymentInstructions(data, paymentMethod) };
}

export async function detailTransaksi(id, config) {
  if (!UUID.test(id)) throw new MayarError('Referensi transaksi Mayar tidak valid.');
  return request(`/transactions/${encodeURIComponent(id)}`, config);
}

export async function registerWebhook(config, url) { await request('/webhooks/update', config, { urlHook: url }); }

export function verifiedPayment(order, data) {
  if (data?.id !== order.payment_transaction_id || data?.paymentLink?.id !== order.payment_reference
    || !Number.isSafeInteger(Number(data.amount)) || Number(data.amount) !== Number(order.payment_amount)) {
    throw new MayarError('Referensi atau nominal pembayaran Mayar tidak sesuai pesanan.');
  }
  const status = String(data.status).toLowerCase();
  const expires = data.expirationDate ? new Date(data.expirationDate).getTime() : new Date(order.payment_expires_at).getTime();
  return { paid: status === 'paid', unpaid: ['unpaid', 'created', 'pending'].includes(status),
    closed: ['expired', 'failed', 'closed', 'canceled', 'cancelled'].includes(status), expires };
}
