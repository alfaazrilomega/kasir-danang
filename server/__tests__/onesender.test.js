import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicAddress, tesKoneksi, validateApiUrl } from '../integrasi/onesender.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
const config = { apiUrl: 'http://164.152.166.165:3001/api/v1/messages', apiKey: 'test-key' };

function mockResponse(transport, status, body) {
  return vi.spyOn(transport, 'request').mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      const response = Readable.from([Buffer.from(body)]);
      response.statusCode = status;
      callback(response);
    };
    return req;
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.mocked(lookup).mockReset(); });

describe('OneSender API', () => {
  it('menerima URL HTTP dengan IP dan port seperti Device info', () => {
    expect(validateApiUrl(config.apiUrl).href).toBe(config.apiUrl);
    expect(validateApiUrl('https://wa.example.com/api/v1/messages').protocol).toBe('https:');
  });

  it.each([
    'file:///api/v1/messages', 'https://user:pass@example.com/api/v1/messages',
    'https://example.com/api/v1/messages?key=secret', 'https://example.com/api/v1/messages#secret',
    'http://localhost:3001/api/v1/messages', 'http://169.254.169.254/api/v1/messages',
    'http://[::ffff:127.0.0.1]/api/v1/messages',
  ])('menolak API URL tidak aman: %s', (url) => {
    expect(() => validateApiUrl(url)).toThrow();
  });

  it('memblokir alamat internal IPv4 dan IPv6', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    expect(isPublicAddress('164.152.166.165')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('hanya membaca daftar pesan dengan Bearer token tanpa meneruskan isi pesan', async () => {
    const request = mockResponse(http, 200, JSON.stringify({ data: [{ text: 'private message' }] }));
    expect(await tesKoneksi(config)).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].href).toBe(`${config.apiUrl}?page=1&per_page=1`);
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer test-key' } });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('memakai HTTPS dan mem-pin DNS yang sudah divalidasi', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '164.152.166.165', family: 4 }]);
    const request = mockResponse(https, 200, '{"data":[]}');
    await tesKoneksi({ ...config, apiUrl: 'https://wa.example.com/api/v1/messages' });
    const callback = vi.fn();
    request.mock.calls[0][1].lookup('wa.example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '164.152.166.165', 4);
  });

  it('menolak domain yang mengarah ke jaringan internal', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const request = mockResponse(http, 200, '{"data":[]}');
    await expect(tesKoneksi({ ...config, apiUrl: 'http://wa.example.com/api/v1/messages' })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [302, '{}'], [401, '{"error":"test-key"}'], [200, '<html>Login</html>'],
    [200, '{"success":false,"data":[]}'], [200, '{"message":"Unauthorized"}'],
  ])('menolak HTTP %s atau respons gagal tanpa membocorkan isinya', async (status, body) => {
    mockResponse(http, status, body);
    await expect(tesKoneksi(config)).rejects.toThrow(/OneSender/);
  });
});
