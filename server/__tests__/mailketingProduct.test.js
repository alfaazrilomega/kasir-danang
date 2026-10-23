import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const { query, lists } = vi.hoisted(() => ({ query: vi.fn(), lists: vi.fn() }));
vi.mock('pg', () => ({ default: { Pool: class { query = query; on() {} }, types: { setTypeParser() {} } } }));
vi.mock('../integrasi/mailketingLists.js', async original => ({ ...await original(), getMailketingLists: lists }));
const storeId = '5d3e9a20-66ac-4012-9bab-103fbf9b08e4';
const uid = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const pid = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
let server, base, role, tenant;
function token() {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `${h}.${p}.${crypto.createHmac('sha256', 'mailketing-test').update(`${h}.${p}`).digest('base64url')}`;
}
async function request(path, body) {
  return fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'mailketing-test'); vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/test'); vi.stubEnv('VERCEL', '1');
  vi.stubEnv('MAILKETING_STORE_ID', storeId); vi.stubEnv('MAILKETING_API_TOKEN', 'test-only-token');
  const { default: app } = await import('../index.js'); server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  role = 'admin'; tenant = storeId; query.mockReset(); lists.mockReset().mockResolvedValue([{ id: 12, name: 'User GNNKracing' }]);
  query.mockImplementation(async sql => {
    if (sql.includes('from public.app_users u')) return { rows: [{ id: uid, store_id: tenant, role }], rowCount: 1 };
    if (sql.includes('from public.role_permissions')) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.store_email_settings')) return { rows: [], rowCount: 0 };
    if (sql.includes('update public."products"')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
});
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); vi.unstubAllEnvs(); });
it('admin dapat memuat list, respons tidak berisi token', async () => {
  const response = await request('/api/admin/mailketing/lists'); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { configured: true, lists: [{ id: 12, name: 'User GNNKracing' }] } });
});
it('kasir dan admin toko lain tidak dapat memuat list akun server', async () => {
  role = 'cashier'; expect((await request('/api/admin/mailketing/lists')).status).toBe(403);
  role = 'admin'; tenant = uid;
  const response = await request('/api/admin/mailketing/lists'); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { configured: false, lists: [] } });
  const save = await request('/api/query', { table: 'products', action: 'update', payload: { mailketing_order_list_id: 12 }, filters: [{ type: 'eq', column: 'id', value: pid }] });
  expect(save.status).toBe(403);
  expect(lists).not.toHaveBeenCalled();
});
it('menyimpan dan mengosongkan kedua pilihan produk', async () => {
  for (const value of [12, null]) {
    const response = await request('/api/query', { table: 'products', action: 'update', payload: { mailketing_order_list_id: value, mailketing_complete_list_id: value }, filters: [{ type: 'eq', column: 'id', value: pid }] });
    expect(response.status).toBe(200);
    const update = query.mock.calls.filter(([sql]) => sql.startsWith('update public."products"')).at(-1);
    expect(update[1].slice(0, 2)).toEqual([value, value]);
    expect(update[1].at(-1)).toBe(storeId);
  }
});
it.each([-1, 1.2, '12'])('menolak ID list tidak valid %s', async value => {
  const response = await request('/api/query', { table: 'products', action: 'update', payload: { mailketing_order_list_id: value }, filters: [{ type: 'eq', column: 'id', value: pid }] });
  expect(response.status).toBe(400);
});
