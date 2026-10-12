import { afterEach, describe, expect, it, vi } from 'vitest';
import { tesKoneksi, validateSettings } from '../integrasi/metaWhatsapp.js';

const config = { wabaId: '123456789', phoneNumberId: '987654321', apiVersion: 'v23.0', accessToken: 'meta-test-token' };
const phone = { id: config.phoneNumberId, display_phone_number: '+62 81234567890', verified_name: 'Toko' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => vi.unstubAllGlobals());

describe('WhatsApp Cloud API Meta', () => {
  it('mempertahankan token kosong dan hanya menyimpan field yang diizinkan', () => {
    expect(validateSettings({ ...config, accessToken: '', apiUrl: 'https://example.com' }, config)).toEqual(config);
  });

  it.each([
    { wabaId: '' }, { phoneNumberId: '../messages' }, { phoneNumberId: 987654321 },
    { apiVersion: 'v23.0/../me' }, { apiVersion: '' }, { accessToken: 'Bearer token' },
    { accessToken: 'token\nsecret' },
  ])('menolak konfigurasi invalid: %j', (patch) => {
    expect(() => validateSettings({ ...config, ...patch }, config)).toThrow();
  });

  it('membaca nomor dari WABA di host Meta dengan token di header, tanpa mengirim pesan', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [phone] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await tesKoneksi(config)).toEqual({ phoneNumber: phone.display_phone_number });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(`https://graph.facebook.com/${config.apiVersion}/${config.wabaId}/phone_numbers?`);
    expect(url).not.toContain(config.accessToken);
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${config.accessToken}` } });
    expect(options.body).toBeUndefined();
  });

  it('memeriksa halaman berikutnya lewat cursor tanpa mengikuti URL dari respons', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [], paging: { next: 'https://evil.example/steal', cursors: { after: 'next-cursor' } } }))
      .mockResolvedValueOnce(response({ data: [phone] }));
    vi.stubGlobal('fetch', fetchMock);
    await tesKoneksi(config);
    const next = new URL(fetchMock.mock.calls[1][0]);
    expect(next.origin).toBe('https://graph.facebook.com');
    expect(next.searchParams.get('after')).toBe('next-cursor');
  });

  it('menolak nomor dari akun berbeda dan tidak menganggap akses WABA saja sebagai sukses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: [{ ...phone, id: '111' }] })));
    await expect(tesKoneksi(config)).rejects.toThrow(/tidak terdaftar/);
  });

  it.each([
    [190, /kedaluwarsa/], [10, /whatsapp_business_management/], [200, /whatsapp_business_management/], [100, /menolak koneksi/],
  ])('memberikan pesan aman untuk error Meta %s', async (code, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code, message: config.accessToken } }, 400)));
    await expect(tesKoneksi(config)).rejects.toThrow(expected);
  });

  it('menolak respons invalid dan kegagalan jaringan dengan pesan aman', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ id: config.wabaId })).mockRejectedValueOnce(new Error(config.accessToken));
    vi.stubGlobal('fetch', fetchMock);
    await expect(tesKoneksi(config)).rejects.toThrow(/Meta menolak/);
    await expect(tesKoneksi(config)).rejects.toThrow(/Tidak dapat menghubungi/);
  });

  it('menghentikan pagination berulang', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({ data: [], paging: { next: 'next', cursors: { after: 'same' } } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(tesKoneksi(config)).rejects.toThrow(/belum dapat diperiksa/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
