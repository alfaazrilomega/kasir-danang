import { describe, expect, it } from 'vitest';
import { describePgError, isConnectionError } from '../pgErrors.js';

describe('isConnectionError', () => {
  it('mengenali kegagalan soket', () => {
    expect(isConnectionError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isConnectionError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('mengenali SQLSTATE koneksi & autentikasi', () => {
    expect(isConnectionError({ code: '08006' })).toBe(true);
    expect(isConnectionError({ code: '28P01' })).toBe(true);
    expect(isConnectionError({ code: '3D000' })).toBe(true);
    expect(isConnectionError({ code: '57P01' })).toBe(true);
  });

  it('TIDAK menganggap kesalahan data sebagai masalah koneksi', () => {
    expect(isConnectionError({ code: '23505' })).toBe(false);
    expect(isConnectionError({ code: '22P02' })).toBe(false);
  });
});

describe('describePgError', () => {
  it('mengembalikan null untuk error koneksi supaya boleh fallback offline', () => {
    expect(describePgError({ code: 'ECONNREFUSED' })).toBeNull();
    expect(describePgError({ code: '28P01' })).toBeNull();
    expect(describePgError(null)).toBeNull();
  });

  it('unique violation -> 409', () => {
    expect(describePgError({ code: '23505' })).toMatchObject({ status: 409 });
  });

  it('foreign key violation -> 409', () => {
    // Ini yang dulu ditelan: item opname menunjuk produk yang tak ada di server.
    expect(describePgError({ code: '23503' })).toMatchObject({ status: 409 });
  });

  it('not null / check violation -> 400', () => {
    expect(describePgError({ code: '23502' })).toMatchObject({ status: 400 });
    expect(describePgError({ code: '23514' })).toMatchObject({ status: 400 });
  });

  it('uuid tidak valid -> 400', () => {
    expect(describePgError({ code: '22P02' })).toMatchObject({ status: 400 });
  });

  it('kolom/tabel tidak ada -> 500 karena itu bug server', () => {
    expect(describePgError({ code: '42703' })).toMatchObject({ status: 500 });
    expect(describePgError({ code: '42P01' })).toMatchObject({ status: 500 });
  });

  it('kelas 23xxx lain tetap dianggap pelanggaran integritas', () => {
    expect(describePgError({ code: '23001' })).toMatchObject({ status: 409 });
  });
});
