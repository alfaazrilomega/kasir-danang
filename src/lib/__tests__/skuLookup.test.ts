import { describe, expect, it } from 'vitest';
import {
  buildChannelSkuIndex,
  findExternalSkuConflict,
  findSkuConflict,
  normalizeSku,
} from '@/lib/skuLookup';
import type { Product, ProductChannelMapping } from '@/types';

function mapping(over: Partial<ProductChannelMapping>): ProductChannelMapping {
  return {
    id: 'm1',
    store_id: 's1',
    product_id: 'p1',
    channel_code: 'shopee',
    external_sku: 'SHP-1',
    external_url: null,
    is_synced: false,
    last_synced_at: null,
    ...over,
  };
}

function product(over: Partial<Product>): Product {
  return {
    id: 'p1',
    store_id: 's1',
    category_id: null,
    name: 'Produk',
    description: null,
    image_url: null,
    base_price: 0,
    sizes: [],
    is_active: true,
    sku: null,
    barcode: null,
    cost_price: 0,
    stock_qty: 0,
    min_stock: 0,
    track_stock: false,
    ...over,
  };
}

describe('normalizeSku', () => {
  it('menyeragamkan spasi dan huruf besar-kecil', () => {
    expect(normalizeSku('  gd-wr520-13t ')).toBe('GD-WR520-13T');
  });

  it('mengembalikan string kosong untuk null/undefined', () => {
    expect(normalizeSku(null)).toBe('');
    expect(normalizeSku(undefined)).toBe('');
  });
});

describe('buildChannelSkuIndex', () => {
  it('mengindeks per channel dan lintas channel', () => {
    const idx = buildChannelSkuIndex([
      mapping({ id: 'a', channel_code: 'shopee', external_sku: 'SHP-1' }),
      mapping({ id: 'b', channel_code: 'tiktok', external_sku: 'TT-1', product_id: 'p2' }),
    ]);
    expect(idx.byCode.get('SHOPEE|SHP-1')?.id).toBe('a');
    expect(idx.byAnyCode.get('TT-1')?.id).toBe('b');
    expect(idx.byProduct.get('p1')).toHaveLength(1);
  });

  it('mengabaikan SKU kosong', () => {
    const idx = buildChannelSkuIndex([mapping({ external_sku: '   ' })]);
    expect(idx.byAnyCode.size).toBe(0);
  });

  it('mempertahankan yang pertama saat SKU sama di dua channel', () => {
    // Penting: hasil scan tidak boleh berubah hanya karena urutan sync berbeda.
    const idx = buildChannelSkuIndex([
      mapping({ id: 'first', channel_code: 'shopee', external_sku: 'SAMA' }),
      mapping({ id: 'second', channel_code: 'tiktok', external_sku: 'SAMA' }),
    ]);
    expect(idx.byAnyCode.get('SAMA')?.id).toBe('first');
  });
});

describe('findSkuConflict', () => {
  const products = [product({ id: 'p1', sku: 'ABC-1', name: 'Kopi' })];

  it('menemukan bentrok tanpa peduli huruf besar-kecil', () => {
    expect(findSkuConflict('abc-1', products)?.name).toBe('Kopi');
  });

  it('mengabaikan dirinya sendiri saat mengedit', () => {
    expect(findSkuConflict('ABC-1', products, 'p1')).toBeNull();
  });

  it('SKU kosong bukan bentrok', () => {
    expect(findSkuConflict('   ', products)).toBeNull();
  });
});

describe('findExternalSkuConflict', () => {
  const rows = [{ id: 'm1', channel_code: 'shopee', external_sku: 'SHP-1' }];

  it('bentrok hanya dalam channel yang sama', () => {
    expect(findExternalSkuConflict('shopee', 'shp-1', rows)).not.toBeNull();
    expect(findExternalSkuConflict('tiktok', 'shp-1', rows)).toBeNull();
  });

  it('mengabaikan baris dirinya sendiri', () => {
    expect(findExternalSkuConflict('shopee', 'SHP-1', rows, 'm1')).toBeNull();
  });
});
