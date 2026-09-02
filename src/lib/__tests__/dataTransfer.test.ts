import { describe, expect, it } from 'vitest';
import { PRODUCT_COLUMNS, buildProductTemplate, parseCsv, toCsv } from '@/lib/dataTransfer';

describe('parseCsv', () => {
  it('membaca baris sederhana', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('menghormati tanda kutip dan koma di dalam nilai', () => {
    // Kasus nyata: nama produk mengandung koma.
    expect(parseCsv('sku,nama\nA1,"Gear Set, Merah"')).toEqual([
      ['sku', 'nama'],
      ['A1', 'Gear Set, Merah'],
    ]);
  });

  it('menangani kutip ganda yang di-escape', () => {
    expect(parseCsv('nama\n"Ban 17"" Ring"')).toEqual([['nama'], ['Ban 17" Ring']]);
  });

  it('menangani baris baru di dalam sel', () => {
    expect(parseCsv('a,b\n"baris1\nbaris2",x')).toEqual([['a', 'b'], ['baris1\nbaris2', 'x']]);
  });

  it('menangani CRLF Windows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('membuang BOM yang ditambahkan Excel', () => {
    // Tanpa ini kolom pertama terbaca "﻿sku" dan validasi menolak berkas.
    expect(parseCsv('﻿sku,nama\nA1,X')[0][0]).toBe('sku');
  });

  it('menerima titik koma sebagai pemisah (Excel lokal Eropa/Indonesia)', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('melewati baris petunjuk sep=; milik Excel', () => {
    // Berkas hasil ekspor kita sendiri diawali baris ini; kalau tidak dilewati,
    // ekspor tidak bisa diimpor ulang.
    const isi = ['sep=;', 'sku;nama', 'A1;X'].join(String.fromCharCode(10));
    expect(parseCsv(isi)).toEqual([['sku', 'nama'], ['A1', 'X']]);
  });

  it('berkas titik koma: koma di dalam nilai TIDAK ikut memotong kolom', () => {
    // Regresi nyata: ekspor kita tidak lagi mengutip koma, jadi kalau parser
    // menerima ',' dan ';' sekaligus, nama produk terpotong saat diimpor ulang.
    const isi = ['sku;nama', 'A1;Gear Depan, Racing'].join(String.fromCharCode(10));
    expect(parseCsv(isi)).toEqual([['sku', 'nama'], ['A1', 'Gear Depan, Racing']]);
  });

  it('berkas koma: titik koma di dalam nilai tetap utuh', () => {
    const isi = ['sku,nama', 'A1,"Ban 17; Ring"'].join(String.fromCharCode(10));
    expect(parseCsv(isi)).toEqual([['sku', 'nama'], ['A1', 'Ban 17; Ring']]);
  });

  it('mengabaikan baris kosong', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('toCsv', () => {
  it('mengutip nilai yang mengandung koma atau kutip', () => {
    // Pemisah kini ';', jadi koma di dalam nilai TIDAK perlu dikutip lagi.
    const baris = toCsv(['a', 'b'], [['x;y', 'dia bilang "hai"']]).split(String.fromCharCode(13, 10));
    expect(baris[0]).toBe('sep=;');
    expect(baris[2]).toBe('"x;y";"dia bilang ""hai"""');
  });

  it('nilai kosong dan null jadi sel kosong', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]]).split(String.fromCharCode(13, 10))[2]).toBe(';');
  });

  it('round-trip menjaga koma di dalam nilai', () => {
    // Client mengekspor, mengedit di Excel, lalu mengimpor lagi.
    const rows = [['A1', 'Gear Depan, Racing']];
    expect(parseCsv(toCsv(['sku', 'nama'], rows))[1]).toEqual(rows[0]);
  });

  it('hasilnya bisa dibaca ulang oleh parseCsv (round-trip)', () => {
    const rows = [['A;1', 'Nama "aneh"', ['baris', 'baru'].join(String.fromCharCode(10))]];
    const parsed = parseCsv(toCsv(['x', 'y', 'z'], rows));
    expect(parsed[1]).toEqual(rows[0]);
  });
});

describe('template produk', () => {
  it('memakai seluruh kolom kontrak, berurutan', () => {
    const header = parseCsv(buildProductTemplate())[0];
    expect(header).toEqual([...PRODUCT_COLUMNS]);
  });

  it('berisi baris contoh yang bisa dihapus client', () => {
    expect(parseCsv(buildProductTemplate()).length).toBeGreaterThan(1);
  });

  it('setiap baris contoh punya jumlah kolom yang sama dengan judul', () => {
    const rows = parseCsv(buildProductTemplate());
    for (const r of rows.slice(1)) expect(r.length).toBe(rows[0].length);
  });

  it('kolom wajib ada di template', () => {
    const header = parseCsv(buildProductTemplate())[0];
    for (const wajib of ['sku', 'nama_produk', 'harga_jual']) {
      expect(header).toContain(wajib);
    }
  });
});
