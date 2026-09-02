import { describe, expect, it } from 'vitest';
import { convertCurrency, errorMessage, isUuid, nextOrderNumber } from '@/lib/format';

describe('isUuid', () => {
  it('menerima UUID yang sah', () => {
    expect(isUuid('fff01e2c-4033-492d-a60d-de58c4e07117')).toBe(true);
  });

  it('menolak id buatan data demo', () => {
    // Justru kasus inilah yang dulu membuat baris gagal tersimpan diam-diam.
    expect(isUuid('shift-030')).toBe(false);
    expect(isUuid('usr-admin-001')).toBe(false);
    expect(isUuid('store-default-001')).toBe(false);
  });

  it('menolak null/undefined/kosong', () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('mengambil pesan dari Error', () => {
    expect(errorMessage(new Error('gagal konek'), 'fallback')).toBe('gagal konek');
  });

  it('mengambil pesan dari objek error API yang bukan Error', () => {
    // api.from(...) mengembalikan objek biasa; ini sebab pesan asli dulu hilang.
    expect(errorMessage({ message: 'Data duplikat', status: 409 }, 'fallback')).toBe(
      'Data duplikat',
    );
  });

  it('memakai fallback untuk bentuk yang tidak dikenal', () => {
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage({ message: '' }, 'fallback')).toBe('fallback');
    expect(errorMessage('teks biasa', 'fallback')).toBe('fallback');
  });
});

describe('nextOrderNumber', () => {
  it('memakai format #ID-NamaToko-Platform', () => {
    const n = nextOrderNumber({ storeName: 'Toko Danang', platform: 'Shopee' });
    expect(n).toMatch(/^#\d{6}-\d{6}-TokoDanang-Shopee$/);
  });

  it('membuang karakter non-alfanumerik dari nama toko', () => {
    expect(nextOrderNumber({ storeName: 'GNNK Racing!', platform: 'TikTok' })).toContain(
      '-GNNKRacing-TikTok',
    );
  });

  it('punya default saat nama toko / platform kosong', () => {
    expect(nextOrderNumber()).toContain('-Toko-Offline');
  });

  it('menghormati id yang diberikan', () => {
    expect(nextOrderNumber({ id: 'INV-9', storeName: 'A', platform: 'B' })).toBe('#INV-9-A-B');
  });
});

describe('convertCurrency', () => {
  it('mengalikan dengan kurs', () => {
    expect(convertCurrency(10, 16000)).toBe(160000);
  });

  it('kurs nol atau negatif diperlakukan sebagai 1', () => {
    expect(convertCurrency(10, 0)).toBe(10);
    expect(convertCurrency(10, -5)).toBe(10);
  });
});
