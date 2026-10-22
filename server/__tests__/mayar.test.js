import { afterEach, describe, expect, it, vi } from 'vitest';
import { buatTransaksi, daftarKanal, detailTransaksi, verifiedPayment, checkoutChannels, paymentInstructions } from '../integrasi/mayar.js';
import { defaults, publicConfig, validateConfig } from '../integrasi/settings.js';
const config = { enabled: true, mode: 'sandbox', apiKey: 'secret-mayar-key' };
const ref = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const trx = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const response = (data, status = 200) => new Response(JSON.stringify({ statusCode: status, data }), { status });
const input = { orderId: ref, orderNumber: 'WEB-123', amount: 10000, customerName: 'Pembeli', customerEmail: 'buyer@example.com', customerPhone: '081234567890' };
afterEach(() => vi.unstubAllGlobals());
describe('Mayar V2', () => {
  it('menyimpan rahasia tanpa mengeksposnya dan menolak mode tanpa kunci baru', () => {
    expect(defaults('mayar')).toEqual({ enabled: false, mode: 'sandbox', apiKey: '' });
    expect(publicConfig('mayar', config)).toEqual({ enabled: true, mode: 'sandbox', hasApiKey: true });
    expect(validateConfig('mayar', { ...config, apiKey: '' }, config).apiKey).toBe(config.apiKey);
    expect(() => validateConfig('mayar', { ...config, mode: 'production', apiKey: '' }, config)).toThrow(/Isi ulang/);
    expect(() => validateConfig('mayar', { ...config, apiKey: null }, config)).toThrow(/Lengkapi/);
  });
  it('membaca kanal melalui host sandbox, meniadakan QR statis dan mempertahankan status nonaktif', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ config: [{ type: 'qris', code: 'QRIS', name: 'QRIS', status: true }, { type: 'va', code: 'BNI', status: false }, { type: 'qris_static', status: true }] }));
    vi.stubGlobal('fetch', fetch);
    expect(await daftarKanal(config)).toMatchObject([{ code: 'qris/QRIS', active: true }, { code: 'va/BNI', active: false }]);
    expect(fetch.mock.calls[0][0]).toBe('https://api.mayar.io/hl/v2/payment-channels');
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: `Bearer ${config.apiKey}` } });
  });
  it('membuat request 1 jam dengan nominal server tanpa memaksa kanal hosted checkout', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ id: ref, transactionId: trx, link: 'https://toko.myr.id/pl/test' }));
    vi.stubGlobal('fetch', fetch);
    const result = await buatTransaksi(input, { ...config, mode: 'production' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.mayar.id/hl/v2/payments/create');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ name: 'WEB-123', amount: 10000, extraData: { orderId: ref } });
    expect(body.paymentMethod).toBeUndefined(); expect(body.redirectUrl).toBeUndefined();
    expect(Date.parse(body.expiredAt) - Date.now()).toBeGreaterThan(3595000);
    expect(result).toMatchObject({ reference: ref, transactionId: trx, amount: 10000 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([undefined, 'javascript:alert(1)', 'http://toko.myr.id/x', 'https://user:pass@toko.myr.id/x'])('menolak URL tidak aman %s tanpa mengulangi create', async link => {
    const fetch = vi.fn().mockResolvedValue(response({ id: ref, transactionId: trx, link })); vi.stubGlobal('fetch', fetch);
    await expect(buatTransaksi(input, config)).rejects.toThrow(/tidak lengkap/); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429, 500])('menyembunyikan respons sensitif HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ statusCode: status, messages: config.apiKey }), { status })));
    const error = await daftarKanal(config).catch(e => e);
    expect(error.message).not.toContain(config.apiKey); expect(error.status).toBe(502);
  });
  it('tidak mengirim request berulang setelah timeout dan menolak path manipulasi', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error(config.apiKey)); vi.stubGlobal('fetch', fetch);
    await expect(buatTransaksi(input, config)).rejects.toThrow(/tidak dapat dihubungi/);
    expect(fetch).toHaveBeenCalledOnce();
    await expect(detailTransaksi('../account', config)).rejects.toThrow(/Referensi/);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('hanya menerima identitas dan nominal persis', () => {
    const order = { payment_reference: ref, payment_transaction_id: trx, payment_amount: 10000 };
    const data = { id: trx, paymentLink: { id: ref }, amount: 10000, status: 'paid' };
    expect(verifiedPayment(order, data).paid).toBe(true);
    for (const patch of [{ id: ref }, { paymentLink: { id: trx } }, { amount: 9999 }, { amount: 10000.5 }]) expect(() => verifiedPayment(order, { ...data, ...patch })).toThrow(/tidak sesuai/);
    expect(verifiedPayment(order, { ...data, status: 'SUCCESS' }).paid).toBe(false);
  });
});


describe('Kanal dan instruksi pembayaran langsung Mayar', () => {
  it('hanya QRIS dan bank yang didukung, sesuai status aktif', () => {
    const channels = checkoutChannels([{ code: 'qris/QRIS', group: 'qris', active: true }, { code: 'va/BNI', group: 'va', active: true }, { code: 'va/BRI', group: 'va', active: false }, { code: 'va/BCA', group: 'va', active: true }, { code: 'ewallet/DANA', group: 'ewallet', active: true }]);
    expect(channels.map(c => c.code)).toEqual(['QRIS', 'VA/BNI']);
  });
  it('tidak menampilkan respons asing, URL, HTML, atau nomor VA yang kehilangan nol di depan', () => {
    for (const paymentCode of [undefined, 1234567890, {}, '<script>1234567890</script>', 'https://evil.example/pay', '123', '1'.repeat(33)]) {
      expect(paymentInstructions({ paymentCode }, 'va/bni')).toBeNull();
      expect(paymentInstructions({ paymentCode }, 'qris')).toBeNull();
    }
    expect(paymentInstructions({ paymentCode: '001234567890' }, 'va/bni')).toEqual({ kind: 'va', bank: 'BNI', pay_code: '001234567890' });
  });
  it('menerima payload QR mentah saja tanpa URL gambar atau respons lainnya', () => {
    const qrString = '00020101021253033605405100005802ID6304ABCD';
    expect(paymentInstructions({ qrString, apiKey: 'do-not-expose' }, 'qris')).toEqual({ kind: 'qris', qr_string: qrString });
    expect(paymentInstructions({ qrString }, 'va/bni')).toBeNull();
    expect(paymentInstructions({ link: 'https://merchant.myr.id/pl/order' }, 'qris')).toBeNull();
  });
});
