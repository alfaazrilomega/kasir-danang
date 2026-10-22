// Spec 0002: DOKU Checkout, rantai gateway cadangan, ongkir KiriminAja.
import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as doku from '../integrasi/doku.js';
import { defaults, publicConfig, validateConfig, encryptConfig } from '../integrasi/settings.js';
import { rantaiGateway, kanalSetara, kanalDariRantai } from '../integrasi/gatewayCadangan.js';
import { beratPesanan, bacaWilayah, opsiOngkir, BERAT_CADANGAN_GRAM } from '../integrasi/ongkirToko.js';
import { daftarWilayah, pastikanWilayah } from '../integrasi/kiriminaja.js';
import { barisTagihanTripay } from '../voucherToko.js';

const cfgDoku = { enabled: true, mode: 'sandbox', clientId: 'BRN-0201-1234567890', secretKey: 'SK-rahasia-uji' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => { process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'rahasia-uji-gateway'; });

describe('DOKU: tanda tangan non SNAP', () => {
  it('menyusun komponen berurutan dengan Digest hanya untuk request berbadan', () => {
    const umum = { clientId: 'C', requestId: 'R', timestamp: '2026-10-17T01:02:03Z', target: '/checkout/v1/payment' };
    const body = '{"order":{"amount":1}}';
    const digest = crypto.createHash('sha256').update(body).digest('base64');
    const harap = (teks) => `HMACSHA256=${crypto.createHmac('sha256', 'S').update(teks).digest('base64')}`;
    expect(doku.tandaTangan({ ...umum, body }, 'S')).toBe(harap(`Client-Id:C\nRequest-Id:R\nRequest-Timestamp:2026-10-17T01:02:03Z\nRequest-Target:/checkout/v1/payment\nDigest:${digest}`));
    expect(doku.tandaTangan(umum, 'S')).toBe(harap('Client-Id:C\nRequest-Id:R\nRequest-Timestamp:2026-10-17T01:02:03Z\nRequest-Target:/checkout/v1/payment'));
  });

  it('membuat pembayaran Checkout dengan header bertanda tangan dan nominal server', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ response: { payment: { url: 'https://sandbox.doku.com/checkout-link-v2/abc', token_id: 'tok-1', expired_date: '20261017103000' } } }));
    vi.stubGlobal('fetch', fetch);
    const hasil = await doku.buatTransaksi({ orderNumber: 'WEB-ABC1', amount: 150000, customerName: 'Budi', customerEmail: 'b@contoh.id', customerPhone: '0812-3456', callbackUrl: 'https://toko.id/toko/akun?tab=pesanan' }, cfgDoku);
    const [url, opsi] = fetch.mock.calls[0];
    expect(url).toBe('https://api-sandbox.doku.com/checkout/v1/payment');
    expect(opsi.method).toBe('POST');
    expect(opsi.headers['Client-Id']).toBe(cfgDoku.clientId);
    expect(opsi.headers['Request-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const isi = JSON.parse(opsi.body);
    expect(isi).toMatchObject({ order: { amount: 150000, invoice_number: 'WEB-ABC1', callback_url: 'https://toko.id/toko/akun?tab=pesanan', auto_redirect: true }, payment: { payment_due_date: 60 }, customer: { name: 'Budi', phone: '08123456' } });
    // Tanda tangan dihitung ulang dari header yang benar-benar terkirim.
    expect(opsi.headers.Signature).toBe(doku.tandaTangan({ clientId: cfgDoku.clientId, requestId: opsi.headers['Request-Id'], timestamp: opsi.headers['Request-Timestamp'], target: '/checkout/v1/payment', body: opsi.body }, cfgDoku.secretKey));
    expect(hasil).toMatchObject({ reference: 'tok-1', checkout_url: 'https://sandbox.doku.com/checkout-link-v2/abc', transactionId: opsi.headers['Request-Id'] });
    expect(hasil.expiresAt).toBe('2026-10-17T03:30:00.000Z');
  });

  it('menolak kunci salah dengan pesan jelas tanpa membocorkan respons', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'Invalid Signature' } }, 401)));
    await expect(doku.tesKoneksi(cfgDoku)).rejects.toThrow(/ditolak pada mode sandbox/);
  });

  // Bentuk respons persis dari DOKU sandbox asli (17 Okt 2026).
  it.each([
    ['invalid_signature', 'Invalid Header Signature'],
    ['invalid_client_id', 'Invalid Client-Id'],
  ])('respons asli DOKU 400 %s dianggap kunci ditolak', async (code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code, message, type: 'invalid_request_error' } }, 400)));
    await expect(doku.tesKoneksi(cfgDoku)).rejects.toThrow(/ditolak pada mode sandbox/);
  });

  it('respons asli DOKU 404 data_not_found untuk invoice acak berarti kunci diterima', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'data_not_found', type: 'not_found', message: 'Invoice Number or Req ID not found' } }, 404)));
    await expect(doku.tesKoneksi(cfgDoku)).resolves.toBeUndefined();
  });

  it('tes koneksi lolos bila autentikasi diterima walau invoice acak tidak ditemukan', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'not found' }, 404)));
    await expect(doku.tesKoneksi(cfgDoku)).resolves.toBeUndefined();
  });
});

