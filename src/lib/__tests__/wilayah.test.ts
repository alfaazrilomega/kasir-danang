import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alamatLengkap, kecamatanDari, PROVINSI } from '../wilayah';

afterEach(() => vi.unstubAllGlobals());

describe('Alamat bertingkat', () => {
  it('menyusun detail rumah dan semua tingkatan wilayah, serta mendukung alamat lama', () => {
    expect(alamatLengkap({ alamat: ' RT 03/RW 05, pagar hijau ', kelurahan: 'Sidokumpul', kecamatan: 'Sidoarjo', kota: 'Kabupaten Sidoarjo', provinsi: 'Jawa Timur' }))
      .toBe('RT 03/RW 05, pagar hijau, Sidokumpul, Kec. Sidoarjo, Kabupaten Sidoarjo, Jawa Timur');
    expect(alamatLengkap({ alamat: 'Jl. Lama 1', kota: 'Kota Surabaya', provinsi: 'Jawa Timur' }))
      .toBe('Jl. Lama 1, Kota Surabaya, Jawa Timur');
  });

  it('semua kota memiliki data kecamatan/desa dengan induk dan kode yang konsisten', () => {
    const ids = new Set<string>();
    let districts = 0;
    let villages = 0;
    for (const province of PROVINSI) {
      for (const city of province.kota) {
        const rows = JSON.parse(fs.readFileSync(path.resolve('public/wilayah', `${city.kode}.json`), 'utf8'));
        expect(rows.length).toBeGreaterThan(0);
        for (const district of rows) {
          expect(district.kode.startsWith(`${city.kode}.`)).toBe(true);
          expect(ids.has(district.kode)).toBe(false);
          ids.add(district.kode);
          expect(district.desa.length).toBeGreaterThan(0);
          districts++;
          for (const village of district.desa) {
            expect(village.kode.startsWith(`${district.kode}.`)).toBe(true);
            expect(village.nama.trim()).not.toBe('');
            expect(ids.has(village.kode)).toBe(false);
            ids.add(village.kode);
            villages++;
          }
        }
      }
    }
    expect(districts).toBe(7285);
    expect(villages).toBe(83762);
  });

  it('tidak memuat data untuk pasangan provinsi/kota yang salah', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await kecamatanDari('Banten', 'Kota Surabaya')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('permintaan gagal dapat dicoba ulang, dan data berhasil dipakai kembali', async () => {
    const data = [{ kode: '35.15.01', nama: 'Sidoarjo', desa: [{ kode: '35.15.01.1001', nama: 'Sidokumpul' }] }];
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(kecamatanDari('Jawa Timur', 'Kabupaten Sidoarjo')).rejects.toThrow('Gagal memuat');
    expect(await kecamatanDari('Jawa Timur', 'Kabupaten Sidoarjo')).toEqual(data);
    expect(await kecamatanDari('Jawa Timur', 'Kabupaten Sidoarjo')).toEqual(data);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
