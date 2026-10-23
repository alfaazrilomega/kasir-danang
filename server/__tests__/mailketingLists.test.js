import { afterEach, expect, it, vi } from 'vitest';
import { getMailketingLists, subscribeMailketing, processMailketingQueue, mailketingStoreId, mailketingAuth } from '../integrasi/mailketingLists.js';
import { encryptConfig } from '../integrasi/settings.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const auth = { token: 'test-secret', base: 'https://mailketing.example.test/api/v2' };
const noSettings = { rows: [] };
function apiResponse(data) {
  vi.stubEnv('MAILKETING_API_TOKEN', 'test-secret');
  vi.stubEnv('MAILKETING_BASE_URL', 'https://mailketing.example.test/api/v2');
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data }) }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
it('mengambil daftar v2 tanpa mengirim token ke klien', async () => {
  const fetch = apiResponse({ lists: [{ list_id: '12', list_name: 'User GNNKracing' }] });
  expect(await getMailketingLists(auth)).toEqual([{ id: 12, name: 'User GNNKracing' }]);
  expect(fetch.mock.calls[0][0]).toBe('https://mailketing.example.test/api/v2/lists');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret');
});
it.each(['added', 'already_exists'])('menganggap %s berhasil tanpa mengirim subscriber ganda', async status => {
  const fetch = apiResponse({ status });
  await subscribeMailketing({ list_id: 12, email: 'buyer@contoh.id', name: "Ayu O'Neil", phone: '08123456' }, auth);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ list_id: 12, email: 'buyer@contoh.id', first_name: 'Ayu', last_name: 'O Neil', mobile: '08123456' });
});
it('respons provider gagal tidak membocorkan token atau data pelanggan', async () => {
  apiResponse({});
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ success: false, message: 'token-secret buyer@contoh.id' }) })));
  await expect(getMailketingLists(auth)).rejects.toThrow('Mailketing menolak permintaan (HTTP 401).');
});
it('antrean tetap tersimpan saat provider gagal dan dijadwalkan ulang', async () => {
  apiResponse({});
  const job = { id: 'job-1', list_id: 12, email: 'buyer@contoh.id' };
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ store_id: mailketingStoreId() }] }).mockResolvedValueOnce(noSettings)
    .mockResolvedValueOnce({ rows: [job] }).mockResolvedValue({ rows: [] });
  const send = vi.fn().mockRejectedValue(new Error('offline'));
  await processMailketingQueue({ query }, { send });
  expect(send).toHaveBeenCalledWith(job, auth);
  expect(query.mock.calls[2][0]).toContain('for update skip locked');
  expect(query.mock.calls[2][0]).toContain('attempts < 5');
  expect(query.mock.calls[2][1]).toEqual([mailketingStoreId()]);
  expect(query.mock.calls[3][0]).toContain('next_attempt_at');
  expect(query.mock.calls[3][0]).not.toContain('processed_at = now()');
});
it('antrean sukses ditandai selesai dan dibatasi per batch', async () => {
  apiResponse({});
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ store_id: mailketingStoreId() }] }).mockResolvedValueOnce(noSettings)
    .mockResolvedValue({ rows: [{ id: 'job-1' }] });
  const send = vi.fn();
  await processMailketingQueue({ query }, { send, limit: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[3][0]).toContain('processed_at = now()');
});
it('toko tanpa token tidak diklaim antreannya dan tidak memanggil API', async () => {
  vi.stubEnv('MAILKETING_API_TOKEN', '');
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ store_id: mailketingStoreId() }] }).mockResolvedValue(noSettings);
  const send = vi.fn();
  await processMailketingQueue({ query }, { send });
  expect(query).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();
  await expect(getMailketingLists(null)).rejects.toThrow('Token Mailketing belum diatur');
});

it('token dari menu Email & Template dipakai untuk toko mana pun, token server hanya untuk tokonya', async () => {
  vi.stubEnv('INTEGRATION_SECRET', 'mailketing-test');
  vi.stubEnv('MAILKETING_API_TOKEN', 'server-token');
  const other = '11111111-1111-4111-8111-111111111111';
  const saved = (storeId, config) => ({ rows: [{ config_encrypted: encryptConfig(config, `${storeId}:email`), templates: {} }] });
  const db = rows => ({ query: vi.fn().mockResolvedValue(rows) });
  expect(await mailketingAuth(db(saved(other, { provider: 'mailketing', apiToken: 'toko-token' })), other))
    .toEqual({ token: 'toko-token', base: 'https://api.mailketing.co.id/api/v2' });
  expect(await mailketingAuth(db(saved(other, { provider: 'smtp', apiToken: 'lama' })), other)).toBeNull();
  expect(await mailketingAuth(db(noSettings), other)).toBeNull();
  expect((await mailketingAuth(db(noSettings), mailketingStoreId())).token).toBe('server-token');
});

it('daftar provider dinormalisasi, duplikat dan ID yang tidak dapat disimpan diabaikan', async () => {
  apiResponse({ lists: [
    { list_id: '12', list_name: ' Pelanggan Gear ' }, { list_id: 12, list_name: 'Duplikat' },
    { list_id: 25, list_name: '' }, { list_id: 30, list_name: null },
    null, {}, { list_id: true }, { list_id: [12] }, { list_id: -1 }, { list_id: 1.5 }, { list_id: 2147483648 },
  ] });
  expect(await getMailketingLists(auth)).toEqual([{ id: 12, name: 'Pelanggan Gear' }, { id: 25, name: 'List #25' }, { id: 30, name: 'List #30' }]);
});