describe('DOKU: status dan notifikasi', () => {
  const order = { order_number: 'WEB-ABC1', payment_amount: '150000', payment_expires_at: '2026-10-17T03:30:00Z' };
  it('lunas hanya bila SUCCESS dengan invoice dan nominal cocok', () => {
    expect(doku.verifiedPayment(order, { order: { invoice_number: 'WEB-ABC1', amount: 150000 }, transaction: { status: 'SUCCESS' } })).toMatchObject({ paid: true, closed: false });
    expect(doku.verifiedPayment(order, { order: { invoice_number: 'WEB-ABC1', amount: 150000 }, transaction: { status: 'EXPIRED' } })).toMatchObject({ paid: false, closed: true });
    expect(doku.verifiedPayment(order, { order: { invoice_number: 'WEB-ABC1', amount: 150000 }, transaction: { status: 'PENDING' } })).toMatchObject({ paid: false, unpaid: true });
    expect(() => doku.verifiedPayment(order, { order: { invoice_number: 'WEB-LAIN', amount: 150000 }, transaction: { status: 'SUCCESS' } })).toThrow(/tidak sesuai/);
    expect(() => doku.verifiedPayment(order, { order: { invoice_number: 'WEB-ABC1', amount: 1000 }, transaction: { status: 'SUCCESS' } })).toThrow(/tidak sesuai/);
  });

  it('memeriksa tanda tangan notifikasi dengan jalur notifikasi toko', () => {
    const raw = JSON.stringify({ order: { invoice_number: 'WEB-ABC1', amount: 150000 }, transaction: { status: 'SUCCESS' } });
    const header = { clientId: cfgDoku.clientId, requestId: 'n-1', timestamp: '2026-10-17T03:00:00Z' };
    header.signature = doku.tandaTangan({ ...header, target: doku.JALUR_NOTIFIKASI, body: raw }, cfgDoku.secretKey);
    expect(doku.notifikasiSah(header, raw, cfgDoku)).toBe(true);
    expect(doku.notifikasiSah(header, raw.replace('150000', '1'), cfgDoku)).toBe(false);
    expect(doku.notifikasiSah({ ...header, clientId: 'LAIN' }, raw, cfgDoku)).toBe(false);
    expect(doku.notifikasiSah({ ...header, signature: undefined }, raw, cfgDoku)).toBe(false);
  });
});

describe('DOKU: pengaturan', () => {
  it('menyimpan Secret Key tanpa mengeksposnya dan mewajibkan Client ID', () => {
    expect(defaults('doku')).toEqual({ enabled: false, mode: 'sandbox', clientId: '', secretKey: '' });
    expect(publicConfig('doku', cfgDoku)).toEqual({ enabled: true, mode: 'sandbox', clientId: cfgDoku.clientId, hasSecretKey: true });
    expect(validateConfig('doku', { ...cfgDoku, secretKey: '' }, cfgDoku).secretKey).toBe(cfgDoku.secretKey);
    expect(() => validateConfig('doku', { enabled: true, mode: 'sandbox', clientId: '', secretKey: 'x' }, defaults('doku'))).toThrow(/Lengkapi/);
    expect(() => validateConfig('doku', { ...cfgDoku, clientId: 'ada spasi' }, cfgDoku)).toThrow(/Client ID/);
    expect(() => validateConfig('doku', { ...cfgDoku, mode: 'production', secretKey: '' }, cfgDoku)).toThrow(/Isi ulang/);
  });
});

