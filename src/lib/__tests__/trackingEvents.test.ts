import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let scripts: { src: string }[];
let storage: Map<string, string>;
let tracking: typeof import('../pixelToko');
const purchase = { jenis: 'Purchase' as const, barang: [{ id: 'p1', nama: 'Gear', qty: 2, harga: 125000 }], nilai: 240000, idPesanan: 'order-1', nomorPesanan: 'WEB-001', shipping: 15000, tax: 0 };
function globals() {
  vi.stubGlobal('window', { location: { origin: 'https://shop.test', pathname: '/toko/produk/gear', search: '?email=private@test', href: 'https://shop.test/toko/produk/gear?email=private@test' } });
  vi.stubGlobal('document', { title: 'Gear', cookie: '', createElement: () => ({}), getElementsByTagName: () => [], head: { appendChild: (s: { src: string }) => scripts.push(s) } });
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
}
beforeEach(async () => { vi.resetModules(); scripts = []; storage = new Map(); globals(); tracking = await import('../pixelToko'); });
afterEach(() => vi.unstubAllGlobals());
const w = () => window as unknown as { dataLayer: Array<any>; fbq: { queue: any[] } }; // vendor queue
it('validates GA4/GTM identifiers and rejects injected scripts', () => {
  expect(tracking.idPixelDariToko({ google_analytics_id: 'G-ABCD123456', google_tag_manager_id: 'GTM-ABC1234' })).toMatchObject({ googleAnalytics: 'G-ABCD123456', googleTagManager: 'GTM-ABC1234' });
  expect(tracking.idPixelDariToko({ google_analytics_id: 'G-X</script>', google_tag_manager_id: 'GTM-X?evil' })).toMatchObject({ googleAnalytics: null, googleTagManager: null });
});
it('GA4 and Ads share one loader with explicit destinations and no automatic pageview', () => {
  const ids = tracking.idPixelDariToko({ google_analytics_id: 'G-ABCD123456', google_ads_id: 'AW-123456789' });
  tracking.pasangPixel(ids); tracking.pasangPixel(ids); tracking.lacakHalaman(); tracking.lacakPixel(purchase);
  expect(scripts).toHaveLength(1);
  const commands = w().dataLayer.map(x => Array.from(x));
  expect(commands.filter(x => x[0] === 'config')).toEqual([['config', ids.googleAnalytics, { send_page_view: false }], ['config', ids.googleAds, { send_page_view: false }]]);
  expect(commands.filter(x => x[1] === 'page_view')).toHaveLength(2);
  expect(JSON.stringify(commands)).not.toContain('private@test');
  expect(commands.find(x => x[1] === 'purchase' && (x[2] as any).send_to === ids.googleAnalytics)?.[2]).toMatchObject({ value: 240000, currency: 'IDR', transaction_id: 'order-1', shipping: 15000, items: [{ item_id: 'p1', quantity: 2, price: 125000 }] });
});
it('GTM replaces direct Google tags and clears previous ecommerce data', () => {
  tracking.pasangPixel(tracking.idPixelDariToko({ google_tag_manager_id: 'GTM-ABC1234', google_analytics_id: 'G-ABCD123456', google_ads_id: 'AW-123456789' }));
  tracking.lacakHalaman(); tracking.lacakPixel(purchase);
  expect(scripts.map(s => s.src)).toEqual(['https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234']);
  expect(w().dataLayer.some(x => x.event === 'storefront_page_view')).toBe(true);
  expect(w().dataLayer.slice(-2)).toEqual([{ ecommerce: null }, { event: 'purchase', event_id: 'order-1', ecommerce: expect.objectContaining({ transaction_id: 'order-1' }) }]);
});
it('Meta/browser purchase uses the server event ID and suppresses polling and reload duplicates', async () => {
  const ids = tracking.idPixelDariToko({ meta_pixel_id: '1234567890123456' });
  tracking.lacakPixel(purchase); tracking.pasangPixel(ids); tracking.lacakPixel(purchase);
  expect(w().fbq.queue.filter(x => x[2] === 'Purchase')).toEqual([['trackSingle', ids.meta, 'Purchase', expect.objectContaining({ value: 240000 }), { eventID: 'order-1' }]]);
  vi.resetModules(); globals(); tracking = await import('../pixelToko'); tracking.pasangPixel(ids); tracking.lacakPixel(purchase);
  expect(w().fbq.queue.filter(x => x[2] === 'Purchase')).toHaveLength(0);
});
it('retains the original route when catalog configuration arrives later', () => {
  tracking.lacakHalaman(); window.location.pathname = '/toko/checkout';
  tracking.pasangPixel(tracking.idPixelDariToko({ google_tag_manager_id: 'GTM-ABC1234' }));
  expect(w().dataLayer.find(x => x.event === 'storefront_page_view').page_path).toBe('/toko/produk/gear');
});
it('storage denied still suppresses duplicates within the session', () => {
  vi.stubGlobal('localStorage', { getItem() { throw new Error('denied'); } });
  tracking.pasangPixel(tracking.idPixelDariToko({ google_tag_manager_id: 'GTM-ABC1234' }));
  tracking.lacakPixel(purchase); tracking.lacakPixel(purchase);
  expect(w().dataLayer.filter(x => x.event === 'purchase')).toHaveLength(1);
});
it('captures only well-formed Meta attribution cookies', () => {
  document.cookie = '_fbp=fb.1.1720000000000.123456; _fbc=fb.1.1720000000000.clickID_123; session=secret';
  expect(tracking.atribusiMeta()).toEqual({ fbp: 'fb.1.1720000000000.123456', fbc: 'fb.1.1720000000000.clickID_123' });
  document.cookie = '_fbp=<script>; _fbc=email@test'; expect(tracking.atribusiMeta()).toEqual({});
});
