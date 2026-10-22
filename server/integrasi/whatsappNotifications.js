import crypto from 'node:crypto';
import { loadIntegration } from './settings.js';
import * as onesender from './onesender.js';
import * as meta from './metaWhatsapp.js';

export class WhatsAppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const VARIABLES = ['nama_customer', 'nama_toko', 'nomor_order', 'rincian_order', 'total', 'ongkir', 'metode_pembayaran', 'status_pembayaran', 'alamat', 'link_pembayaran', 'telepon_customer'];
export const TEMPLATE_KEYS = ['order_new', 'wa1', 'wa2', 'wa3'];
export const REMINDER_KEYS = ['wa1', 'wa2', 'wa3'];
export function defaultReminders() { return { enabled: false, minutes: [10, 30, 50] }; }
const texts = {
  order_new: 'Halo {nama_customer}, pesanan Anda di {nama_toko} sudah kami terima.\n\nNomor: {nomor_order}\n{rincian_order}\n\nTotal pesanan: {total}\nOngkir: {ongkir}\nPembayaran: {metode_pembayaran} ({status_pembayaran})\nAlamat: {alamat}\n\nLihat pesanan / pembayaran: {link_pembayaran}\nTerima kasih. Admin akan mengonfirmasi pengiriman Anda.',
  wa1: 'Halo {nama_customer}, kami dari {nama_toko} ingin menindaklanjuti pesanan {nomor_order}.\n\n{rincian_order}\nTotal: {total}\nStatus pembayaran: {status_pembayaran}\n\nApakah ada yang ingin ditanyakan? Detail pesanan: {link_pembayaran}',
  wa2: 'Halo {nama_customer}, admin {nama_toko} ingin mengonfirmasi kelanjutan pesanan {nomor_order}.\n\nTotal: {total}\nStatus: {status_pembayaran}\nSilakan balas pesan ini jika membutuhkan bantuan.',
  wa3: 'Halo {nama_customer}, apakah masih membutuhkan bantuan untuk pesanan {nomor_order} di {nama_toko}?\nKami siap membantu. Terima kasih.',
};
export function defaultSettings() {
  return { enabled: true, provider: 'onesender', reminders: defaultReminders(), templates: Object.fromEntries(TEMPLATE_KEYS.map((key) => [key, { text: texts[key], metaName: '', metaLanguage: 'id', metaParameters: [] }])) };
}
function validateText(text, max = 3000) {
  if (typeof text !== 'string' || !text.trim() || text.length > max) throw new WhatsAppError(`Isi template wajib 1–${max} karakter.`);
  const unknown = [...text.matchAll(/{([^{}]+)}/g)].map((match) => match[1]).filter((name) => !VARIABLES.includes(name));
  if (unknown.length) throw new WhatsAppError(`Variabel template tidak dikenal: ${unknown[0]}.`);
  return text.trim();
}
export function validateSettings(body) {
  if (typeof body?.enabled !== 'boolean' || !['onesender', 'meta_whatsapp'].includes(body.provider)) throw new WhatsAppError('Pengaturan pengiriman WhatsApp tidak valid.');
  const templates = {};
  for (const key of TEMPLATE_KEYS) {
    const item = body.templates?.[key];
    if (!item || typeof item.metaName !== 'string' || typeof item.metaLanguage !== 'string' || !Array.isArray(item.metaParameters)) throw new WhatsAppError(`Pengaturan template ${key} tidak lengkap.`);
    if (item.metaName && !/^[a-z0-9_]{1,512}$/.test(item.metaName)) throw new WhatsAppError('Nama template Meta hanya huruf kecil, angka, dan underscore.');
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(item.metaLanguage) || item.metaParameters.length > 20) throw new WhatsAppError('Bahasa atau jumlah parameter Meta tidak valid.');
    templates[key] = { text: validateText(item.text), metaName: item.metaName, metaLanguage: item.metaLanguage, metaParameters: item.metaParameters.map((value) => validateText(value, 1024)) };
  }
  if (body.enabled && body.provider === 'meta_whatsapp' && !templates.order_new.metaName) throw new WhatsAppError('Isi template Meta untuk notifikasi order sebelum mengaktifkan pengiriman otomatis.');
  const input = body.reminders ?? defaultReminders();
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.minutes) || input.minutes.length !== 3
    || input.minutes.some((value, index) => !Number.isInteger(value) || value < 5 || value > 4320
      || (index > 0 && value - input.minutes[index - 1] < 10))) {
    throw new WhatsAppError('Jadwal WA 1, WA 2, WA 3 harus 5–4320 menit setelah order, berurutan dengan selisih minimal 10 menit.');
  }
  if (input.enabled && body.provider === 'meta_whatsapp' && REMINDER_KEYS.some((key) => !templates[key].metaName)) {
    throw new WhatsAppError('Isi nama template Meta untuk WA 1, WA 2, dan WA 3 sebelum mengaktifkan reminder otomatis.');
  }
  return { enabled: body.enabled, provider: body.provider, templates, reminders: { enabled: input.enabled, minutes: [...input.minutes] } };
}
export async function loadSettings(db, storeId) {
  const result = await db.query('select config from public.whatsapp_settings where store_id = $1', [storeId]);
  const config = result.rows[0]?.config ?? defaultSettings();
  return { ...config, reminders: config.reminders ?? defaultReminders() };
}
export async function saveSettings(db, storeId, body) {
  const config = validateSettings(body);
  await db.query(`insert into public.whatsapp_settings (store_id, config) values ($1, $2)
    on conflict (store_id) do update set config = excluded.config, updated_at = now()`, [storeId, JSON.stringify(config)]);
  if (!config.reminders.enabled) await db.query(`update public.whatsapp_reminders set status = 'skipped',
    reason = 'Reminder otomatis dinonaktifkan admin.', updated_at = now() where store_id = $1 and status = 'pending'`, [storeId]);
  return config;
}
export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (!/^\+?[\d\s()-]+$/.test(raw)) throw new WhatsAppError('Nomor WhatsApp customer tidak valid. Lengkapi nomor di halaman Customers.');
  let number = raw.replace(/\D/g, '');
  if (number.startsWith('0')) number = `62${number.slice(1)}`;
  else if (number.startsWith('8')) number = `62${number}`;
  if (!/^[1-9]\d{7,14}$/.test(number)) throw new WhatsAppError('Nomor WhatsApp customer harus 8–15 digit termasuk kode negara.');
  return number;
}
export function renderTemplate(text, variables) {
  return text.replace(/{([^{}]+)}/g, (_match, key) => variables[key] ?? '-');
}
const money = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
export async function customerContext(db, storeId, customerId, orderId, useOrderPhone = false) {
  const customer = (await db.query('select id, name, phone, address from public.customers where id = $1 and store_id = $2', [customerId, storeId])).rows[0];
  if (!customer) throw new WhatsAppError('Customer tidak ditemukan pada toko ini.', 404);
  const store = (await db.query('select name from public.stores where id = $1', [storeId])).rows[0];
  const orders = await db.query(`select id, order_number, total, shipping_cost, payment_method, payment_status,
    order_status, customer_phone, customer_name, delivery_address, payment_url, payment_channel, payment_provider
    from public.orders where store_id = $1 and customer_id = $2 ${orderId ? 'and id = $3' : ''}
    order by created_at desc limit 1`, orderId ? [storeId, customerId, orderId] : [storeId, customerId]);
  const order = orders.rows[0];
  if (orderId && !order) throw new WhatsAppError('Pesanan bukan milik customer/toko ini.', 404);
  const items = order ? (await db.query('select name, qty, price from public.order_items where order_id = $1 order by id', [order.id])).rows : [];
  // Notifikasi otomatis mengikuti nomor yang dikonfirmasi saat checkout.
  // Follow-up manual memakai nomor profil terbaru yang dapat diperbaiki admin.
  const recipient = normalizePhone(useOrderPhone ? (order?.customer_phone || customer.phone) : (customer.phone || order?.customer_phone));
  const status = { paid: 'Lunas', unpaid: 'Belum lunas', partial: 'Dibayar sebagian', refunded: 'Dikembalikan' };
  const methods = { cash: 'Tunai / COD', transfer: 'Transfer bank', qris: 'QRIS', ewallet: 'E-Wallet', card: 'Kartu' };
  return { customer, order, recipient, variables: {
    nama_customer: customer.name, nama_toko: store?.name || 'Toko', telepon_customer: recipient,
    nomor_order: order?.order_number || '-', rincian_order: items.map((item, i) => `${i + 1}. ${item.name} — ${item.qty} x ${money(item.price)} = ${money(item.qty * item.price)}`).join('\n') || 'Belum ada pesanan.',
    total: order ? money(order.total) : '-', ongkir: order?.order_status === 'awaiting_confirmation' ? 'Dikonfirmasi terpisah oleh toko' : money(order?.shipping_cost),
    metode_pembayaran: order?.payment_channel || methods[order?.payment_method] || order?.payment_method || '-',
    status_pembayaran: status[order?.payment_status] || order?.payment_status || '-', alamat: order?.delivery_address || customer.address || '-',
    link_pembayaran: order?.payment_provider === 'mayar'
      ? `${(process.env.PUBLIC_STORE_URL || 'https://store.gnnkracing.id').replace(/\/+$/, '')}/toko/checkout?order=${encodeURIComponent(order.id)}`
      : order?.payment_url || `${(process.env.PUBLIC_STORE_URL || 'https://store.gnnkracing.id').replace(/\/+$/, '')}/toko/akun?tab=pesanan`,
  } };
}
export function publicMessage(row) {
  return { id: row.id, customer_id: row.customer_id, order_id: row.order_id, template_key: row.template_key, provider: row.provider,
    recipient: row.recipient, message_text: row.message_text, status: row.status, provider_message_id: row.provider_message_id,
    error_message: row.error_message, created_at: row.created_at };
}
async function insertMessage(db, row) {
  const result = await db.query(`insert into public.whatsapp_messages
    (id, store_id, customer_id, order_id, template_key, provider, recipient, message_text, payload, status, error_message, dedupe_key, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (store_id, dedupe_key) do nothing returning *`,
  [crypto.randomUUID(), row.storeId, row.customerId, row.orderId || null, row.key, row.provider, row.recipient, row.text, JSON.stringify(row.payload || {}), row.status || 'draft', row.error || null, row.dedupeKey || null, row.createdBy || null]);
  return result.rows[0] ?? null;
}
export async function prepareMessage(db, { storeId, customerId, orderId, key, createdBy, dedupeKey, useOrderPhone = false }) {
  if (!TEMPLATE_KEYS.includes(key)) throw new WhatsAppError('Template WhatsApp tidak dikenali.');
  const settings = await loadSettings(db, storeId);
  const context = await customerContext(db, storeId, customerId, orderId, useOrderPhone);
  const template = settings.templates[key];
  let text;
  let payload;
  if (settings.provider === 'meta_whatsapp') {
    const config = await loadIntegration(db, storeId, 'meta_whatsapp');
    const prepared = await meta.siapkanTemplate(config, { name: template.metaName, language: template.metaLanguage,
      parameters: template.metaParameters.map((value) => renderTemplate(value, context.variables)) });
    text = prepared.text;
    payload = prepared.payload;
  } else {
    text = renderTemplate(template.text, context.variables);
    payload = { text };
  }
  if (!text || text.length > 4096) throw new WhatsAppError('Pesan lebih dari 4096 karakter. Ringkas template atau rincian barang.');
  return insertMessage(db, { storeId, customerId, orderId: context.order?.id, key, createdBy, dedupeKey,
    provider: settings.provider, recipient: context.recipient, text, payload });
}
export async function sendMessage(db, storeId, id, { beforeSend } = {}) {
  // Klaim atomik: klik ganda/retry HTTP tidak boleh mengirim pesan kedua.
  const claim = await db.query(`update public.whatsapp_messages set status = 'sending', updated_at = now()
    where id = $1 and store_id = $2 and status = 'draft' and created_at > now() - interval '1 hour' returning *`, [id, storeId]);
  const row = claim.rows[0];
  if (!row) {
    const existing = (await db.query('select * from public.whatsapp_messages where id = $1 and store_id = $2', [id, storeId])).rows[0];
    if (!existing) throw new WhatsAppError('Pesan tidak ditemukan.', 404);
    if (existing.status === 'accepted') return publicMessage(existing);
    throw new WhatsAppError('Pesan sudah diproses atau pratinjau kedaluwarsa. Periksa riwayat sebelum membuat pesan baru.', 409);
  }
  let result;
  try {
    const config = await loadIntegration(db, storeId, row.provider);
    if (beforeSend) await beforeSend(row);
    result = row.provider === 'onesender'
      ? await onesender.kirimPesan(config, { to: row.recipient, text: row.payload.text })
      : await meta.kirimTemplate(config, { to: row.recipient, template: row.payload });
  } catch (error) {
    const message = error instanceof onesender.OneSenderError || error instanceof meta.MetaWhatsAppError || error instanceof WhatsAppError
      ? error.message : 'Pengiriman WhatsApp gagal. Periksa konfigurasi integrasi dan koneksi server.';
    await db.query(`update public.whatsapp_messages set status = $3, error_message = $4, updated_at = now() where id = $1 and store_id = $2`,
      [id, storeId, error.uncertain ? 'unknown' : 'failed', message]);
    throw new WhatsAppError(message, 502);
  }
  // Jika pencatatan gagal setelah API menerima pesan, biarkan status sending.
  // Jangan mengirim ulang otomatis karena penerimaan sudah mungkin terjadi.
  await db.query(`update public.whatsapp_messages set status = 'accepted', provider_message_id = $3, error_message = null, updated_at = now() where id = $1 and store_id = $2`, [id, storeId, result.id]);
  return publicMessage({ ...row, status: 'accepted', provider_message_id: result.id });
}
export async function notifyOrder(db, { storeId, orderId, customerId }) {
  const settings = await loadSettings(db, storeId);
  if (!settings.enabled) return;
  const config = await loadIntegration(db, storeId, settings.provider);
  if (settings.provider === 'onesender' && !config.apiKey && !config.apiUrl) return;
  const dedupeKey = `order:${orderId}`;
  let row;
  try { row = await prepareMessage(db, { storeId, orderId, customerId, key: 'order_new', dedupeKey, useOrderPhone: true }); }
  catch (error) {
    const message = error instanceof WhatsAppError || error instanceof meta.MetaWhatsAppError ? error.message : 'Notifikasi belum dapat disiapkan. Periksa template dan integrasi WhatsApp.';
    await insertMessage(db, { storeId, customerId, orderId, key: 'order_new', provider: settings.provider, recipient: '', text: '', status: 'failed', error: message, dedupeKey });
    return;
  }
  if (row) await sendMessage(db, storeId, row.id);
}