// Basis data tiruan: pilihan layanan utama + baris integrasi terenkripsi.
function dbTiruan(utama, integrasi) {
  return {
    async query(sql, params) {
      if (/store_payment_settings/.test(sql)) return { rows: utama ? [{ provider: utama }] : [] };
      if (/store_integrations/.test(sql)) {
        const cfg = integrasi[params[1]];
        return { rows: cfg ? [{ config_encrypted: encryptConfig(cfg, `${params[0]}:${params[1]}`) }] : [] };
      }
      throw new Error(`query tak terduga: ${sql}`);
    },
  };
}
const TOKO = '11111111-1111-4111-8111-111111111111';
const cfgTripay = { enabled: true, mode: 'sandbox', merchantCode: 'T1', apiKey: 'k', privateKey: 'p' };
const cfgMayar = { enabled: true, mode: 'sandbox', apiKey: 'm' };

describe('Rantai gateway cadangan', () => {
  it('layanan utama pertama, sisanya urut Tripay, Mayar, DOKU, hanya yang aktif', async () => {
    const semua = { tripay: cfgTripay, mayar: cfgMayar, doku: cfgDoku };
    expect((await rantaiGateway(dbTiruan(null, semua), TOKO)).map((r) => r.provider)).toEqual(['tripay', 'mayar', 'doku']);
    expect((await rantaiGateway(dbTiruan('doku', semua), TOKO)).map((r) => r.provider)).toEqual(['doku', 'tripay', 'mayar']);
    expect((await rantaiGateway(dbTiruan('tripay', { tripay: cfgTripay, mayar: { ...cfgMayar, enabled: false }, doku: cfgDoku }), TOKO)).map((r) => r.provider)).toEqual(['tripay', 'doku']);
    expect(await rantaiGateway(dbTiruan('manual', semua), TOKO)).toEqual([]);
  });

  it('hanya Tripay terpasang: rantai satu layanan, perilaku sama seperti sebelumnya', async () => {
    expect((await rantaiGateway(dbTiruan(null, { tripay: cfgTripay }), TOKO)).map((r) => r.provider)).toEqual(['tripay']);
  });

  it('daftar kanal pindah ke DOKU saat Tripay gagal dihubungi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const hasil = await kanalDariRantai([{ provider: 'tripay', config: cfgTripay }, { provider: 'doku', config: cfgDoku }], 150000);
    expect(hasil.provider).toBe('doku');
    expect(hasil.channels.map((c) => c.code)).toEqual(['DOKU']);
    expect(hasil.gagal[0]).toMatch(/^tripay:/);
  });

  it('kanal setara: QRIS ke QRIS, VA ke bank yang sama, selain itu halaman umum', async () => {
    expect(await kanalSetara('BRIVA', 'doku', cfgDoku, 150000)).toEqual({ code: 'DOKU', kanal: null });
    const kanalMayar = { config: [{ type: 'qris', code: 'QRIS', name: 'QRIS', status: true }, { type: 'va', code: 'BRI', name: 'BRI', status: true }, { type: 'ewallet', code: 'OVO', name: 'OVO', status: true }] };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ statusCode: 200, data: kanalMayar }), { status: 200 })));
    expect((await kanalSetara('QRIS2', 'mayar', cfgMayar, 150000)).code).toBe('QRIS');
    expect((await kanalSetara('BRIVA', 'mayar', cfgMayar, 150000)).code).toBe('VA/BRI');
    expect((await kanalSetara('OVO', 'mayar', cfgMayar, 150000)).code).toBe('MAYAR');
  });
});

