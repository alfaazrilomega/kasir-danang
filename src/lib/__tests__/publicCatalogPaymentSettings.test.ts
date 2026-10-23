import { afterEach, expect, it, vi } from 'vitest';
import { fetchPublicCatalog } from '../publicCatalog';

vi.mock('../config', () => ({ loadConfig: () => ({ apiBaseUrl: '' }) }));
afterEach(() => vi.unstubAllGlobals());

it('checkout mengambil status pembayaran terbaru meskipun katalog sebelumnya sudah tersimpan', async () => {
  const storeId = 'payment-settings-test';
  const response = (enabled: boolean) => new Response(JSON.stringify({ data: {
    store: { id: storeId, manual_transfer_enabled: enabled, manual_qris_enabled: enabled },
    products: [], categories: [],
  } }));
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(true))
    .mockResolvedValueOnce(response(false))
    .mockResolvedValueOnce(response(true));
  vi.stubGlobal('fetch', fetchMock);

  expect((await fetchPublicCatalog(storeId)).store?.manual_transfer_enabled).toBe(true);
  await fetchPublicCatalog(storeId);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const updated = await fetchPublicCatalog(storeId, { forceRefresh: true });
  expect(updated.store?.manual_transfer_enabled).toBe(false);
  expect(updated.store?.manual_qris_enabled).toBe(false);
  expect((await fetchPublicCatalog(storeId)).store?.manual_qris_enabled).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  expect((await fetchPublicCatalog(storeId, { forceRefresh: true })).store?.manual_qris_enabled).toBe(true);
});
