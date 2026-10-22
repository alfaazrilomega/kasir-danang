import nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
import { encryptConfig, decryptConfig } from './settings.js';
import { isPublicAddress } from './onesender.js';
import { kirimEmailMailketing, tesMailketing } from './mailketing.js';

export class EmailError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const TEMPLATE_KEYS = ['order_customer', 'order_admin', 'password_reset'];
export const VARIABLES = {
  order_customer: ['nama_toko', 'nama_customer', 'nomor_order', 'rincian_order', 'total', 'metode_pembayaran', 'alamat', 'telepon_customer', 'link_pesanan'],
  order_admin: ['nama_toko', 'nama_customer', 'nomor_order', 'rincian_order', 'total', 'metode_pembayaran', 'alamat', 'telepon_customer', 'link_pesanan'],
  password_reset: ['nama_toko', 'kode_reset', 'masa_berlaku'],
};
export function defaultConfig() {
  return { provider: 'server', fromName: '', fromEmail: '', apiToken: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPassword: '', orderNotifyEmail: null };
}
export function defaultTemplates() {
  return {
    order_customer: { subject: 'Pesanan {nomor_order} diterima - {nama_toko}', html: '<h2>Terima kasih, {nama_customer}</h2><p>Pesanan Anda di <strong>{nama_toko}</strong> sudah kami terima.</p><p>Nomor pesanan: <strong>{nomor_order}</strong></p><p>{rincian_order}</p><p><strong>Total: {total}</strong><br>Pembayaran: {metode_pembayaran}</p><p>Alamat: {alamat}</p><p>Pesanan menunggu konfirmasi toko. Ongkos kirim dikabari terpisah lewat WhatsApp.</p><p>Lihat pesanan: {link_pesanan}</p>' },
    order_admin: { subject: 'Pesanan website baru {nomor_order} - {total}', html: '<h2>Pesanan website baru</h2><p>Toko: {nama_toko}<br>Nomor: <strong>{nomor_order}</strong><br>Pembeli: {nama_customer} ({telepon_customer})<br>Alamat: {alamat}</p><p>{rincian_order}</p><p><strong>Total: {total}</strong><br>Pembayaran: {metode_pembayaran}</p><p>Konfirmasi pesanan di menu Riwayat Transaksi, tab Pesanan Website.</p>' },
    password_reset: { subject: 'Kode reset kata sandi {nama_toko}', html: '<h2>Reset kata sandi</h2><p>Kode verifikasi akun Anda di <strong>{nama_toko}</strong>:</p><h2>{kode_reset}</h2><p>Kode berlaku {masa_berlaku} menit. Jangan berikan kode ini kepada siapa pun.</p><p>Abaikan email ini jika Anda tidak meminta reset kata sandi.</p>' },
  };
}
export function cleanHtml(html) {
  return sanitizeHtml(html, { allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'hr', 'a'],
    allowedAttributes: { a: ['href', 'title'], ol: ['start'] }, allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
    transformTags: { a: (_tag, attrs) => ({ tagName: 'a', attribs: { ...attrs, ...(attrs.href && !/^(https?:\/\/|mailto:|\{link_pesanan\}$)/i.test(attrs.href) ? { href: '' } : {}) } }) },
  });
}
function checkVariables(text, key) {
  const unknown = [...text.matchAll(/\{([^{}]+)\}/g)].find((match) => !VARIABLES[key].includes(match[1]));
  if (unknown) throw new EmailError(`Variabel tidak tersedia untuk template ini: ${unknown[1]}.`);
}
export function validateTemplates(input) {
  const result = {};
  for (const key of TEMPLATE_KEYS) {
    const value = input?.[key];
    if (typeof value?.subject !== 'string' || !value.subject.trim() || value.subject.length > 200 || /[\r\n\x00-\x1f]/.test(value.subject)) throw new EmailError('Subjek email wajib 1–200 karakter, tanpa baris baru.');
    if (typeof value.html !== 'string' || value.html.length > 50000) throw new EmailError('Isi template maksimal 50.000 karakter HTML.');
    const html = cleanHtml(value.html);
    const plain = convert(html, { wordwrap: false, selectors: ['h1', 'h2', 'h3'].map((selector) => ({ selector, options: { uppercase: false } })) });
    if (!plain.trim()) throw new EmailError('Isi template email tidak boleh kosong.');
    checkVariables(value.subject, key); checkVariables(html, key);
    if (key === 'password_reset' && !plain.includes('{kode_reset}')) throw new EmailError('Template reset kata sandi wajib memuat {kode_reset} pada isi email.');
    result[key] = { subject: value.subject.trim(), html };
  }
  return result;
}
const esc = (value) => String(value ?? '-').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function renderEmail(template, variables) {
  const subject = template.subject.replace(/\{([^{}]+)\}/g, (_m, key) => String(variables[key] ?? '-')).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 998);
  const body = cleanHtml(template.html.replace(/\{([^{}]+)\}/g, (_m, key) => esc(variables[key]).replace(/\r?\n/g, '<br>')));
  return { subject, html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202033;line-height:1.6"><div style="max-width:640px;margin:auto;padding:24px">${body}</div></body></html>`, text: convert(body, { wordwrap: false }) };
}
const emailValid = (email) => /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email) && email.length <= 254;
export function validateConfig(body, previous = defaultConfig()) {
  if (!body || !['server', 'mailketing', 'smtp'].includes(body.provider)) throw new EmailError('Pilih layanan email yang valid.');
  const config = { ...previous, provider: body.provider };
  for (const key of ['fromName', 'fromEmail', 'smtpHost', 'smtpUser']) {
    if (typeof body[key] !== 'string' || body[key].length > 254 || /[\r\n\x00-\x1f]/.test(body[key])) throw new EmailError(`Isian ${key} tidak valid.`);
    config[key] = body[key].trim();
  }
  for (const key of ['apiToken', 'smtpPassword']) {
    if (body[key] === undefined || body[key] === '') continue;
    if (typeof body[key] !== 'string' || body[key].length > 4096 || /[\r\n\x00]/.test(body[key])) throw new EmailError('Kredensial email tidak valid.');
    config[key] = body[key];
  }
  if (/\s/.test(config.apiToken)) throw new EmailError('API Token Mailketing harus tanpa spasi atau awalan Bearer.');
  if (body.orderNotifyEmail !== null && (typeof body.orderNotifyEmail !== 'string' || (body.orderNotifyEmail && !emailValid(body.orderNotifyEmail)))) throw new EmailError('Email penerima notifikasi admin tidak valid.');
  config.orderNotifyEmail = body.orderNotifyEmail;
  config.smtpPort = Number(body.smtpPort);
  if (![465, 587, 2525].includes(config.smtpPort)) throw new EmailError('Port SMTP harus 465, 587, atau 2525.');
  if (config.provider !== 'server' && (!config.fromName || !emailValid(config.fromEmail))) throw new EmailError('Lengkapi nama dan alamat email pengirim.');
  if (config.provider === 'mailketing' && !config.apiToken) throw new EmailError('Isi API Token dari menu API Integration Mailketing.');
  if (config.provider === 'smtp') {
    if (!config.smtpHost || !config.smtpUser || !config.smtpPassword) throw new EmailError('Lengkapi host, username, dan password SMTP.');
    if (!/^[a-zA-Z0-9.-]+$/.test(config.smtpHost) || config.smtpHost === 'localhost' || config.smtpHost.endsWith('.localhost') || (isIP(config.smtpHost) && !isPublicAddress(config.smtpHost))) throw new EmailError('Gunakan hostname SMTP publik tanpa protokol atau path.');
    if ((config.smtpHost !== previous.smtpHost || config.smtpUser !== previous.smtpUser) && previous.smtpPassword && !body.smtpPassword) throw new EmailError('Isi ulang password SMTP saat mengganti host atau username.');
  }
  return config;
}
export function publicConfig(config) {
  const { apiToken, smtpPassword, ...visible } = config;
  return { ...visible, hasApiToken: !!apiToken, hasSmtpPassword: !!smtpPassword };
}
export async function loadSettings(db, storeId) {
  const row = (await db.query('select config_encrypted, templates from public.store_email_settings where store_id = $1', [storeId])).rows[0];
  return row ? { config: decryptConfig(row.config_encrypted, `${storeId}:email`), templates: row.templates } : { config: defaultConfig(), templates: defaultTemplates() };
}
export async function saveSettings(db, storeId, body) {
  const previous = await loadSettings(db, storeId);
  const config = validateConfig(body?.config, previous.config);
  const templates = validateTemplates(body?.templates);
  await db.query(`insert into public.store_email_settings (store_id, config_encrypted, templates) values ($1,$2,$3)
    on conflict (store_id) do update set config_encrypted=excluded.config_encrypted, templates=excluded.templates, updated_at=now()`,
  [storeId, encryptConfig(config, `${storeId}:email`), JSON.stringify(templates)]);
  return { config: publicConfig(config), templates };
}
async function smtpTransport(config) {
  // Resolve sekali dan pin IP agar kredensial tidak dikirim ke jaringan internal.
  let addresses;
  try { addresses = await lookup(config.smtpHost, { all: true }); }
  catch { throw new EmailError('Host SMTP tidak dapat ditemukan. Periksa nama server SMTP.', 502); }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new EmailError('Host SMTP harus menunjuk ke alamat publik.');
  return nodemailer.createTransport({ host: addresses[0].address, port: config.smtpPort, secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465, tls: { servername: config.smtpHost, rejectUnauthorized: true },
    auth: { user: config.smtpUser, pass: config.smtpPassword }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true });
}
export async function testConnection(config) {
  if (config.provider === 'mailketing') return tesMailketing(config);
  if (config.provider !== 'smtp') throw new EmailError('Pilih Mailketing atau SMTP untuk menguji pengaturan dari aplikasi.');
  const transport = await smtpTransport(config);
  try { await transport.verify(); return { message: 'Koneksi dan autentikasi SMTP berhasil. Tes tidak mengirim email.' }; }
  catch { throw new EmailError('Tes SMTP gagal. Periksa host, port, TLS, username, dan password.', 502); }
  finally { transport.close(); }
}
export async function sendEmail(config, message) {
  if (!emailValid(message.to)) throw new EmailError('Alamat email penerima tidak valid.');
  if (config.provider === 'mailketing') return kirimEmailMailketing(message, config);
  if (config.provider !== 'smtp') throw new EmailError('Layanan email belum dipilih.');
  const transport = await smtpTransport(config);
  try {
    const info = await transport.sendMail({ from: { name: config.fromName, address: config.fromEmail }, ...message });
    if (!info.accepted?.length) throw new Error('not accepted');
    return info.messageId;
  } catch { throw new EmailError('Pengiriman SMTP gagal atau belum dapat dipastikan. Periksa log penyedia sebelum mengirim ulang.', 502); }
  finally { transport.close(); }
}
export const SAMPLE = { nama_toko: 'Toko Anda', nama_customer: 'Budi', nomor_order: 'WEB-CONTOH', rincian_order: '1. Gear Set — 2 x Rp 100.000 = Rp 200.000', total: 'Rp 200.000', metode_pembayaran: 'BRIVA', alamat: 'Jl. Contoh No. 1, Banyumas', telepon_customer: '081234567890', link_pesanan: 'https://toko.example/toko/akun?tab=pesanan', kode_reset: '123456', masa_berlaku: '10' };
