import { describe, expect, it } from 'vitest';
import { buildCsv, date, dateTime, int, label, num, text, yesNo } from '@/lib/csvFormat';

const NL = String.fromCharCode(13, 10);

describe('buildCsv', () => {
  it('menulis baris petunjuk sep=; supaya Excel memisah kolom', () => {
    // Ini inti perbaikannya: tanpa baris ini, Excel Indonesia menumpuk
    // seluruh isi berkas ke satu kolom.
    expect(buildCsv(['a'], [['x']]).split(NL)[0]).toBe('sep=;');
  });

  it('memakai titik koma sebagai pemisah', () => {
    expect(buildCsv(['a', 'b'], [['1', '2']]).split(NL)[2]).toBe('1;2');
  });

  it('koma di dalam nilai tidak perlu dikutip', () => {
    expect(buildCsv(['a'], [['Gear Depan, Racing']]).split(NL)[2]).toBe('Gear Depan, Racing');
  });

  it('mengutip nilai yang mengandung titik koma, kutip, atau baris baru', () => {
    expect(buildCsv(['a'], [['x;y']]).split(NL)[2]).toBe('"x;y"');
    expect(buildCsv(['a'], [['dia "bilang"']]).split(NL)[2]).toBe('"dia ""bilang"""');
  });

  it('memakai akhir baris CRLF yang dipahami Excel', () => {
    expect(buildCsv(['a'], [['1']]).includes(NL)).toBe(true);
  });
});

describe('angka', () => {
  it('bilangan bulat ditulis polos supaya tetap bisa dihitung Excel', () => {
    // Pemisah ribuan sengaja tidak dipakai: "8.000" membuat Excel
    // memperlakukannya sebagai teks.
    expect(int(8000)).toBe('8000');
    expect(num(8000)).toBe('8000');
  });

  it('desimal memakai koma sesuai lokal Indonesia', () => {
    expect(num(62.5, 1)).toBe('62,5');
    expect(num(1234.56)).toBe('1234,56');
  });

  it('nilai kosong jadi 0, bukan sel kosong yang menyesatkan', () => {
    expect(int(null)).toBe('0');
    expect(int(undefined)).toBe('0');
  });

  it('membulatkan untuk int', () => {
    expect(int(12.7)).toBe('13');
  });

  it('nilai bukan angka tidak merusak berkas', () => {
    expect(num('abc')).toBe('');
  });
});

describe('tanggal', () => {
  it('dd/mm/yyyy dikenali Excel Indonesia sebagai tanggal', () => {
    expect(date(new Date(2026, 7, 29))).toBe('29/08/2026');
  });

  it('menyertakan jam bila diminta', () => {
    expect(dateTime(new Date(2026, 7, 29, 9, 5))).toBe('29/08/2026 09:05');
  });

  it('nilai kosong atau tidak valid jadi sel kosong', () => {
    expect(date(null)).toBe('');
    expect(date('bukan tanggal')).toBe('');
  });
});

describe('label & teks', () => {
  it('menerjemahkan nilai teknis ke label manusia', () => {
    expect(label('stockMovement', 'sale')).toBe('Penjualan');
    expect(label('paymentStatus', 'paid')).toBe('Lunas');
    expect(label('orderStatus', 'done')).toBe('Selesai');
    expect(label('purchaseStatus', 'received')).toBe('Diterima');
  });

  it('nilai tak dikenal dikembalikan apa adanya, bukan dikosongkan', () => {
    // Kalau dikosongkan, data jenis baru hilang diam-diam dari laporan.
    expect(label('stockMovement', 'jenis_baru')).toBe('jenis_baru');
  });

  it('ya/tidak, bukan true/false', () => {
    expect(yesNo(true)).toBe('Ya');
    expect(yesNo(false)).toBe('Tidak');
  });

  it('nilai kosong jadi sel kosong, bukan tanda hubung', () => {
    expect(text(null)).toBe('');
    expect(text('  ')).toBe('');
  });
});
