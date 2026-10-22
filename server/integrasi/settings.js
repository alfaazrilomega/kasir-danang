import crypto from 'node:crypto';
import * as tripay from './tripay.js';
import * as kiriminaja from './kiriminaja.js';
import { validateApiUrl } from './onesender.js';
import { validateSettings as validateMetaSettings } from './metaWhatsapp.js';

export class IntegrationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function encryptionKey() {
  const secret = process.env.INTEGRATION_SECRET || process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new IntegrationError('Atur AUTH_SECRET atau INTEGRATION_SECRET di server sebelum menyimpan integrasi.', 503);
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptConfig(config, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

export function decryptConfig(value, context) {
  try {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  } catch {
    throw new IntegrationError('Kredensial integrasi tidak dapat dibaca. Periksa kunci enkripsi server.', 503);
  }
}

export function assertProvider(provider) {
  if (!['tripay', 'mayar', 'doku', 'kiriminaja', 'onesender', 'meta_whatsapp'].includes(provider)) throw new IntegrationError('Integrasi tidak dikenal.');
}

export function defaults(provider) {
  assertProvider(provider);
  if (provider === 'meta_whatsapp') return { wabaId: '', phoneNumberId: '', apiVersion: '', accessToken: '' };
  if (provider === 'mayar') return { enabled: false, mode: 'sandbox', apiKey: '' };
  if (provider === 'doku') return { enabled: false, mode: 'sandbox', clientId: '', secretKey: '' };
  if (provider === 'onesender') return { phoneNumber: '', apiUrl: '', apiKey: '' };
  if (provider === 'tripay') return {
    ...tripay.konfigurasi(), enabled: tripay.tripayAktif(),
    callbackUrl: process.env.TRIPAY_CALLBACK_URL || '',
    returnUrl: process.env.TRIPAY_RETURN_URL || '',
  };
  return {
    ...kiriminaja.konfigurasi(), enabled: kiriminaja.kiriminAjaAktif(),
    originDistrict: process.env.KIRIMINAJA_ORIGIN_DISTRICT || '',
    originSubdistrict: process.env.KIRIMINAJA_ORIGIN_SUBDISTRICT || '',
  };
}

export async function loadIntegration(db, storeId, provider) {
  assertProvider(provider);
  const result = await db.query(
    'select config_encrypted from public.store_integrations where store_id = $1 and provider = $2',
    [storeId, provider],
  );
  return result.rows[0]
    ? decryptConfig(result.rows[0].config_encrypted, `${storeId}:${provider}`)
    : defaults(provider);
}

export function publicConfig(provider, config) {
  if (provider === 'meta_whatsapp') return {
    wabaId: config.wabaId, phoneNumberId: config.phoneNumberId,
    apiVersion: config.apiVersion, hasAccessToken: !!config.accessToken,
  };
  if (provider === 'onesender') return {
    phoneNumber: config.phoneNumber, apiUrl: config.apiUrl, hasApiKey: !!config.apiKey,
  };
  const common = { enabled: config.enabled, mode: config.mode };
  if (provider === 'mayar') return { ...common, hasApiKey: !!config.apiKey };
  if (provider === 'doku') return { ...common, clientId: config.clientId, hasSecretKey: !!config.secretKey };
  if (provider === 'tripay') return {
    ...common, merchantCode: config.merchantCode, callbackUrl: config.callbackUrl,
    returnUrl: config.returnUrl, hasApiKey: !!config.apiKey, hasPrivateKey: !!config.privateKey,
  };
  return { ...common, hasToken: !!config.token, originDistrict: config.originDistrict, originSubdistrict: config.originSubdistrict, originLabel: config.originLabel || '' };
}

export function validateConfig(provider, body, previous) {
  assertProvider(provider);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IntegrationError('Pengaturan tidak valid.');
  if (provider === 'meta_whatsapp') {
    try { return validateMetaSettings(body, previous); }
    catch (error) { throw new IntegrationError(error.message); }
  }
  const config = { ...previous };
  if (provider !== 'onesender' && typeof body.enabled !== 'boolean') throw new IntegrationError('Status integrasi tidak valid.');
  if (provider !== 'onesender' && !['sandbox', 'production'].includes(body.mode)) throw new IntegrationError('Mode harus sandbox atau production.');
  if (provider !== 'onesender') config.enabled = body.enabled;
  if (provider !== 'onesender') config.mode = body.mode;
  const secrets = ['onesender', 'mayar'].includes(provider) ? ['apiKey'] : provider === 'tripay' ? ['apiKey', 'privateKey'] : provider === 'doku' ? ['secretKey'] : ['token'];
  const fields = provider === 'mayar' ? secrets : provider === 'doku' ? ['clientId', ...secrets] : provider === 'onesender' ? ['phoneNumber', 'apiUrl', ...secrets] : provider === 'tripay'
    ? ['merchantCode', 'callbackUrl', 'returnUrl', ...secrets]
    : ['originDistrict', 'originSubdistrict', 'originLabel', ...secrets];
  for (const field of fields) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null && secrets.includes(field)) { config[field] = ''; continue; }
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new IntegrationError(`Isian ${field} tidak valid.`);
    if (secrets.includes(field) && !value.trim()) continue;
    config[field] = value.trim();
  }
  // Mode baru wajib menggunakan kredensial baru agar kunci sandbox tidak terbawa ke produksi.
  if (config.mode !== previous.mode && secrets.some((field) => !body[field]?.trim())) {
    throw new IntegrationError('Isi ulang seluruh kunci API saat mengganti mode.');
  }
  for (const field of ['callbackUrl', 'returnUrl']) {
    if (!config[field]) continue;
    let url;
    try { url = new URL(config[field]); } catch { throw new IntegrationError(`${field} harus berupa URL HTTPS.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new IntegrationError(`${field} harus berupa URL HTTPS tanpa kredensial atau fragmen.`);
  }
  for (const field of ['originDistrict', 'originSubdistrict']) {
    if (config[field] && !/^[1-9]\d{0,9}$/.test(config[field])) throw new IntegrationError('ID wilayah asal harus berupa bilangan bulat positif.');
  }
  if (provider === 'onesender') {
    if (config.phoneNumber) {
      if (!/^\+?[\d\s()-]+$/.test(config.phoneNumber)) throw new IntegrationError('Phone number tidak valid.');
      let phone = config.phoneNumber.replace(/\D/g, '');
      if (phone.startsWith('0')) phone = `62${phone.slice(1)}`;
      else if (phone.startsWith('8')) phone = `62${phone}`;
      if (!/^[1-9]\d{7,14}$/.test(phone)) throw new IntegrationError('Phone number harus 8–15 digit dengan kode negara.');
      config.phoneNumber = phone;
    }
    if (config.apiUrl) {
      try { config.apiUrl = validateApiUrl(config.apiUrl).href; }
      catch (error) { throw new IntegrationError(error.message); }
    }
    if (config.apiUrl !== previous.apiUrl && previous.apiKey && !body.apiKey?.trim()) {
      throw new IntegrationError('Isi ulang API Key saat mengganti API URL OneSender.');
    }
  }
  if (provider === 'doku' && config.clientId && !/^[A-Za-z0-9-_]{4,64}$/.test(config.clientId)) throw new IntegrationError('Client ID DOKU tidak valid.');
  const required = provider === 'mayar' ? secrets : provider === 'doku' ? ['clientId', ...secrets] : provider === 'onesender' ? ['phoneNumber', 'apiUrl', ...secrets]
    : provider === 'tripay' ? ['merchantCode', ...secrets] : [...secrets, 'originDistrict', 'originSubdistrict'];
  if ((config.enabled || provider === 'onesender') && required.some((field) => !config[field])) throw new IntegrationError('Lengkapi kredensial dan isian wajib integrasi.');
  delete config.base;
  return config;
}

export async function saveIntegration(db, storeId, provider, body) {
  const config = validateConfig(provider, body, await loadIntegration(db, storeId, provider));
  await db.query(
    `insert into public.store_integrations (store_id, provider, config_encrypted)
     values ($1, $2, $3) on conflict (store_id, provider)
     do update set config_encrypted = excluded.config_encrypted, updated_at = now()`,
    [storeId, provider, encryptConfig(config, `${storeId}:${provider}`)],
  );
  return publicConfig(provider, config);
}
