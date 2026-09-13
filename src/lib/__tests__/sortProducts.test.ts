import { describe, expect, it } from 'vitest';
import { urutNamaSku } from '../sortProducts';

describe('urutNamaSku', () => {
  it('mengurutkan nama dulu, huruf besar/kecil tidak berpengaruh', () => {
    const hasil = [{ name: 'rantai 415' }, { name: 'Gear Depan' }, { name: 'Busi' }].sort(urutNamaSku);
    expect(hasil.map((p) => p.name)).toEqual(['Busi', 'Gear Depan', 'rantai 415']);
  });

  it('nama sama diurutkan menurut SKU, angka dibaca sebagai angka', () => {
    const nama = 'Gear Belakang Yamaha Fiz R Rx King GNNK Racing Product';
    const hasil = [
      { name: nama, sku: 'Gb-415-40F-Black' },
      { name: nama, sku: 'Gb-415-33F-Black' },
      { name: nama, sku: 'Gb-415-4F-Black' },
      { name: nama, sku: 'Gb-415-30F-Black' },
    ].sort(urutNamaSku);
    expect(hasil.map((p) => p.sku)).toEqual([
      'Gb-415-4F-Black',
      'Gb-415-30F-Black',
      'Gb-415-33F-Black',
      'Gb-415-40F-Black',
    ]);
  });

  it('angka di nama juga urut natural (9T sebelum 10T)', () => {
    const hasil = [{ name: 'Gear 10T' }, { name: 'Gear 9T' }].sort(urutNamaSku);
    expect(hasil.map((p) => p.name)).toEqual(['Gear 9T', 'Gear 10T']);
  });

  it('SKU kosong tidak membuat urutan gagal', () => {
    const hasil = [{ name: 'A', sku: 'X-2' }, { name: 'A', sku: null }].sort(urutNamaSku);
    expect(hasil.map((p) => p.sku)).toEqual([null, 'X-2']);
  });
});
