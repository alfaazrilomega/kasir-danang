import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, transactionQuery, connect } = vi.hoisted(() => ({
  query: vi.fn(), transactionQuery: vi.fn(), connect: vi.fn(),
}));
vi.mock('pg', () => ({ default: {
  Pool: class { query = query; connect = connect; on() {} },
  types: { setTypeParser() {} },
} }));
vi.mock('../affiliate/layanan.js', async (original) => ({
  ...await original(), catatAtribusiPesanan: vi.fn(),
}));
vi.mock('../integrasi/settings.js', async (original) => ({
  ...await original(), loadIntegration: vi.fn(async (_db, _store, provider) => ({ enabled: provider === 'tripay', mode: 'sandbox' })),
}));
vi.mock('../integrasi/tripay.js', async (original) => ({
  ...await original(),
  tripayAktif: () => true,
  daftarKanal: async () => [
    { code: 'QRIS', name: 'QRIS otomatis', group: 'QRIS', active: true },
    { code: 'BCAVA', name: 'BCA Virtual Account', group: 'Virtual Account', active: true },
  ],
  buatTransaksi: async () => ({ reference: 'test', checkout_url: 'https://example.test/bayar' }),
}));

const storeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
let settings;
let server;
let base;
let attempt = 0;

function token() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', 'manual-payment-test').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function order(method, channel) {
  const response = await fetch(`${base}/api/public/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json',
      'X-Forwarded-For': `192.0.2.${++attempt}`,
    },
    body: JSON.stringify({
      store_id: storeId, customer_name: 'Pembeli Uji', customer_phone: '081234567890',
      delivery_address: 'Alamat uji', payment_method: method, payment_channel: channel,
      delivery_province: 'Jawa Timur', delivery_city: 'Kabupaten Sidoarjo',
      delivery_district: 'Sidoarjo', delivery_village: 'Sidokumpul',
      items: [{ product_id: productId, qty: 1 }],
    }),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'manual-payment-test');
  vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/test');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('ORDER_NOTIFY_EMAIL', '');
  const { default: app } = await import('../index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  settings = { manual_transfer_enabled: true, manual_qris_enabled: true };
  query.mockReset();
  transactionQuery.mockReset();
  connect.mockReset();
  transactionQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  connect.mockResolvedValue({ query: transactionQuery, release() {} });
  query.mockImplementation(async (sql) => {
    if (sql.includes('from public.customers c')) {
      return { rows: [{ id: userId, store_id: storeId, email: 'buyer@example.test' }], rowCount: 1 };
    }
    if (sql.includes('from public.stores')) return { rows: [{ id: storeId, name: 'Toko', ...settings }], rowCount: 1 };
    if (/from public\.(store_email_settings|whatsapp_settings)/.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.store_payment_settings')) return { rows: [{ provider: 'tripay' }], rowCount: 1 };
    if (sql.includes('from public.products')) return { rows: [{ id: productId, name: 'Produk', base_price: 10000 }], rowCount: 1 };
    if (sql.startsWith('update public.orders')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

describe('Metode pembayaran manual checkout', () => {
  it.each([
    [true, true], [true, false], [false, true], [false, false],
  ])('transfer=%s, QRIS=%s diberlakukan secara terpisah', async (transfer, qris) => {
    settings = { manual_transfer_enabled: transfer, manual_qris_enabled: qris };
    for (const [method, enabled] of [['transfer', transfer], ['qris', qris], ['cash', true]]) {
      connect.mockClear();
      transactionQuery.mockClear();
      const result = await order(method);
      expect(result.status).toBe(enabled ? 200 : 400);
      if (enabled) {
        expect(result.body.data.order_id).toBeTruthy();
        const insert = transactionQuery.mock.calls.find(([sql]) => sql.includes('insert into public.orders'));
        expect(insert[1][4]).toBe(method);
      } else {
        expect(result.body.error).toContain('dinonaktifkan');
        expect(connect).not.toHaveBeenCalled();
      }
    }
  });

  it('menolak pilihan halaman lama setelah admin menonaktifkan lalu menerima setelah diaktifkan', async () => {
    expect((await order('transfer')).status).toBe(200);
    settings.manual_transfer_enabled = false;
    expect((await order('transfer')).status).toBe(400);
    settings.manual_transfer_enabled = true;
    expect((await order('transfer')).status).toBe(200);
  });

  it.each([['qris', 'QRIS'], ['transfer', 'BCAVA']])('%s otomatis tetap dapat dipakai saat kedua metode manual nonaktif', async (method, channel) => {
    settings = { manual_transfer_enabled: false, manual_qris_enabled: false };
    const result = await order(method, channel);
    expect(result.status).toBe(200);
    expect(result.body.data.payment.channel).toBe(channel);
    expect(result.body.data.payment.error).toBeUndefined();
  });
});
