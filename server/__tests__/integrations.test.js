import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptConfig, encryptConfig, publicConfig, validateConfig } from '../integrasi/settings.js';
import * as tripay from '../integrasi/tripay.js';
import * as kiriminaja from '../integrasi/kiriminaja.js';
import * as onesender from '../integrasi/onesender.js';
import * as whatsapp from '../integrasi/whatsappNotifications.js';
import * as emailSettings from '../integrasi/emailSettings.js';

const query = vi.hoisted(() => vi.fn());
const clientQuery = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({ default: {
  Pool: class { query = query; on() {} async connect() { return { query: clientQuery, release() {} }; } },
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
  vi.stubEnv('PUBLIC_ORDER_RATE_MAX', '1000');
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
  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  query.mockImplementation(async (sql, args = []) => {
    if (sql.includes('from public.store_payment_settings')) return { rows: records.has(`${args[0]}:gateway`) ? [{ provider: records.get(`${args[0]}:gateway`) }] : [] };
    if (sql.includes('insert into public.store_payment_settings')) { records.set(`${args[0]}:gateway`, args[1]); return { rows: [], rowCount: 1 }; }
    if (sql.includes('from public.app_users u')) return { rows: [{ id: userId, role, store_id: storeId }], rowCount: 1 };
    if (sql.includes('from public.role_permissions')) return { rows: disabled ? [{ capability: 'manageStoreSettings' }] : [] };
    if (sql.includes('from public.store_email_settings')) return { rows: records.has(`${args[0]}:email`) ? [records.get(`${args[0]}:email`)] : [] };
    if (sql.includes('insert into public.store_email_settings')) {
      records.set(`${args[0]}:email`, { config_encrypted: args[1], templates: JSON.parse(args[2]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('select config_encrypted')) {
      const encrypted = records.get(`${args[0]}:${args[1]}`);
      return { rows: encrypted ? [{ config_encrypted: encrypted }] : [] };
    }
    if (sql.includes('select config from public.whatsapp_settings')) {
      const config = records.get(`${args[0]}:whatsapp-settings`);
      return { rows: config ? [{ config }] : [] };
    }
    if (sql.includes('insert into public.whatsapp_settings')) {
      records.set(`${args[0]}:whatsapp-settings`, JSON.parse(args[1]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('update public.whatsapp_reminders')) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.whatsapp_reminders r')) return { rows: [], rowCount: 0 };
    if (sql.includes('insert into public.store_integrations')) {
      records.set(`${args[0]}:${args[1]}`, args[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('select id, store_id, payment_reference')) return {
      rows: [{ id: 'order-a', store_id: storeA, payment_reference: 'REF-A', payment_channel: 'BRIVA', total: 10000, shipping_cost: 0 }], rowCount: 1,
    };
    if (sql.includes('from public.customers c')) return { rows: [{ id: userId, store_id: storeA, email: 'buyer@example.com' }], rowCount: 1 };
    if (sql.includes('from public.products')) return { rows: [{ id: storeB, name: 'Produk Uji', base_price: 10000, cost_price: 5000 }], rowCount: 1 };
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { reference: 'REF', checkout_url: 'https://tripay.co.id/checkout/REF' } })));
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
    const body = { reference: 'REF-A', merchant_ref: 'INV-A', status: 'PAID', is_closed_payment: 1, payment_method_code: 'BRIVA', total_amount: 11000, fee_customer: 1000 };
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

describe('Kanal dan checkout Tripay', () => {
  const activeChannel = { code: 'BRIVA', name: 'BRI Virtual Account', group: 'Virtual Account', type: 'direct', active: true,
    fee_customer: { flat: 0, percent: 0 }, total_fee: { flat: 4250, percent: 0 }, minimum_amount: 10000, maximum_amount: 10000000 };
  const orderInput = { store_id: storeA, customer_name: 'Pembeli Uji', customer_phone: '081234567890', delivery_address: 'Alamat Uji',
    payment_method: 'cash', payment_channel: 'BRIVA', items: [{ product_id: storeB, qty: 1 }] };
  function setupGateway(channels = [activeChannel], rejectTransaction = false) {
    records.set(`${storeA}:tripay`, encryptConfig(config, `${storeA}:tripay`));
    const mock = vi.fn().mockImplementation(async (url) => {
      let data;
      if (url.includes('payment-channel')) data = channels;
      else if (url.includes('fee-calculator')) data = [{ code: 'BRIVA', total_fee: { customer: 0, merchant: 4250 } }];
      else if (url.includes('transaction/create')) {
        if (rejectTransaction) return new Response(JSON.stringify({ success: false, message: 'Invalid signature' }));
        data = { reference: 'REF-A', checkout_url: 'https://tripay.co.id/checkout/REF-A', amount: 10000, fee_customer: 0 };
      } else throw new Error(`Unexpected gateway path: ${url}`);
      return new Response(JSON.stringify({ success: true, data }));
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('menampilkan semua status di admin dan hanya kanal aktif di checkout dengan biaya pelanggan', async () => {
    setupGateway([activeChannel, { ...activeChannel, code: 'OFF', active: false }, { ...activeChannel, code: 'ZERO', active: 0 }]);
    const admin = await request('/api/admin/integrations/tripay/channels');
    expect(admin.status).toBe(200);
    expect(admin.body.data.channels.map((k) => k.active)).toEqual([true, false, false]);
    expect(admin.body.data.channels[0].fee_flat).toBe(0);
    const customer = await request(`/api/public/payment-channels?store_id=${storeA}&amount=10000`, { auth: false });
    expect(customer.body.data.channels).toHaveLength(1);
    expect(customer.body.data.channels[0]).toMatchObject({ code: 'BRIVA', fee_flat: 0, fee_customer: 0 });
    expect(customer.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(admin.body)).not.toContain(config.apiKey);
  });

  it('tes koneksi mengembalikan kanal terkini agar perubahan dashboard langsung tersinkron', async () => {
    setupGateway([activeChannel]);
    const result = await request('/api/admin/integrations/tripay/test', { method: 'POST' });
    expect(result.body.data).toMatchObject({ mode: 'sandbox', channels: [{ code: 'BRIVA', active: true }] });
    expect(result.body.data.message).toContain('1 kanal aktif');
  });

  it('membatasi daftar kanal admin ke admin toko yang masuk', async () => {
    setupGateway();
    role = 'cashier';
    expect((await request('/api/admin/integrations/tripay/channels')).status).toBe(403);
  });

  it('membedakan integrasi nonaktif dan kegagalan koneksi tanpa membocorkan rahasia', async () => {
    records.set(`${storeA}:tripay`, encryptConfig({ ...config, enabled: false }, `${storeA}:tripay`));
    expect((await request(`/api/public/payment-channels?store_id=${storeA}`, { auth: false })).body.data).toMatchObject({ active: false, channels: [] });
    records.set(`${storeA}:tripay`, encryptConfig({ ...config, apiKey: 'uncached-secret' }, `${storeA}:tripay`));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('uncached-secret')));
    const failed = await request(`/api/public/payment-channels?store_id=${storeA}`, { auth: false });
    expect(failed.status).toBe(503);
    expect(failed.body.error).toContain('Coba lagi');
    expect(JSON.stringify(failed.body)).not.toContain('uncached-secret');
  });

  it('menolak nominal kalkulator tidak valid sebelum memanggil Tripay', async () => {
    const mock = setupGateway();
    expect((await request(`/api/public/payment-channels?store_id=${storeA}&amount=-1`)).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });

  it('membuat transaksi dengan kanal terpilih, signature, nominal server dan masa berlaku 1 jam', async () => {
    const mock = setupGateway();
    const result = await request('/api/public/orders', { method: 'POST', body: { ...orderInput, amount: 1 } });
    expect(result.status).toBe(200);
    expect(result.body.data.payment).toMatchObject({ channel: 'BRIVA', reference: 'REF-A', checkout_url: 'https://tripay.co.id/checkout/REF-A' });
    const createCall = mock.mock.calls.find(([url]) => url.includes('transaction/create'));
    const body = JSON.parse(createCall[1].body);
    expect(body).toMatchObject({ method: 'BRIVA', amount: 10000, customer_email: 'buyer@example.com', order_items: [{ name: 'Produk Uji', price: 10000, quantity: 1 }] });
    expect(body.signature).toBe(crypto.createHmac('sha256', config.privateKey).update(`${config.merchantCode}${body.merchant_ref}10000`).digest('hex'));
    expect(body.expired_time - Math.floor(Date.now() / 1000)).toBeGreaterThan(3595);
    expect(body.expired_time - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
    expect(clientQuery.mock.calls.some(([sql]) => sql === 'commit')).toBe(true);
    expect(query.mock.calls.find(([sql]) => sql.includes('set payment_channel'))[1].slice(1, 4)).toEqual(['BRIVA', 'REF-A', 'https://tripay.co.id/checkout/REF-A']);
  });

  it.each([false, 0, '0', undefined])('menolak kanal nonaktif %s sebelum menyimpan pesanan', async (active) => {
    const mock = setupGateway([{ ...activeChannel, active }]);
    const result = await request('/api/public/orders', { method: 'POST', body: orderInput });
    expect(result.status).toBe(400);
    expect(clientQuery).not.toHaveBeenCalled();
    expect(mock.mock.calls.some(([url]) => url.includes('transaction/create'))).toBe(false);
  });

  it('mengembalikan rollback harga flash ketika nominal tidak memenuhi minimum kanal', async () => {
    const mock = setupGateway([{ ...activeChannel, minimum_amount: 20000 }]);
    const result = await request('/api/public/orders', { method: 'POST', body: orderInput });
    expect(result.status).toBe(400);
    expect(clientQuery.mock.calls.some(([sql]) => sql === 'rollback')).toBe(true);
    expect(clientQuery.mock.calls.some(([sql]) => sql.includes('insert into public.orders'))).toBe(false);
    expect(mock.mock.calls.some(([url]) => url.includes('transaction/create'))).toBe(false);
  });

  it('kegagalan gateway tetap mengembalikan nomor pesanan dan peringatan pemeriksaan transaksi', async () => {
    setupGateway([activeChannel], true);
    const result = await request('/api/public/orders', { method: 'POST', body: orderInput });
    expect(result.status).toBe(200);
    expect(result.body.data.order_number).toMatch(/^WEB-/);
    expect(result.body.data.payment.error).toContain('sebelum membayar atau membuat pesanan baru');
    expect(result.body.data.payment.checkout_url).toBeUndefined();
  });

  it.each([
    { total_amount: 9999 }, { fee_customer: -1 }, { is_closed_payment: 0 }, { payment_method_code: 'QRIS' },
  ])('menolak callback bertanda tangan sah dengan data transaksi tidak cocok %j', async (patch) => {
    setupGateway();
    const body = { reference: 'REF-A', merchant_ref: 'INV-A', status: 'PAID', is_closed_payment: 1,
      payment_method_code: 'BRIVA', total_amount: 10000, fee_customer: 0, ...patch };
    const result = await request('/api/tripay/callback', { method: 'POST', auth: false, body, headers: {
      'X-Callback-Signature': crypto.createHmac('sha256', config.privateKey).update(JSON.stringify(body)).digest('hex'),
      'X-Callback-Event': 'payment_status',
    } });
    expect(result.status).toBe(400);
    expect(query.mock.calls.some(([sql]) => sql.includes('update public.orders'))).toBe(false);
  });
});

describe('Endpoint template WhatsApp', () => {
  it('menyimpan opsi reminder, menolak jadwal salah, dan membaca antrean sesuai toko sesi', async () => {
    const settings = { ...whatsapp.defaultSettings(), reminders: { enabled: true, minutes: [10,30,50] } };
    expect((await request('/api/admin/whatsapp/settings', { method: 'PUT', body: settings })).body.data.reminders).toEqual(settings.reminders);
    const result = await request('/api/admin/whatsapp/settings', { method: 'PUT', body: { ...settings, reminders: { enabled: true, minutes: [10,5,50] } } });
    expect(result.status).toBe(400);
    expect((await request('/api/admin/whatsapp/settings')).body.data.settings.reminders).toEqual(settings.reminders);
    expect((await request('/api/admin/whatsapp/reminders?store_id=' + storeB)).status).toBe(200);
    expect(query.mock.calls.find(([sql]) => sql.includes('from public.whatsapp_reminders r'))[1]).toEqual([storeA]);
  });

  it('checkout membuat jadwal reminder dalam transaksi pesanan', async () => {
    const settings = { ...whatsapp.defaultSettings(), reminders: { enabled: true, minutes: [10,30,50] } };
    clientQuery.mockImplementation(async sql => ({ rows: sql.includes('from public.whatsapp_settings') ? [{ config: settings }] : [], rowCount: 0 }));
    const result = await request('/api/public/orders', { method: 'POST', body: { store_id: storeA, customer_name: 'Pembeli', customer_phone: '081234567890', delivery_address: 'Alamat', payment_method: 'transfer', items: [{ product_id: storeB, qty: 1 }] } });
    expect(result.status).toBe(200);
    const calls = clientQuery.mock.calls;
    const jobs = calls.filter(([sql]) => sql.includes('insert into public.whatsapp_reminders'));
    expect(jobs).toHaveLength(3);
    expect(jobs.map(([,args]) => args[3])).toEqual(['wa1','wa2','wa3']);
    expect(jobs.every(([,args]) => args[1] === storeA && args[2] === result.body.data.order_id)).toBe(true);
    expect(calls.findIndex(([sql]) => sql.includes('insert into public.whatsapp_reminders'))).toBeLessThan(calls.findIndex(([sql]) => sql === 'commit'));
  });

  it('memuat default OneSender dan menyimpan pengaturan hanya pada toko sesi', async () => {
    const loaded = await request('/api/admin/whatsapp/settings');
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.settings.provider).toBe('onesender');
    const settings = whatsapp.defaultSettings();
    settings.templates.wa1.text = 'Halo {nama_customer}, rincian {nomor_order}.';
    const result = await request('/api/admin/whatsapp/settings', { method: 'PUT', body: { ...settings, store_id: storeB } });
    expect(result.status).toBe(200);
    expect(records.has(`${storeA}:whatsapp-settings`)).toBe(true);
    expect(records.has(`${storeB}:whatsapp-settings`)).toBe(false);
    storeId = storeB;
    expect((await request('/api/admin/whatsapp/settings')).body.data.settings.templates.wa1.text).not.toBe(settings.templates.wa1.text);
  });
  it('menolak variabel template tidak dikenal dengan HTTP 400', async () => {
    const settings = whatsapp.defaultSettings(); settings.templates.wa2.text = 'Halo {unknown}';
    const result = await request('/api/admin/whatsapp/settings', { method: 'PUT', body: settings });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('Variabel template');
  });
  it.each(['cashier', 'warehouse', 'customer'])('mencegah role %s membaca template atau mengirim follow-up', async (value) => {
    role = value;
    for (const [path, method] of [
      ['/api/admin/whatsapp/settings', 'GET'], ['/api/admin/whatsapp/settings', 'PUT'],
      ['/api/admin/whatsapp/reminders', 'GET'],
      ['/api/admin/whatsapp/messages', 'GET'], [`/api/admin/customers/${userId}/whatsapp/preview`, 'POST'],
      [`/api/admin/customers/${userId}/whatsapp/orders`, 'GET'], [`/api/admin/whatsapp/messages/${storeB}/send`, 'POST'],
    ]) expect((await request(path, { method, ...(method === 'PUT' ? { body: {} } : {}) })).status).toBe(403);
  });
  it('mengirim notifikasi setelah checkout tersimpan walau email gagal', async () => {
    const notify = vi.spyOn(whatsapp, 'notifyOrder').mockResolvedValue(undefined);
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql, args) => {
      if (sql.includes('select name from public.stores')) throw new Error('Simulasi email gagal');
      return original(sql, args);
    });
    try {
      const result = await request('/api/public/orders', { method: 'POST', body: { store_id: storeA, customer_name: 'Budi', customer_phone: '081234567890', delivery_address: 'Alamat', payment_method: 'cash', items: [{ product_id: storeB, qty: 1 }] } });
      expect(result.status).toBe(200);
      expect(clientQuery.mock.calls.some(([sql]) => sql === 'commit')).toBe(true);
      expect(notify).toHaveBeenCalledWith(expect.anything(), { storeId: storeA, customerId: userId, orderId: result.body.data.order_id });
    } finally { notify.mockRestore(); }
  });

  it.each(['pi', '0812abc34567890', '123', '6281,6282', '0'.repeat(21)])('menolak nomor checkout %s sebelum menyimpan order atau mengirim notifikasi', async (phone) => {
    const notify = vi.spyOn(whatsapp, 'notifyOrder').mockResolvedValue(undefined);
    try {
      const result = await request('/api/public/orders', { method: 'POST', body: { store_id: storeA, customer_name: 'Budi', customer_phone: phone, delivery_address: 'Alamat', payment_method: 'cash', items: [{ product_id: storeB, qty: 1 }] } });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/Nomor (WhatsApp|HP)/);
      expect(clientQuery).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    } finally { notify.mockRestore(); }
  });
});

describe('Endpoint email dan template', () => {
  const settings = () => ({ config: { ...emailSettings.defaultConfig(), provider: 'mailketing', fromName: 'Toko Uji', fromEmail: 'admin@toko.test', apiToken: 'email-secret' }, templates: emailSettings.defaultTemplates() });
  it('menyimpan rahasia terenkripsi sesuai toko sesi dan mengembalikan konfigurasi tersensor', async () => {
    const result = await request('/api/admin/email/settings', { method: 'PUT', body: { ...settings(), store_id: storeB } });
    expect(result.status).toBe(200);expect(JSON.stringify(result.body)).not.toContain('email-secret');
    expect(result.body.data.config.hasApiToken).toBe(true);
    const row = records.get(`${storeA}:email`);expect(row.config_encrypted).not.toContain('email-secret');
    expect(decryptConfig(row.config_encrypted, `${storeA}:email`).apiToken).toBe('email-secret');
    const saved = await request('/api/admin/email/settings', { method: 'PUT', body: result.body.data });
    expect(saved.status).toBe(200);
    expect(decryptConfig(records.get(`${storeA}:email`).config_encrypted, `${storeA}:email`).apiToken).toBe('email-secret');
    storeId = storeB;const other = await request('/api/admin/email/settings');expect(other.body.data.config.provider).toBe('server');
    expect(other.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['cashier', 'warehouse', 'customer'])('menolak role %s untuk pengaturan, tes dan pratinjau', async (value) => {
    role = value;
    for (const [path, method] of [['settings', 'GET'], ['settings', 'PUT'], ['test', 'POST'], ['preview', 'POST']]) {
      expect((await request(`/api/admin/email/${path}`, { method, ...(method !== 'GET' ? { body: settings() } : {}) })).status).toBe(403);
    }
  });
  it('menolak pengunjung tanpa sesi dan admin dengan izin pengaturan dimatikan', async () => {
    expect((await request('/api/admin/email/settings', { auth: false })).status).toBe(401);
    disabled = true;storeId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddde';expect((await request('/api/admin/email/settings')).status).toBe(403);
  });
  it('pratinjau HTML tersanitasi memakai data contoh tanpa mengirim', async () => {
    const templates = emailSettings.defaultTemplates();templates.order_customer.html = '<p>Halo {nama_customer}</p><script>alert(1)</script>';
    const send = vi.spyOn(emailSettings, 'sendEmail');
    try {
      const result = await request('/api/admin/email/preview', { method: 'POST', body: { key: 'order_customer', templates } });
      expect(result.status).toBe(200);expect(result.body.data.html).toContain('Halo Budi');expect(result.body.data.html).not.toContain('<script>');expect(send).not.toHaveBeenCalled();
    } finally { send.mockRestore(); }
  });
  it('tes koneksi menggunakan kredensial tersimpan dan bukan body', async () => {
    await request('/api/admin/email/settings', { method: 'PUT', body: settings() });
    const test = vi.spyOn(emailSettings, 'testConnection').mockResolvedValue({ message: 'Koneksi berhasil' });
    try {
      const result = await request('/api/admin/email/test', { method: 'POST', body: { config: { apiToken: 'attacker' } } });
      expect(result.status).toBe(200);expect(test).toHaveBeenCalledWith(expect.objectContaining({ apiToken: 'email-secret' }));
    } finally { test.mockRestore(); }
  });
  it('checkout menggunakan template email tersimpan, kedua penerima independen dari kegagalan salah satu', async () => {
    const body = settings();body.config.orderNotifyEmail = 'admin@tokouji.id';body.templates.order_customer.subject = 'Halo {nama_customer} - {nomor_order}';
    await request('/api/admin/email/settings', { method: 'PUT', body });
    const original = query.getMockImplementation();query.mockImplementation(async (sql, args) => {
      if (sql.includes('from public.customers c')) return { rows: [{ id: userId, store_id: storeA, email: 'buyer@tokouji.id' }], rowCount: 1 };
      return original(sql, args);
    });
    const send = vi.spyOn(emailSettings, 'sendEmail').mockRejectedValueOnce(new Error('simulasi gagal')).mockResolvedValue('mail-id');
    const wa = vi.spyOn(whatsapp, 'notifyOrder').mockResolvedValue();
    try {
      const result = await request('/api/public/orders', { method: 'POST', body: { store_id: storeA, customer_name: 'Pembeli Uji', customer_phone: '081234567890', delivery_address: 'Alamat Uji', payment_method: 'cash', items: [{ product_id: storeB, qty: 1 }] } });
      expect(result.status).toBe(200);expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toMatchObject({ to: 'buyer@tokouji.id', subject: expect.stringMatching(/^Halo Pembeli Uji - WEB-/), html: expect.stringContaining('Produk Uji') });
      expect(send.mock.calls[1][1].to).toBe('admin@tokouji.id');expect(wa).toHaveBeenCalled();
    } finally { send.mockRestore();wa.mockRestore(); }
  });
});

describe('Reset kata sandi dengan email per toko', () => {
  it('memakai provider dan template toko tanpa mensyaratkan SMTP environment', async () => {
    const templates = emailSettings.defaultTemplates();templates.password_reset.html = '<h2>Kode toko: {kode_reset}</h2><p>Berlaku {masa_berlaku} menit</p>';
    const config = { ...emailSettings.defaultConfig(), provider: 'mailketing', apiToken: 'reset-api', fromName: 'Toko', fromEmail: 'noreply@toko.test' };
    records.set(`${storeA}:email`, { config_encrypted: encryptConfig(config, `${storeA}:email`), templates });
    const original = query.getMockImplementation();query.mockImplementation(async (sql, args) => {
      if (sql.includes('from public.app_users u')) return { rows: [{ id: userId, role: 'customer', email: 'buyer@tokouji.id' }], rowCount: 1 };
      if (sql.includes('public.customer_password_resets')) return { rows: [], rowCount: 1 };
      return original(sql, args);
    });
    const send = vi.spyOn(emailSettings, 'sendEmail').mockResolvedValue('mail-id');
    try {
      const result = await request('/api/customer/password/forgot', { method: 'POST', auth: false, body: { store_id: storeA, identifier: 'buyer@tokouji.id' } });
      expect(result.status).toBe(200);expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][0].apiToken).toBe('reset-api');
      expect(send.mock.calls[0][1].html).toMatch(/Kode toko: \d{6}/);
      expect(send.mock.calls[0][1].html).toContain('Berlaku 10 menit');
      expect(JSON.stringify(result.body)).not.toMatch(/reset-api|Kode toko|\d{6}/);
    } finally { send.mockRestore(); }
  });
});

describe('Checkout dengan satu gateway dan Mayar', () => {
  const mayarConfig = { enabled: true, mode: 'sandbox', apiKey: 'mayar-private-key' };
  const input = { store_id: storeA, customer_name: 'Pembeli', customer_phone: '081234567890', delivery_address: 'Alamat', payment_method: 'transfer', payment_channel: 'MAYAR', payment_provider: 'mayar', items: [{ product_id: storeB, qty: 1 }] };
  const requestId = '11111111-1111-4111-a111-111111111111';
  const transactionId = '22222222-2222-4222-a222-222222222222';
  function setup(failCreate = false) {
    records.set(`${storeA}:mayar`, encryptConfig(mayarConfig, `${storeA}:mayar`));
    records.set(`${storeA}:gateway`, 'mayar');
    const fetch = vi.fn().mockImplementation(async (url) => {
      if (url.endsWith('/payment-channels')) return new Response(JSON.stringify({ statusCode: 200, data: { config: [{ code: 'QRIS', type: 'qris', name: 'QRIS', status: true }, { code: 'BNI', type: 'va', name: 'BNI', status: false }] } }));
      if (url.endsWith('/payments/create') && !failCreate) return new Response(JSON.stringify({ statusCode: 200, data: { id: requestId, transactionId, link: 'https://merchant.myr.id/pl/order' } }));
      throw new Error('simulated timeout');
    }); vi.stubGlobal('fetch', fetch); return fetch;
  }
  it('menyimpan kunci Mayar terenkripsi dan tidak membocorkannya saat membaca', async () => {
    const saved = await request('/api/admin/integrations/mayar', { method: 'PATCH', body: { ...mayarConfig, store_id: storeB } });
    expect(saved.status).toBe(200); expect(saved.body.data.hasApiKey).toBe(true);
    expect(records.has(`${storeB}:mayar`)).toBe(false);
    expect(JSON.stringify((await request('/api/admin/integrations')).body)).not.toContain(mayarConfig.apiKey);
  });
  it('mengganti gateway hanya untuk toko sesi setelah tes kanal', async () => {
    setup(); records.delete(`${storeA}:gateway`);
    expect((await request('/api/admin/payment-gateway')).body.data.provider).toBe('tripay');
    const result = await request('/api/admin/payment-gateway', { method: 'PUT', body: { provider: 'mayar', store_id: storeB } });
    expect(result.status).toBe(200); expect(records.get(`${storeA}:gateway`)).toBe('mayar'); expect(records.has(`${storeB}:gateway`)).toBe(false);
    expect((await request('/api/admin/payment-gateway', { method: 'PUT', body: { provider: 'tripay' } })).status).toBe(400);
    expect(records.get(`${storeA}:gateway`)).toBe('mayar');
  });
  it.each(['cashier', 'warehouse', 'customer'])('melarang %s mengubah gateway, kanal, atau webhook', async value => {
    role = value;
    for (const [url, method] of [['/api/admin/payment-gateway', 'PUT'], ['/api/admin/integrations/mayar', 'PATCH'], ['/api/admin/integrations/mayar/channels', 'GET'], ['/api/admin/integrations/mayar/webhook', 'POST']]) expect((await request(url, { method, ...(method !== 'GET' ? { body: { provider: 'mayar' } } : {}) })).status).toBe(403);
  });
  it('checkout hanya menampilkan Mayar dengan kanal aktif dan tanpa biaya customer', async () => {
    setup(); const result = await request(`/api/public/payment-channels?store_id=${storeA}&amount=10000`, { auth: false });
    expect(result.status).toBe(200); expect(result.body.data).toMatchObject({ provider: 'mayar', amount: 10000, channels: [{ code: 'QRIS', fee_customer: 0 }] });
    expect(result.body.data.channels[0].name).toBe('QRIS'); expect(result.body.data.channels).toHaveLength(1);
  });
  it('menolak checkout lama saat admin mengganti layanan tanpa menyimpan order', async () => {
    setup(); const result = await request('/api/public/orders', { method: 'POST', body: { ...input, payment_provider: 'tripay', payment_channel: 'BRIVA' } });
    expect(result.status).toBe(409); expect(clientQuery).not.toHaveBeenCalled();
  });
  it('membuat Mayar berdasarkan harga server dan menyimpan identitas gateway sebelum notifikasi', async () => {
    const fetch = setup(); const notify = vi.spyOn(whatsapp, 'notifyOrder').mockResolvedValue();
    try {
      const result = await request('/api/public/orders', { method: 'POST', body: { ...input, amount: 1 } });
      expect(result.status).toBe(200); expect(result.body.data.payment).toMatchObject({ channel: 'MAYAR', reference: requestId, checkout_url: 'https://merchant.myr.id/pl/order' });
      const create = fetch.mock.calls.find(([url]) => url.endsWith('/payments/create'));
      expect(JSON.parse(create[1].body).amount).toBe(10000);
      expect(clientQuery.mock.calls.find(([sql]) => sql.includes('set payment_provider'))[1].slice(1)).toEqual(['mayar', 'sandbox', 10000, 'MAYAR']);
      expect(query.mock.calls.find(([sql]) => sql.includes('set payment_reference'))[1].slice(1, 4)).toEqual([requestId, transactionId, 'https://merchant.myr.id/pl/order']);
      expect(notify).toHaveBeenCalledOnce();
    } finally { notify.mockRestore(); }
  });
  it('mengirim kanal VA yang dipilih dan menyimpan instruksi tanpa mengekspos payload provider', async () => {
    setup();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, options) => {
      if (url.endsWith('/payment-channels')) return new Response(JSON.stringify({ statusCode: 200, data: { config: [{ code: 'BNI', type: 'va', name: 'BNI VA', status: true }] } }));
      expect(JSON.parse(options.body).paymentMethod).toBe('va/bni');
      return new Response(JSON.stringify({ statusCode: 200, data: { id: requestId, transactionId, link: 'https://merchant.myr.id/pl/order', paymentCode: '88081234567890', secret: 'must-not-be-stored' } }));
    }));
    const notify = vi.spyOn(whatsapp, 'notifyOrder').mockResolvedValue();
    try {
      const result = await request('/api/public/orders', { method: 'POST', body: { ...input, payment_channel: 'VA/BNI' } });
      expect(result.status).toBe(200); expect(result.body.data.payment.provider).toBe('mayar');
      const saved = query.mock.calls.find(([sql]) => sql.includes('set payment_reference'));
      expect(JSON.parse(saved[1][5])).toEqual({ kind: 'va', pay_code: '88081234567890', bank: 'BNI' });
      expect(JSON.stringify(saved)).not.toContain('must-not-be-stored');
    } finally { notify.mockRestore(); }
  });
  it('menolak kanal direct yang nonaktif atau tidak didukung sebelum membuat order', async () => {
    setup();
    for (const channel of ['VA/BNI', 'VA/BCA', 'EWALLET/DANA', 'not-a-channel']) {
      expect((await request('/api/public/orders', { method: 'POST', body: { ...input, payment_channel: channel } })).status).toBe(400);
    }
    expect(clientQuery).not.toHaveBeenCalled();
  });
  it('endpoint pembayaran customer memerlukan autentikasi', async () => {
    expect((await request(`/api/customer/orders/${requestId}/payment`, { auth: false })).status).toBe(401);
  });
  it('tidak membuat transaksi ganda saat request Mayar timeout dan tetap mengembalikan order', async () => {
    const fetch = setup(true); const notify = vi.spyOn(whatsapp, 'notifyOrder').mockResolvedValue();
    try {
      const result = await request('/api/public/orders', { method: 'POST', body: input });
      expect(result.status).toBe(200); expect(result.body.data.payment.error).toContain('Pesanan tersimpan');
      expect(fetch.mock.calls.filter(([url]) => url.endsWith('/payments/create'))).toHaveLength(1);
    } finally { notify.mockRestore(); }
  });
  it('pembayaran manual tidak menampilkan gateway', async () => {
    records.set(`${storeA}:gateway`, 'manual');
    const result = await request(`/api/public/payment-channels?store_id=${storeA}`, { auth: false });
    expect(result.body.data).toMatchObject({ active: false, channels: [] });
  });
});

// Spec 0002: rantai gateway cadangan, DOKU, dan ongkir KiriminAja lewat rute HTTP.
describe('Gateway cadangan, DOKU, dan ongkir KiriminAja', () => {
  const doku = { enabled: true, mode: 'sandbox', clientId: 'BRN-0001-UJI', secretKey: 'doku-secret-uji' };
  const briva = { code: 'BRIVA', name: 'BRI Virtual Account', group: 'Virtual Account', type: 'direct', active: true,
    fee_customer: { flat: 0, percent: 0 }, total_fee: { flat: 0, percent: 0 }, minimum_amount: 10000, maximum_amount: 10000000 };
  const pesan = { store_id: storeA, customer_name: 'Pembeli Uji', customer_phone: '081234567890', delivery_address: 'Alamat Uji',
    payment_method: 'cash', payment_channel: 'BRIVA', payment_provider: 'tripay', items: [{ product_id: storeB, qty: 1 }] };
  let pesananDoku;
  beforeEach(() => {
    records.set(`${storeA}:tripay`, encryptConfig(config, `${storeA}:tripay`));
    records.set(`${storeA}:doku`, encryptConfig(doku, `${storeA}:doku`));
    pesananDoku = null;
    const asli = query.getMockImplementation();
    query.mockImplementation(async (sql, args = []) => {
      if (sql.includes("payment_provider = 'doku' and payment_reference")) return { rows: pesananDoku ? [pesananDoku] : [], rowCount: pesananDoku ? 1 : 0 };
      return asli(sql, args);
    });
  });
  // tripay: 'ok' | 'tolak' (transaksi ditolak) | 'putus' (tidak bisa dihubungi); doku: 'ok' | 'tolak'.
  function gerbang({ tripay = 'ok', doku: d = 'ok', kirim = null } = {}) {
    const mock = vi.fn().mockImplementation(async (url, opsi) => {
      if (url.includes('tripay.co.id')) {
        if (tripay === 'putus') throw new TypeError('fetch failed');
        if (url.includes('payment-channel')) return new Response(JSON.stringify({ success: true, data: [briva] }));
        if (url.includes('fee-calculator')) return new Response(JSON.stringify({ success: true, data: [{ code: 'BRIVA', total_fee: { customer: 0 } }] }));
        if (url.includes('transaction/create')) {
          if (tripay === 'tolak') return new Response(JSON.stringify({ success: false, message: 'Server Tripay maintenance' }), { status: 503 });
          const body = JSON.parse(opsi.body);
          return new Response(JSON.stringify({ success: true, data: { reference: 'REF-T', checkout_url: 'https://tripay.co.id/checkout/REF-T', amount: body.amount, fee_customer: 0 } }));
        }
      }
      if (url.startsWith('https://api-sandbox.doku.com/checkout/v1/payment')) {
        if (d === 'tolak') return new Response(JSON.stringify({ message: ['invalid'] }), { status: 400 });
        return new Response(JSON.stringify({ response: { payment: { url: 'https://sandbox.doku.com/checkout-link-v2/tok', token_id: 'tok-doku', expired_date: '20991231235959' } } }));
      }
      if (url.startsWith('https://api-sandbox.doku.com/orders/v1/status/')) {
        return new Response(JSON.stringify({ order: { invoice_number: pesananDoku?.order_number, amount: 10000 }, transaction: { status: 'SUCCESS' } }));
      }
      if (kirim && url.startsWith('https://tdev.kiriminaja.com')) return kirim(url, JSON.parse(opsi.body || '{}'));
      throw new Error(`Jalur tak terduga: ${url}`);
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('Tripay gangguan saat daftar kanal: checkout memakai DOKU dan menyebut layanan asal', async () => {
    gerbang({ tripay: 'putus' });
    const hasil = await request(`/api/public/payment-channels?store_id=${storeA}&amount=10000`, { auth: false });
    expect(hasil.status).toBe(200);
    expect(hasil.body.data).toMatchObject({ provider: 'doku', cadangan_dari: 'tripay', channels: [{ code: 'DOKU' }] });
  });

  it('hanya Tripay terpasang dan Tripay gangguan: jawaban sama seperti sebelumnya (503)', async () => {
    records.delete(`${storeA}:doku`);
    gerbang({ tripay: 'putus' });
    expect((await request(`/api/public/payment-channels?store_id=${storeA}&amount=10000`, { auth: false })).status).toBe(503);
  });

  it('Tripay menolak transaksi saat Buat Pesanan: pesanan yang sama dipindah ke DOKU', async () => {
    const mock = gerbang({ tripay: 'tolak' });
    const hasil = await request('/api/public/orders', { method: 'POST', body: pesan });
    expect(hasil.status).toBe(200);
    expect(hasil.body.data.payment).toMatchObject({ provider: 'doku', pindah_dari: 'tripay', checkout_url: 'https://sandbox.doku.com/checkout-link-v2/tok' });
    const buatDoku = mock.mock.calls.find(([url]) => url.includes('/checkout/v1/payment'));
    expect(JSON.parse(buatDoku[1].body).order).toMatchObject({ amount: 10000, invoice_number: hasil.body.data.order_number });
    const pindah = query.mock.calls.find(([sql]) => sql.includes('payment_failover_from'));
    expect(pindah[1].slice(1)).toEqual(['doku', 'sandbox', 'DOKU', 'tripay']);
    expect(pindah[0]).toContain("then 'other'");
    expect(clientQuery.mock.calls.filter(([sql]) => sql.includes('insert into public.orders'))).toHaveLength(1);
  });

  it('Tripay tidak bisa dihubungi sebelum pesanan disimpan: langsung memakai DOKU', async () => {
    gerbang({ tripay: 'putus' });
    const hasil = await request('/api/public/orders', { method: 'POST', body: pesan });
    expect(hasil.status).toBe(200);
    expect(hasil.body.data.payment).toMatchObject({ provider: 'doku', pindah_dari: 'tripay' });
  });

  it('semua layanan gagal: satu pesanan tersimpan dan pembeli diminta menghubungi toko', async () => {
    gerbang({ tripay: 'tolak', doku: 'tolak' });
    const hasil = await request('/api/public/orders', { method: 'POST', body: pesan });
    expect(hasil.status).toBe(200);
    expect(hasil.body.data.payment.error).toContain('sebelum membayar atau membuat pesanan baru');
    expect(clientQuery.mock.calls.filter(([sql]) => sql.includes('insert into public.orders'))).toHaveLength(1);
  });

  it('notifikasi DOKU bertanda tangan sah melunasi; tanda tangan palsu dicek ke API dulu', async () => {
    const { tandaTangan, JALUR_NOTIFIKASI } = await import('../integrasi/doku.js');
    pesananDoku = { id: 'order-d', store_id: storeA, order_number: 'WEB-DOKU1', payment_reference: 'tok-doku', payment_amount: '10000', payment_status: 'unpaid', payment_provider: 'doku', payment_mode: 'sandbox' };
    const body = { order: { invoice_number: 'WEB-DOKU1', amount: 10000 }, transaction: { status: 'SUCCESS' } };
    const kepala = { 'Client-Id': doku.clientId, 'Request-Id': 'n-1', 'Request-Timestamp': '2026-10-17T03:00:00Z' };
    kepala.Signature = tandaTangan({ clientId: doku.clientId, requestId: 'n-1', timestamp: kepala['Request-Timestamp'], target: JALUR_NOTIFIKASI, body: JSON.stringify(body) }, doku.secretKey);
    const mock = gerbang();
    expect((await request(JALUR_NOTIFIKASI, { method: 'POST', auth: false, body, headers: kepala })).status).toBe(200);
    expect(query.mock.calls.some(([sql]) => sql.includes("payment_status = 'paid'"))).toBe(true);
    expect(mock.mock.calls.some(([url]) => url.includes('/orders/v1/status/'))).toBe(false);
    query.mockClear();
    expect((await request(JALUR_NOTIFIKASI, { method: 'POST', auth: false, body, headers: { ...kepala, Signature: 'HMACSHA256=palsu' } })).status).toBe(200);
    expect(mock.mock.calls.some(([url]) => url.includes('/orders/v1/status/WEB-DOKU1'))).toBe(true);
  });

  describe('ongkir KiriminAja di Buat Pesanan', () => {
    const tujuan = { provinsi_id: 11, kota_id: 22, kecamatan_id: 33, kelurahan_id: 44 };
    function kirim(url, body) {
      if (url.endsWith('/api/mitra/province')) return new Response(JSON.stringify({ status: true, datas: [{ id: 11, provinsi_name: 'Jawa Timur' }] }));
      if (url.endsWith('/api/mitra/city')) return new Response(JSON.stringify({ status: true, datas: [{ id: 22, provinsi_id: 11, kabupaten_name: 'Surabaya', type: 'Kota' }] }));
      if (url.endsWith('/api/mitra/kecamatan')) return new Response(JSON.stringify({ status: true, datas: [{ id: 33, kecamatan_name: 'Gubeng', kabupaten_id: 22 }] }));
      if (url.endsWith('/api/mitra/kelurahan')) return new Response(JSON.stringify({ status: true, results: [{ id: 44, kelurahan_name: 'Airlangga', kecamatan_id: 33 }] }));
      if (url.endsWith('/api/mitra/v6.1/shipping_price')) {
        expect(body).toMatchObject({ origin: 100, subdistrict_origin: 200, destination: 33, subdistrict_destination: 44, weight: 1000 });
        return new Response(JSON.stringify({ status: true, results: [{ service: 'jne', service_name: 'JNE Reguler', service_type: 'REG', cost: '15000', etd: '2-3' }] }));
      }
      throw new Error(`KiriminAja tak terduga ${url}`);
    }
    beforeEach(() => { records.set(`${storeA}:kiriminaja`, encryptConfig(shippingConfig, `${storeA}:kiriminaja`)); });

    it('menolak pesanan tanpa wilayah tujuan saat KiriminAja aktif', async () => {
      gerbang({ kirim });
      expect((await request('/api/public/orders', { method: 'POST', body: pesan })).status).toBe(400);
      expect(clientQuery).not.toHaveBeenCalled();
    });

    it('ongkir dari layar yang berbeda ditolak 409 beserta daftar terbaru', async () => {
      gerbang({ kirim });
      const hasil = await request('/api/public/orders', { method: 'POST', body: { ...pesan, delivery_wilayah: tujuan, shipping: { courier: 'jne', service: 'REG', ongkir: 1000 } } });
      expect(hasil.status).toBe(409);
      expect(hasil.body.shipping_options).toEqual([expect.objectContaining({ courier: 'jne', service: 'REG', ongkir: 15000 })]);
      expect(clientQuery).not.toHaveBeenCalled();
    });

    it('ongkir hitungan server masuk total, kolom kirim tersimpan, dan ikut ditagih Tripay', async () => {
      const mock = gerbang({ kirim });
      const hasil = await request('/api/public/orders', { method: 'POST', body: { ...pesan, delivery_wilayah: tujuan, shipping: { courier: 'jne', service: 'REG', ongkir: 15000 } } });
      expect(hasil.status).toBe(200);
      const insert = clientQuery.mock.calls.find(([sql]) => sql.includes('insert into public.orders'));
      expect(insert[1][3]).toBe(25000); // total = barang 10.000 + ongkir 15.000
      expect(insert[1].slice(11, 14)).toEqual(['Jawa Timur', 'Kota Surabaya', 10000]);
      const kolom = clientQuery.mock.calls.find(([sql]) => sql.includes('shipping_courier'));
      expect(kolom[1].slice(1)).toEqual([15000, 'jne', 'REG', 'JNE Reguler', '2-3', 1000, 'Gubeng', 'Airlangga', 33, 44]);
      const buat = JSON.parse(mock.mock.calls.find(([url]) => url.includes('transaction/create'))[1].body);
      expect(buat.amount).toBe(25000);
      expect(buat.order_items.at(-1)).toMatchObject({ name: 'Ongkir JNE Reguler', price: 15000 });
    });
  });
});
