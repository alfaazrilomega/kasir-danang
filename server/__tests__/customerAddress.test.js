import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const { query, transactionQuery, connect } = vi.hoisted(() => ({ query: vi.fn(), transactionQuery: vi.fn(), connect: vi.fn() }));
vi.mock('pg', () => ({ default: {
  Pool: class { query = query; connect = connect; on() {} },
  types: { setTypeParser() {} },
} }));
vi.mock('../affiliate/layanan.js', async (original) => ({ ...await original(), catatAtribusiPesanan: vi.fn() }));

const storeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const address = {
  name: 'Pembeli', phone: '081234567890', address: 'RT 03/RW 05, rumah pagar hijau',
  province: 'Jawa Timur', city: 'Kabupaten Sidoarjo', district: 'Sidoarjo', village: 'Sidokumpul',
};
const order = {
  store_id: storeId, customer_name: address.name, customer_phone: address.phone,
  delivery_address: `${address.address}, Sidokumpul, Kec. Sidoarjo, Kabupaten Sidoarjo, Jawa Timur`,
  delivery_province: address.province, delivery_city: address.city,
  delivery_district: address.district, delivery_village: address.village,
  payment_method: 'cash', items: [{ product_id: productId, qty: 1 }],
};
let row;
let server;
let base;
let attempt = 0;

function token() {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `${head}.${body}.${crypto.createHmac('sha256', 'address-test').update(`${head}.${body}`).digest('base64url')}`;
}
async function request(url, method = 'GET', body) {
  const response = await fetch(`${base}${url}`, {
    method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${++attempt}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...await response.json() };
}

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'address-test');
  vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/test');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('ORDER_NOTIFY_EMAIL', '');
  const { default: app } = await import('../index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  row = { id: userId, store_id: storeId, name: 'Pembeli', email: 'buyer@example.test', address: 'Alamat lama' };
  query.mockReset(); transactionQuery.mockReset(); connect.mockReset();
  transactionQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  connect.mockResolvedValue({ query: transactionQuery, release() {} });
  query.mockImplementation(async (sql, args = []) => {
    if (sql.includes('from public.app_users u')) return { rows: [{ id: userId, store_id: storeId, role: 'customer' }], rowCount: 1 };
    if (sql.includes('from public.role_permissions')) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.customers c')) return { rows: [row], rowCount: 1 };
    if (sql.includes('update public.customers')) {
      Object.assign(row, { name: args[2], phone: args[3], address: args[4], address_province: args[5], address_city: args[6], address_wilayah: args[10] ? null : args[7] ? JSON.parse(args[7]) : row.address_wilayah, address_district: args[8], address_village: args[9] });
      return { rows: [{ id: userId }], rowCount: 1 };
    }
    if (sql.includes('update public.profiles')) return { rows: [], rowCount: 1 };
    if (sql.includes('from public.stores')) return { rows: [{ id: storeId, name: 'Toko' }], rowCount: 1 };
    if (/from public\.(store_integrations|store_email_settings|whatsapp_settings)/.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.products')) return { rows: [{ id: productId, name: 'Produk', base_price: 10000 }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
});
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

it('menyimpan dan memuat kembali wilayah profil tanpa menggabungkannya ke detail rumah', async () => {
  const saved = await request('/api/customer/me', 'PATCH', address);
  expect(saved.status).toBe(200);
  expect(saved.data).toMatchObject(address);
  const loaded = await request('/api/customer/me');
  expect(loaded.data).toMatchObject(address);
});

it('alamat lama tetap dapat dibaca tanpa menebak kecamatan atau desa', async () => {
  const loaded = await request('/api/customer/me');
  expect(loaded.status).toBe(200);
  expect(loaded.data).toMatchObject({ address: 'Alamat lama', district: null, village: null });
});

it('menolak profil yang mengisi kecamatan tetapi belum memilih desa', async () => {
  expect((await request('/api/customer/me', 'PATCH', { ...address, village: '' })).status).toBe(400);
  expect(query.mock.calls.some(([sql]) => sql.includes('update public.customers'))).toBe(false);
});

it.each(['delivery_province', 'delivery_city', 'delivery_district', 'delivery_village'])('checkout menolak %s yang kosong', async (field) => {
  const result = await request('/api/public/orders', 'POST', { ...order, [field]: '' });
  expect(result.status).toBe(400);
  expect(result.error).toContain('desa/kelurahan');
  expect(connect).not.toHaveBeenCalled();
});

it('checkout menyimpan alamat lengkap serta kecamatan dan desa pada pesanan', async () => {
  const result = await request('/api/public/orders', 'POST', order);
  expect(result.status).toBe(200);
  const insert = transactionQuery.mock.calls.find(([sql]) => sql.includes('insert into public.orders'));
  expect(insert[1][9]).toBe(order.delivery_address);
  expect(insert[1].slice(11, 13)).toEqual(['Jawa Timur', 'Kabupaten Sidoarjo']);
  expect(insert[1].slice(16)).toEqual(['Sidoarjo', 'Sidokumpul']);
});

const wilayahKirim = {
  provinsi_id: 11, provinsi: 'Jawa Timur', kota_id: 22, kota: 'Kabupaten Sidoarjo',
  kecamatan_id: 33, kecamatan: 'Sidoarjo', kelurahan_id: 44, kelurahan: 'Sidokumpul',
};

it('alamat KiriminAja lama tetap memuat kecamatan dan desa', async () => {
  row.address_wilayah = wilayahKirim;
  const loaded = await request('/api/customer/me');
  expect(loaded.data).toMatchObject({ district: 'Sidoarjo', village: 'Sidokumpul', wilayah: wilayahKirim });
});

it('menyimpan wilayah kurir dan detail rumah bersama tanpa menggandakan alamat', async () => {
  const saved = await request('/api/customer/me', 'PATCH', { ...address, wilayah: wilayahKirim });
  expect(saved.status).toBe(200);
  expect(saved.data).toMatchObject({ ...address, wilayah: wilayahKirim });
});

it('perubahan wilayah manual menghapus ID kurir lama secara eksplisit', async () => {
  row.address_wilayah = wilayahKirim;
  const saved = await request('/api/customer/me', 'PATCH', { ...address, wilayah: null });
  expect(saved.status).toBe(200);
  expect(saved.data).toMatchObject({ ...address, wilayah: null });
});
