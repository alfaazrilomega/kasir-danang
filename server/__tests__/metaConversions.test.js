import crypto from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { buildMetaPurchase, kirimMetaPurchase, metaTrackingContext } from '../integrasi/metaConversions.js';
import { defaults, publicConfig, validateConfig, encryptConfig, decryptConfig } from '../integrasi/settings.js';
const pixel = '1234567890123456';
const config = { enabled: true, apiVersion: 'v26.0', accessToken: 'private-token', testEventCode: '' };
const event = { event_id: 'order-1', created_at: '2026-10-23T08:00:00Z', purchase: { nilai: 240000, nomorPesanan: 'WEB-1', barang: [{ id: 'p1', qty: 2, harga: 125000 }] } };
const order = { customer_id: 'buyer-1', created_at: '2026-09-01', meta_tracking: { clientIp: '203.0.113.1', userAgent: 'Browser', sourceUrl: 'https://shop.test/toko/checkout', fbp: 'fb.1.1720000000000.123' } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('normalizes and hashes matching identifiers, retains paid time and shared amount/ID', () => {
  const payload = buildMetaPurchase({ event, order, customer: { email: ' BUYER@Example.Test ', phone: '0812-3456-7890' } });
  const hash = v => crypto.createHash('sha256').update(v).digest('hex');
  expect(payload).toMatchObject({ event_name: 'Purchase', event_id: event.event_id, event_time: 1792742400,
    user_data: { em: [hash('buyer@example.test')], ph: [hash('6281234567890')], external_id: [hash('buyer-1')], fbp: order.meta_tracking.fbp }, custom_data: { value: 240000, currency: 'IDR', num_items: 2 } });
  expect(JSON.stringify(payload)).not.toMatch(/BUYER|buyer@example|0812-3456/);
});
it('ignores invalid attribution and collects no personal attribution when disabled', () => {
  const args = { pixelId: pixel, capi: true, cookies: '_fbp=malformed', tracking: { fbc: 'fb.1.1720000000000.click123', total: 1 }, clientIp: 'evil', userAgent: 'Browser\nAgent', origin: 'https://shop.test/?secret=123' };
  expect(metaTrackingContext(args)).toEqual({ pixelId: pixel, capi: true, fbc: args.tracking.fbc, userAgent: 'BrowserAgent', sourceUrl: 'https://shop.test/toko/checkout' });
  expect(metaTrackingContext({ ...args, capi: false })).toEqual({ pixelId: pixel, capi: false });
});
it('tokens stay encrypted and out of public settings; empty input retains saved token', () => {
  vi.stubEnv('INTEGRATION_SECRET', 'test-secret');
  const validated = validateConfig('meta_capi', { enabled: true, accessToken: '' }, config);
  expect(validated.accessToken).toBe(config.accessToken);
  expect(publicConfig('meta_capi', validated)).toEqual({ enabled: true, hasAccessToken: true, apiVersion: 'v26.0', testEventCode: '' });
  const encrypted = encryptConfig(validated, 'shop:meta_capi');
  expect(encrypted).not.toContain(config.accessToken); expect(decryptConfig(encrypted, 'shop:meta_capi')).toEqual(validated);
  expect(() => decryptConfig(encrypted, 'another:meta_capi')).toThrow();
  expect(() => validateConfig('meta_capi', { enabled: true }, defaults('meta_capi'))).toThrow(/Access Token/);
  expect(() => validateConfig('meta_capi', { enabled: false, apiVersion: 'v26.0/evil' }, config)).toThrow(/Versi/);
});
it('sends test code explicitly and keeps credentials out of request URL', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events_received: 1 }) }); vi.stubGlobal('fetch', fetchMock);
  const payload = buildMetaPurchase({ event, order });
  await kirimMetaPurchase(payload, pixel, { ...config, testEventCode: 'TEST123' });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`https://graph.facebook.com/v26.0/${pixel}/events`);
  expect(JSON.parse(options.body)).toEqual({ data: [payload], access_token: config.accessToken, test_event_code: 'TEST123' });
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
it('rejects provider errors and missing acknowledgement, even with HTTP 200', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  await expect(kirimMetaPurchase({}, pixel, config)).rejects.toThrow('tidak menerima');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
  await expect(kirimMetaPurchase({}, pixel, config)).rejects.toThrow('HTTP 401');
});
