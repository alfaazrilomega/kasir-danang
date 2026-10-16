import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptConfig, encryptConfig, publicConfig, validateConfig } from '../integrasi/settings.js';
import * as tripay from '../integrasi/tripay.js';
import * as kiriminaja from '../integrasi/kiriminaja.js';
import * as onesender from '../integrasi/onesender.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({ default: {
  Pool: class { query = query; on() {} },
  types: { setTypeParser() {} },
} }));

const storeA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const storeB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const config = {
  enabled: true, mode: 'sandbox', merchantCode: 'T123', apiKey: 'test-api-key',
  privateKey: 'test-private-key', callbackUrl: '', returnUrl: '',
};
const shippingConfig = {
  enabled: true, mode: 'sandbox', token: 'shipping-token', originDistrict: '100', originSubdistrict: '200',
};
const oneSenderConfig = { phoneNumber: '6281234567890', apiUrl: 'http://164.152.166.165:3001/api/v1/messages', apiKey: 'onesender-test-key' };
const metaConfig = { wabaId: '123456789', phoneNumberId: '987654321', apiVersion: 'v23.0', accessToken: 'meta-test-token' };
let records;
let role;
let storeId;
let disabled;
let server;
let base;
let nativeFetch;

function token() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', 'integration-test-secret').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const response = await nativeFetch(`${base}${path}`, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${token()}` } : {}), 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'integration-test-secret');
  vi.stubEnv('INTEGRATION_SECRET', 'integration-test-encryption');
  vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/test');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('TRIPAY_API_KEY', '');
  vi.stubEnv('TRIPAY_PRIVATE_KEY', '');
  vi.stubEnv('TRIPAY_MERCHANT_CODE', '');
  vi.stubEnv('TRIPAY_MODE', 'sandbox');
  vi.stubEnv('KIRIMINAJA_TOKEN', '');
  vi.stubEnv('KIRIMINAJA_MODE', 'sandbox');
  const { default: app } = await import('../index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  nativeFetch = globalThis.fetch;
});

