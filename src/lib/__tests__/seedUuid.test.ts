import { describe, expect, it } from 'vitest';
import { isUuid } from '@/lib/format';
import { __seedUuid as seedUuid } from '@/lib/seed1000';

describe('seedUuid', () => {
  it('menghasilkan UUID yang sah', () => {
    expect(isUuid(seedUuid('cat-1'))).toBe(true);
    expect(isUuid(seedUuid('shift-030'))).toBe(true);
    expect(isUuid(seedUuid('po-001'))).toBe(true);
  });

  it('deterministik: kunci sama selalu menghasilkan id sama', () => {
    // Ini yang membuat seed dijalankan dua kali menimpa baris, bukan menggandakan.
    expect(seedUuid('prod-7')).toBe(seedUuid('prod-7'));
  });

  it('kunci berbeda menghasilkan id berbeda', () => {
    expect(seedUuid('prod-1')).not.toBe(seedUuid('prod-2'));
  });

  it('tidak bertabrakan pada volume sebesar data demo', () => {
    // Seed membuat ribuan baris; tabrakan berarti satu baris menimpa baris lain.
    const ids = new Set<string>();
    const prefixes = ['cat', 'prod', 'sup', 'cust', 'po', 'poi', 'popay', 'ord', 'oi', 'shift', 'exp'];
    let total = 0;
    for (const p of prefixes) {
      for (let i = 0; i < 1200; i++) {
        ids.add(seedUuid(`${p}-${i}`));
        total++;
      }
    }
    expect(ids.size).toBe(total);
  });

  it('varian & versi UUID berada di posisi yang benar', () => {
    const id = seedUuid('cek-format');
    expect(id[14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });
});
