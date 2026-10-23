import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/pixelToko', () => ({ lacakPixel: vi.fn() }));
let saved: string | null = null;
let usePublicCart: typeof import('@/stores/publicCart').usePublicCart;
const product = { product_id: 'product-1', name: 'Gear Set', price: 95000, variant_name: 'Biru' };

beforeAll(async () => {
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => { saved = value; },
    removeItem: () => { saved = null; },
  };
  vi.stubGlobal('window', { localStorage: storage });
  ({ usePublicCart } = await import('@/stores/publicCart'));
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  saved = null;
  usePublicCart.setState({ lines: [], buyNow: null, drawerOpen: false });
});

it('membuka panel saat menambah barang baru maupun menambah barang yang sama', () => {
  usePublicCart.getState().add(product, 2);
  expect(usePublicCart.getState().drawerOpen).toBe(true);
  usePublicCart.getState().closeDrawer();
  usePublicCart.getState().add(product);
  expect(usePublicCart.getState().drawerOpen).toBe(true);
  expect(usePublicCart.getState().lines).toEqual([{ ...product, qty: 3 }]);
});

it('menutup panel tidak menghapus keranjang dan status terbuka tidak disimpan', () => {
  usePublicCart.getState().add(product);
  expect(JSON.parse(saved!).state).not.toHaveProperty('drawerOpen');
  usePublicCart.getState().closeDrawer();
  expect(usePublicCart.getState().lines).toHaveLength(1);
  expect(JSON.parse(saved!).state.lines[0].product_id).toBe(product.product_id);
});

it('jumlah dan hapus memakai keranjang yang sama, Beli Sekarang tetap terpisah', () => {
  usePublicCart.getState().add(product);
  usePublicCart.getState().updateQty(product.product_id, 4);
  expect(usePublicCart.getState().lines[0].qty).toBe(4);
  usePublicCart.getState().closeDrawer();
  usePublicCart.getState().setBuyNow({ ...product, qty: 2 });
  expect(usePublicCart.getState().drawerOpen).toBe(false);
  expect(usePublicCart.getState().lines[0].qty).toBe(4);
  usePublicCart.getState().remove(product.product_id);
  expect(usePublicCart.getState().lines).toEqual([]);
  expect(usePublicCart.getState().buyNow?.qty).toBe(2);
});