beforeEach(() => {
  records = new Map();
  role = 'admin'; storeId = storeA; disabled = false;
  query.mockReset();
  query.mockImplementation(async (sql, args = []) => {
    if (sql.includes('from public.app_users u')) return { rows: [{ id: userId, role, store_id: storeId }], rowCount: 1 };
    if (sql.includes('from public.role_permissions')) return { rows: disabled ? [{ capability: 'manageStoreSettings' }] : [] };
    if (sql.includes('select config_encrypted')) {
      const encrypted = records.get(`${args[0]}:${args[1]}`);
      return { rows: encrypted ? [{ config_encrypted: encrypted }] : [] };
    }
    if (sql.includes('insert into public.store_integrations')) {
      records.set(`${args[0]}:${args[1]}`, args[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('select id, store_id, payment_reference')) return {
      rows: [{ id: 'order-a', store_id: storeA, payment_reference: 'REF-A' }], rowCount: 1,
    };
    if (sql.includes('from public.stores')) return { rows: [{ id: storeId }], rowCount: 1 };
    if (sql.includes('update public.orders')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

describe('Penyimpanan rahasia integrasi', () => {
  it('mengenkripsi dengan nonce acak dan mengikat ciphertext ke toko/provider', () => {
    const encrypted = encryptConfig(config, `${storeA}:tripay`);
    expect(encrypted).not.toContain(config.apiKey);
    expect(encryptConfig(config, `${storeA}:tripay`)).not.toBe(encrypted);
    expect(decryptConfig(encrypted, `${storeA}:tripay`)).toEqual(config);
    expect(() => decryptConfig(encrypted, `${storeB}:tripay`)).toThrow();
    expect(() => decryptConfig(encrypted, `${storeA}:kiriminaja`)).toThrow();
  });

  it('tidak mengirim nilai rahasia ke admin', () => {
    expect(publicConfig('tripay', config)).toMatchObject({ hasApiKey: true, hasPrivateKey: true });
    expect(JSON.stringify(publicConfig('tripay', config))).not.toContain('test-api-key');
    expect(publicConfig('kiriminaja', shippingConfig)).not.toHaveProperty('token');
  });

  it('mempertahankan kunci saat field kosong dan menolak mode/URL/kredensial tidak valid', () => {
    expect(validateConfig('tripay', { ...config, apiKey: '', privateKey: '' }, config).apiKey).toBe(config.apiKey);
    expect(() => validateConfig('tripay', { ...config, mode: 'other' }, config)).toThrow();
    expect(() => validateConfig('tripay', { ...config, mode: 'production', apiKey: '' }, config)).toThrow(/Isi ulang/);
    expect(() => validateConfig('tripay', { ...config, callbackUrl: 'http://example.com' }, config)).toThrow(/HTTPS/);
    expect(() => validateConfig('tripay', { ...config, privateKey: null }, config)).toThrow(/Lengkapi/);
    expect(() => validateConfig('kiriminaja', { ...shippingConfig, originDistrict: '-1' }, shippingConfig)).toThrow(/positif/);
  });
});

describe('Endpoint admin', () => {
  it('menyimpan Meta terenkripsi per toko dan membaca ulang tanpa Access Token', async () => {
    const saved = await request('/api/admin/integrations/meta_whatsapp', { method: 'PATCH', body: { ...metaConfig, store_id: storeB } });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ wabaId: metaConfig.wabaId, phoneNumberId: metaConfig.phoneNumberId, apiVersion: metaConfig.apiVersion, hasAccessToken: true });
    const encrypted = records.get(`${storeA}:meta_whatsapp`);
    expect(encrypted).not.toContain(metaConfig.accessToken);
    expect(decryptConfig(encrypted, `${storeA}:meta_whatsapp`)).toEqual(metaConfig);
    expect(records.has(`${storeB}:meta_whatsapp`)).toBe(false);
    expect((await request('/api/admin/integrations/meta_whatsapp', { method: 'PATCH', body: { ...metaConfig, accessToken: '' } })).status).toBe(200);
    expect(decryptConfig(records.get(`${storeA}:meta_whatsapp`), `${storeA}:meta_whatsapp`).accessToken).toBe(metaConfig.accessToken);
    const loaded = await request('/api/admin/integrations');
    expect(loaded.body.data.meta_whatsapp.hasAccessToken).toBe(true);
    expect(JSON.stringify(loaded.body)).not.toContain(metaConfig.accessToken);
    storeId = storeB;
    expect((await request('/api/admin/integrations')).body.data.meta_whatsapp.hasAccessToken).toBe(false);
  });

  it('menolak konfigurasi Meta belum lengkap', async () => {
    expect((await request('/api/admin/integrations/meta_whatsapp', { method: 'PATCH', body: { ...metaConfig, accessToken: '' } })).status).toBe(400);
    expect((await request('/api/admin/integrations/meta_whatsapp', { method: 'PATCH', body: { ...metaConfig, phoneNumberId: 'abc' } })).status).toBe(400);
    expect(records.size).toBe(0);
  });

  it.each(['cashier', 'warehouse', 'customer'])('menolak pengaturan dan tes Meta oleh %s', async (value) => {
    role = value;
    expect((await request('/api/admin/integrations/meta_whatsapp', { method: 'PATCH', body: metaConfig })).status).toBe(403);
    expect((await request('/api/admin/integrations/meta_whatsapp/test', { method: 'POST' })).status).toBe(403);
  });

  it('tes Meta memakai token tersimpan dan tidak membocorkan respons galat penyedia', async () => {
    expect((await request('/api/admin/integrations/meta_whatsapp/test', { method: 'POST' })).status).toBe(400);
    records.set(`${storeA}:meta_whatsapp`, encryptConfig(metaConfig, `${storeA}:meta_whatsapp`));
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: metaConfig.phoneNumberId, display_phone_number: '+6281234567890' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 190, message: metaConfig.accessToken } }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const success = await request('/api/admin/integrations/meta_whatsapp/test', { method: 'POST' });
    expect(success.status).toBe(200);
    expect(success.body.data.message).toContain('+6281234567890');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${metaConfig.accessToken}`);
    const failed = await request('/api/admin/integrations/meta_whatsapp/test', { method: 'POST' });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toContain('kedaluwarsa');
    expect(JSON.stringify(failed.body)).not.toContain(metaConfig.accessToken);
  });

  it('menolak permintaan tanpa sesi', async () => {
    expect((await request('/api/admin/integrations', { auth: false })).status).toBe(401);
  });

  it.each(['cashier', 'warehouse', 'customer'])('menolak role %s untuk baca, simpan, dan tes', async (value) => {
    role = value;
    expect((await request('/api/admin/integrations')).status).toBe(403);
    expect((await request('/api/admin/integrations/tripay', { method: 'PATCH', body: config })).status).toBe(403);
    expect((await request('/api/admin/integrations/tripay/test', { method: 'POST' })).status).toBe(403);
  });

  it('mengikuti pembatasan manageStoreSettings', async () => {
    storeId = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
    disabled = true;
    expect((await request('/api/admin/integrations')).status).toBe(403);
  });

  it('menyimpan per toko, mempertahankan kunci kosong, dan membaca ulang tanpa rahasia', async () => {
    const saved = await request('/api/admin/integrations/tripay', { method: 'PATCH', body: { ...config, store_id: storeB } });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('cache-control')).toBe('no-store');
    expect(saved.body.data.hasApiKey).toBe(true);
    expect(saved.body.data).not.toHaveProperty('apiKey');
    expect(records.has(`${storeB}:tripay`)).toBe(false);
    const second = await request('/api/admin/integrations/tripay', { method: 'PATCH', body: { ...config, apiKey: '', privateKey: '', merchantCode: 'UPDATED' } });
    expect(second.status).toBe(200);
    expect(decryptConfig(records.get(`${storeA}:tripay`), `${storeA}:tripay`).apiKey).toBe(config.apiKey);
    const loaded = await request('/api/admin/integrations');
    expect(loaded.body.data.tripay.merchantCode).toBe('UPDATED');
    expect(JSON.stringify(loaded.body)).not.toContain(config.privateKey);
    storeId = storeB;
    expect((await request('/api/admin/integrations')).body.data.tripay.hasApiKey).toBe(false);
  });

  it('menolak payload invalid tanpa mengubah simpanan', async () => {
    expect((await request('/api/admin/integrations/tripay', { method: 'PATCH', body: { enabled: true, mode: 'sandbox' } })).status).toBe(400);
    expect(records.size).toBe(0);
    expect((await request('/api/admin/integrations/unknown', { method: 'PATCH', body: config })).status).toBe(400);
  });

  it('tes koneksi menggunakan kunci tersimpan dan menyembunyikan respons error penyedia', async () => {
    records.set(`${storeA}:tripay`, encryptConfig(config, `${storeA}:tripay`));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await request('/api/admin/integrations/tripay/test', { method: 'POST' })).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://tripay.co.id/api-sandbox/merchant/payment-channel');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: config.apiKey }), { status: 401 }));
    const failed = await request('/api/admin/integrations/tripay/test', { method: 'POST' });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain(config.apiKey);
  });

  it('menyimpan OneSender terenkripsi per toko dan mempertahankan kunci saat kosong', async () => {
    const saved = await request('/api/admin/integrations/onesender', { method: 'PATCH', body: { ...oneSenderConfig, phoneNumber: '081234567890', store_id: storeB } });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ phoneNumber: '6281234567890', apiUrl: oneSenderConfig.apiUrl, hasApiKey: true });
    expect(records.has(`${storeB}:onesender`)).toBe(false);
    const encrypted = records.get(`${storeA}:onesender`);
    expect(encrypted).not.toContain(oneSenderConfig.apiKey);
    expect(decryptConfig(encrypted, `${storeA}:onesender`)).toEqual(oneSenderConfig);
    expect((await request('/api/admin/integrations/onesender', { method: 'PATCH', body: { ...oneSenderConfig, apiKey: '' } })).status).toBe(200);
    expect(decryptConfig(records.get(`${storeA}:onesender`), `${storeA}:onesender`).apiKey).toBe(oneSenderConfig.apiKey);
    const loaded = await request('/api/admin/integrations');
    expect(loaded.body.data.onesender.hasApiKey).toBe(true);
    expect(JSON.stringify(loaded.body)).not.toContain(oneSenderConfig.apiKey);
    storeId = storeB;
    expect((await request('/api/admin/integrations')).body.data.onesender.hasApiKey).toBe(false);
  });

  it('menolak nomor, URL, dan kunci OneSender yang tidak lengkap', async () => {
    for (const patch of [{ phoneNumber: 'abc' }, { phoneNumber: '' }, { apiKey: '' }, { apiUrl: 'ftp://example.com/api/v1/messages' }, { apiUrl: 'http://127.0.0.1/api/v1/messages' }, { apiUrl: 'https://example.com/account/main' }]) {
      expect((await request('/api/admin/integrations/onesender', { method: 'PATCH', body: { ...oneSenderConfig, ...patch } })).status).toBe(400);
    }
    expect(records.size).toBe(0);
  });

  it('mewajibkan kunci baru bila server OneSender diganti', async () => {
    records.set(`${storeA}:onesender`, encryptConfig(oneSenderConfig, `${storeA}:onesender`));
    expect((await request('/api/admin/integrations/onesender', { method: 'PATCH', body: {
      ...oneSenderConfig, apiKey: '', apiUrl: 'https://new.example.com/api/v1/messages',
    } })).status).toBe(400);
  });

  it('membatasi pengaturan dan tes OneSender untuk admin', async () => {
    role = 'cashier';
    expect((await request('/api/admin/integrations/onesender', { method: 'PATCH', body: oneSenderConfig })).status).toBe(403);
    expect((await request('/api/admin/integrations/onesender/test', { method: 'POST' })).status).toBe(403);
  });

  it('tes OneSender memakai kredensial tersimpan tanpa membocorkan pesan atau galat penyedia', async () => {
    expect((await request('/api/admin/integrations/onesender/test', { method: 'POST' })).status).toBe(400);
    records.set(`${storeA}:onesender`, encryptConfig(oneSenderConfig, `${storeA}:onesender`));
    const spy = vi.spyOn(onesender, 'tesKoneksi').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error(oneSenderConfig.apiKey));
    try {
      const success = await request('/api/admin/integrations/onesender/test', { method: 'POST' });
      expect(success.status).toBe(200);
      expect(success.body.data.message).toContain('Status perangkat WhatsApp perlu diperiksa');
      expect(spy).toHaveBeenCalledWith(oneSenderConfig);
      const failed = await request('/api/admin/integrations/onesender/test', { method: 'POST' });
      expect(failed.status).toBe(502);
      expect(JSON.stringify(failed.body)).not.toContain(oneSenderConfig.apiKey);
    } finally { spy.mockRestore(); }
  });
});

describe('Pemakaian kredensial saat runtime', () => {
  it('mengisolasi cache kanal berdasarkan kredensial dan mode', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, data: [{ code: `channel-${fetchMock.mock.calls.length}` }] })));
    vi.stubGlobal('fetch', fetchMock);
    const a = { ...config, apiKey: 'cache-a' };
    const b = { ...config, apiKey: 'cache-b' };
    expect(await tripay.daftarKanal(a)).toEqual([{ code: 'channel-1' }]);
    expect(await tripay.daftarKanal(b)).toEqual([{ code: 'channel-2' }]);
    expect(await tripay.daftarKanal(a)).toEqual([{ code: 'channel-1' }]);
    await tripay.daftarKanal({ ...a, mode: 'production' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await tripay.daftarKanal({ ...a, enabled: false })).toEqual([]);
  });

  it('menggunakan konfigurasi toko untuk signature dan transaksi', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { reference: 'REF' } })));
    vi.stubGlobal('fetch', fetchMock);
    await tripay.buatTransaksi({ method: 'BRIVA', merchantRef: 'INV', amount: 10000, items: [] }, config);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.signature).toBe(crypto.createHmac('sha256', config.privateKey).update('T123INV10000').digest('hex'));
  });

  it('memakai token dan wilayah asal toko untuk ongkir, mengabaikan asal dari pembeli', async () => {
    records.set(`${storeA}:kiriminaja`, encryptConfig(shippingConfig, `${storeA}:kiriminaja`));
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: true, results: [{ cost: 10000 }] })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await request('/api/public/shipping-rates', { method: 'POST', auth: false, body: {
      store_id: storeA, origin: 999, subdistrict_origin: 999, destination: 300, subdistrict_destination: 400, weight: 1000,
    } });
    expect(result.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ origin: 100, subdistrict_origin: 200 });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer shipping-token');
    await kiriminaja.tesKoneksi(shippingConfig);
    expect(fetchMock.mock.calls[1][0]).toBe('https://tdev.kiriminaja.com/api/mitra/province');
  });

  it('memverifikasi callback menggunakan toko pesanan dan membatasi update ke pesanan itu', async () => {
    records.set(`${storeA}:tripay`, encryptConfig(config, `${storeA}:tripay`));
    const body = { reference: 'REF-A', merchant_ref: 'INV-A', status: 'PAID' };
    const signature = crypto.createHmac('sha256', config.privateKey).update(JSON.stringify(body)).digest('hex');
    const result = await request('/api/tripay/callback', { method: 'POST', auth: false, body, headers: {
      'X-Callback-Signature': signature, 'X-Callback-Event': 'payment_status',
    } });
    expect(result.status).toBe(200);
    const update = query.mock.calls.find(([sql]) => sql.includes('update public.orders'));
    expect(update[1]).toEqual(['order-a', storeA]);
    expect(update[0]).toContain('where id = $1 and store_id = $2');
  });

  it('menolak callback dengan signature atau referensi berbeda tanpa update', async () => {
    records.set(`${storeA}:tripay`, encryptConfig(config, `${storeA}:tripay`));
    const body = { reference: 'REF-A', merchant_ref: 'INV-A', status: 'PAID' };
    expect((await request('/api/tripay/callback', { method: 'POST', auth: false, body, headers: {
      'X-Callback-Signature': 'invalid', 'X-Callback-Event': 'payment_status',
    } })).status).toBe(403);
    expect((await request('/api/tripay/callback', { method: 'POST', auth: false, body: { ...body, reference: 'REF-B' } })).status).toBe(403);
    expect(query.mock.calls.some(([sql]) => sql.includes('update public.orders'))).toBe(false);
  });
});