describe('Ongkir KiriminAja', () => {
  it('berat dari produk, produk tanpa berat dihitung 1000 g', () => {
    const produk = new Map([['a', { weight_gram: 250 }], ['b', { weight_gram: null }]]);
    expect(beratPesanan([{ product_id: 'a', qty: 2 }, { product_id: 'b', qty: 1 }], produk)).toBe(500 + BERAT_CADANGAN_GRAM);
  });

  it('wilayah wajib empat ID bilangan bulat positif', () => {
    expect(bacaWilayah({ provinsi_id: 11, kota_id: '22', kecamatan_id: 33, kelurahan_id: 44 })).toEqual({ provinsi_id: 11, kota_id: 22, kecamatan_id: 33, kelurahan_id: 44 });
    expect(bacaWilayah({ provinsi_id: 11, kota_id: 22, kecamatan_id: 33 })).toBeNull();
    expect(bacaWilayah({ provinsi_id: 11, kota_id: 22, kecamatan_id: 33, kelurahan_id: '1 or 1=1' })).toBeNull();
  });

  it('memakai jalur wilayah OpenAPI 6.2 dan nama kota berjenis', async () => {
    const fetch = vi.fn().mockImplementation(async (url, opsi) => {
      if (url.endsWith('/api/mitra/province')) return json({ status: true, datas: [{ id: 11, provinsi_name: 'Jawa Timur' }] });
      if (url.endsWith('/api/mitra/city')) return json({ status: true, datas: [{ id: 22, provinsi_id: 11, kabupaten_name: 'Sidoarjo', type: 'Kabupaten', postal_code: '61200' }] });
      if (url.endsWith('/api/mitra/kecamatan')) return json({ status: true, datas: [{ id: 33, kecamatan_name: 'Waru', kabupaten_id: 22 }] });
      if (url.endsWith('/api/mitra/kelurahan')) return json({ status: true, results: [{ id: 44, kelurahan_name: 'Kepuhkiriman', kecamatan_id: 33 }] });
      throw new Error(`jalur tak terduga ${url} ${opsi.body}`);
    });
    vi.stubGlobal('fetch', fetch);
    const cfg = { enabled: true, mode: 'production', token: 'tok-uji-wilayah' };
    expect(await daftarWilayah('kota', 11, cfg)).toEqual([{ id: 22, nama: 'Kabupaten Sidoarjo' }]);
    const kotaCall = fetch.mock.calls.find(([u]) => u.endsWith('/api/mitra/city'));
    expect(JSON.parse(kotaCall[1].body)).toEqual({ provinsi_id: 11 });
    expect(kotaCall[1].headers.Authorization).toBe('Bearer tok-uji-wilayah');
    expect(await pastikanWilayah({ provinsi_id: 11, kota_id: 22, kecamatan_id: 33, kelurahan_id: 44 }, cfg)).toMatchObject({ kota: 'Kabupaten Sidoarjo', kecamatan: 'Waru', kelurahan: 'Kepuhkiriman' });
    expect(await pastikanWilayah({ provinsi_id: 11, kota_id: 22, kecamatan_id: 33, kelurahan_id: 99 }, cfg)).toBeNull();
  });

  it('opsi ongkir dinormalkan, urut termurah, berbody sesuai OpenAPI', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ status: true, results: [
      { service: 'jne', service_name: 'JNE Reguler', service_type: 'REG', cost: '18000', etd: '2-3', group: 'regular' },
      { service: 'sicepat', service_name: 'SiCepat Halu', service_type: 'HALU', cost: '12000', etd: '3-4', group: 'regular' },
      { service: 'rusak', service_name: 'Tanpa harga', service_type: 'X', cost: 'abc', etd: '' },
    ] }));
    vi.stubGlobal('fetch', fetch);
    const cfg = { enabled: true, mode: 'sandbox', token: 't', originDistrict: '5', originSubdistrict: '6' };
    const opsi = await opsiOngkir(cfg, { kecamatanId: 33, kelurahanId: 44, berat: 1250, nilaiBarang: 150000 });
    expect(opsi.map((o) => [o.courier, o.service, o.ongkir])).toEqual([['sicepat', 'HALU', 12000], ['jne', 'REG', 18000]]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ origin: 5, subdistrict_origin: 6, destination: 33, subdistrict_destination: 44, weight: 1250, item_value: 150000, insurance: '0' });
    expect(fetch.mock.calls[0][0]).toBe('https://tdev.kiriminaja.com/api/mitra/v6.1/shipping_price');
  });

  it('tagihan Tripay memuat baris ongkir dan jumlahnya sama dengan total', () => {
    const items = [{ name: 'Gear', price: 100000, qty: 2 }];
    const kirim = { ongkir: 18000, nama: 'JNE Reguler' };
    const tanpaVoucher = barisTagihanTripay(items, 218000, 0, 'WEB-1', kirim);
    expect(tanpaVoucher.reduce((n, b) => n + b.price * b.quantity, 0)).toBe(218000);
    const denganVoucher = barisTagihanTripay(items, 198000, 20000, 'WEB-1', kirim);
    expect(denganVoucher.reduce((n, b) => n + b.price * b.quantity, 0)).toBe(198000);
    expect(denganVoucher.at(-1).name).toMatch(/^Ongkir/);
  });
});
