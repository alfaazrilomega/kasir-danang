import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { channelAllowed, checkoutMode, paymentInvoice } from '../integrasi/tripayInvoice.js';
import { publicConfig, validateConfig } from '../integrasi/settings.js';
const { query, tx, connect, config, createTransaction } = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn(), connect: vi.fn(), config: vi.fn(), createTransaction: vi.fn() }));
vi.mock('pg', () => ({ default: { Pool: class { query = query; connect = connect; on() {} }, types: { setTypeParser() {} } } }));
vi.mock('../integrasi/settings.js', async original => ({ ...await original(), loadIntegration: config }));
vi.mock('../integrasi/tripay.js', async original => ({ ...await original(),
  daftarKanal: async () => [
    { code: 'BCAVA', name: 'BCA Virtual Account', group: 'Virtual Account', type: 'direct', active: true },
    { code: 'QRIS', name: 'QRIS', group: 'QRIS', type: 'direct', active: true },
    { code: 'EWALLET', name: 'Dompet Redirect', group: 'E-Wallet', type: 'redirect', active: true },
  ], buatTransaksi: createTransaction,
}));
vi.mock('../affiliate/layanan.js', async original => ({ ...await original(), catatAtribusiPesanan: vi.fn() }));
const sid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', uid = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', pid = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
let server, base, row, cfg, stranger, customerStore;
let attempt = 0;
const originalTrx = { reference: 'REF-A', amount: 11500, fee_customer: 1500, pay_code: '1234567890', qr_url: null,
  checkout_url: 'https://tripay.co.id/checkout/REF-A', expired_time: 2000000000,
  instructions: [{ title: 'Mobile Banking', steps: ['Pilih <b>Transfer</b>', 'Masukkan <b>1234567890</b>'] }] };
function token() {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `${h}.${p}.${crypto.createHmac('sha256', 'direct-test').update(`${h}.${p}`).digest('base64url')}`;
}
async function request(path, method = 'GET', body, headers = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${++attempt}`, ...headers }, body: body == null ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function order(channel = 'BCAVA') {
  return request('/api/public/orders', 'POST', { store_id: sid, customer_name: 'Pembeli Uji', customer_phone: '081234567890', delivery_address: 'RT 03 RW 02', delivery_province: 'Jawa Timur', delivery_city: 'Sidoarjo', delivery_district: 'Sidoarjo', delivery_village: 'Sidokumpul', payment_method: 'transfer', payment_channel: channel, items: [{ product_id: pid, qty: 1 }] });
}
beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'direct-test'); vi.stubEnv('DATABASE_URL', 'postgres://test.invalid/test'); vi.stubEnv('VERCEL', '1'); vi.stubEnv('ORDER_NOTIFY_EMAIL', '');
  const { default: app } = await import('../index.js'); server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  cfg = { enabled: true, mode: 'sandbox', checkoutMode: 'direct', merchantCode: 'T123', apiKey: 'fake', privateKey: 'test-private', callbackUrl: '', returnUrl: '' };
  row = null; stranger = false; customerStore = sid;
  config.mockReset().mockImplementation(async (_db, _store, provider) => provider === 'tripay' ? cfg : { enabled: false, mode: 'sandbox' });
  createTransaction.mockReset().mockResolvedValue({ ...originalTrx });
  query.mockReset(); tx.mockReset().mockResolvedValue({ rows: [], rowCount: 0 }); connect.mockReset().mockResolvedValue({ query: tx, release() {} });
  query.mockImplementation(async (sql, args = []) => {
    if (sql.includes('from public.store_payment_settings')) return { rows: [{ provider: 'tripay' }], rowCount: 1 };
    if (sql.includes('from public.store_email_settings')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('update public.orders set payment_checked_at')) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.app_users u')) return { rows: [{ id: uid, role: 'customer', store_id: customerStore }], rowCount: 1 };
    if (sql.includes('from public.role_permissions')) return { rows: [], rowCount: 0 };
    if (sql.includes('from public.customers c')) return { rows: [{ id: stranger ? pid : uid, store_id: customerStore, email: 'buyer@example.test' }], rowCount: 1 };
    if (sql.includes('from public.stores')) return { rows: [{ id: sid }], rowCount: 1 };
    if (sql.includes('from public.products')) return { rows: [{ id: pid, name: 'Gear', base_price: 10000 }], rowCount: 1 };
    if (sql.startsWith('update public.orders set payment_channel')) {
      row = { id: args[0], order_number: 'WEB-TEST', order_status: 'awaiting_confirmation', payment_status: 'unpaid', payment_reference: args[2], payment_details: JSON.parse(args[5]), payment_provider: 'tripay', payment_channel: args[1], payment_amount: 10000, payment_mode: 'sandbox', payment_expires_at: args[4] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('from public.orders where order_number')) return { rows: row ? [{ ...row, store_id: sid }] : [], rowCount: row ? 1 : 0 };
    if (sql.includes('from public.orders where id')) {
      expect(args).toEqual([row?.id ?? pid, customerStore, stranger ? pid : uid]);
      return { rows: row && !stranger && customerStore === sid ? [row] : [], rowCount: row && !stranger ? 1 : 0 };
    }
    if (sql.includes("set payment_status = 'paid'")) { row.payment_status = 'paid'; return { rows: [], rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  });
});
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); vi.unstubAllEnvs(); });
it('pengaturan DIRECT tersimpan, konfigurasi lama tetap REDIRECT, mode lain ditolak', () => {
  expect(validateConfig('tripay', { ...cfg, checkoutMode: 'direct' }, cfg).checkoutMode).toBe('direct');
  expect(publicConfig('tripay', { ...cfg, checkoutMode: undefined }).checkoutMode).toBe('redirect');
  expect(() => validateConfig('tripay', { ...cfg, checkoutMode: 'bad' }, cfg)).toThrow();
  expect(checkoutMode({})).toBe('redirect');
});
it('DIRECT hanya menawarkan kanal direct dan menolak pilihan redirect dari halaman lama', async () => {
  const channels = await request(`/api/public/payment-channels?store_id=${sid}`);
  expect(channels.body.data.channels.map(c => c.code)).toEqual(['BCAVA', 'QRIS']);
  expect((await order('EWALLET')).status).toBe(400); expect(createTransaction).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
  expect(channelAllowed({ active: true }, cfg)).toBe(false);
});
it('DIRECT menyimpan VA, instruksi dan nominal provider tanpa tautan keluar', async () => {
  const response = await order(); expect(response.status).toBe(200);
  expect(response.body.data.payment).toMatchObject({ checkout_mode: 'direct', checkout_url: null, amount: 11500, base_amount: 10000, pay_code: '1234567890' });
  expect(row.payment_details.instructions[0].steps[0]).toBe('Pilih Transfer');
  const loaded = await request(`/api/customer/orders/${row.id}/payment`);
  expect(loaded.body.data).toMatchObject({ provider: 'tripay', amount: 11500, checkout_url: null, instructions: { kind: 'va', pay_code: '1234567890' }, steps: [{ title: 'Mobile Banking', steps: ['Pilih Transfer', 'Masukkan 1234567890'] }] }); expect(loaded.headers.get('cache-control')).toBe('no-store');
  expect(createTransaction).toHaveBeenCalledTimes(1);
});
it('QRIS tersimpan dan dapat dibuka kembali', async () => {
  const payload = '000201010212QRIS-PAYLOAD-UTUH';
  createTransaction.mockResolvedValue({ ...originalTrx, pay_code: null, qr_url: 'https://tripay.co.id/qr/test.png', qr_string: payload });
  await order('QRIS');
  const result = await request(`/api/customer/orders/${row.id}/payment`);
  expect(result.body.data.instructions.qr_url).toBe('https://tripay.co.id/qr/test.png');
  expect(result.body.data.instructions.qr_string).toBe(payload);
});
it('QR kosong/tidak valid tidak dirender dan payload terlalu panjang tidak dipotong menjadi QR lain', () => {
  for (const qr_string of [undefined, null, '', 123, 'a'.repeat(4097)]) {
    expect(paymentInvoice({ ...originalTrx, qr_string }, { code: 'QRIS' }, cfg, 10000).qr_string).toBeNull();
  }
});
it('REDIRECT mempertahankan checkout_url dan semua jenis kanal', async () => {
  cfg.checkoutMode = 'redirect';
  const result = await order('EWALLET'); expect(result.status).toBe(200);
  expect(result.body.data.payment.checkout_url).toBe(originalTrx.checkout_url);
  expect((await request(`/api/public/payment-channels?store_id=${sid}`)).body.data.channels).toHaveLength(3);
});
it('invoice tidak dapat dibaca akun lain atau toko lain', async () => {
  await order(); stranger = true; expect((await request(`/api/customer/orders/${row.id}/payment`)).status).toBe(404);
  stranger = false; customerStore = pid; expect((await request(`/api/customer/orders/${row.id}/payment`)).status).toBe(404);
});
it('callback bertanda tangan mengubah status invoice, pembacaan invoice tidak membuat transaksi baru', async () => {
  expect((await order()).status).toBe(200);
  const body = { reference: 'REF-A', merchant_ref: row.order_number, status: 'PAID', total_amount: 11500, fee_customer: 1500, is_closed_payment: 1, payment_method_code: row.payment_channel };
  const signature = crypto.createHmac('sha256', cfg.privateKey).update(JSON.stringify(body)).digest('hex');
  expect((await request('/api/tripay/callback', 'POST', body, { 'X-Callback-Event': 'payment_status', 'X-Callback-Signature': signature })).status).toBe(200);
  expect((await request(`/api/customer/orders/${row.id}/payment`)).body.data.status).toBe('paid');
  expect(createTransaction).toHaveBeenCalledTimes(1);
});
it('tidak menampilkan URL berbahaya atau HTML instruksi sebagai markup', () => {
  const invoice = paymentInvoice({ ...originalTrx, checkout_url: 'javascript:alert(1)', qr_url: 'data:image/svg+xml,bad', instructions: [{ title: '<b>Bayar</b>', steps: ['<img src=x onerror=alert(1)>Teks'] }] }, { code: 'BCAVA' }, { checkoutMode: 'redirect' }, 10000);
  expect(invoice.checkout_url).toBeNull(); expect(invoice.qr_url).toBeNull(); expect(invoice.instructions).toEqual([{ title: 'Bayar', steps: ['Teks'] }]);
});
