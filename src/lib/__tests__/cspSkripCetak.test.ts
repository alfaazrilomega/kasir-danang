import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// CSP produksi (deploy/nginx-kasir-csp.conf) melarang skrip inline kecuali yang
// hash-nya terdaftar. Struk, faktur, label, dan laporan shift dicetak lewat
// iframe yang mewarisi CSP halaman, jadi setiap skrip <script> di kode cetak
// harus statis dan hash-nya ada di berkas itu. Kalau tidak, cetak otomatis di
// kasir berhenti tanpa galat yang terlihat.

const akar = process.cwd();
const csp = readFileSync(join(akar, 'deploy/nginx-kasir-csp.conf'), 'utf8');

function berkasSumber(dir: string): string[] {
  return readdirSync(dir).flatMap((nama) => {
    const jalur = join(dir, nama);
    if (statSync(jalur).isDirectory()) return nama === '__tests__' ? [] : berkasSumber(jalur);
    return /\.(ts|tsx|js)$/.test(nama) ? [jalur] : [];
  });
}

// Template literal JavaScript mengubah CRLF menjadi LF, jadi teks saat berjalan selalu LF.
// Kode server ikut dipindai: halaman masuk staf disisipi penanda <script> oleh server/index.js.
const skripInline = [...berkasSumber(join(akar, 'src')), ...berkasSumber(join(akar, 'server'))].flatMap((berkas) =>
  [...readFileSync(berkas, 'utf8').replace(/\r\n/g, '\n').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => ({
    berkas: berkas.slice(akar.length + 1),
    isi: m[1],
  })),
);

describe('CSP dan skrip cetak inline', () => {
  it('menemukan skrip cetak (struk, faktur, label kirim, label barcode, laporan shift) dan penanda halaman masuk staf', () => {
    expect(skripInline.length).toBeGreaterThanOrEqual(6);
    expect(skripInline.some((s) => s.isi === 'window.KASIR_PINTU_ADMIN=true')).toBe(true);
  });

  it.each(skripInline)('skrip di $berkas statis dan hash-nya terdaftar di CSP', ({ isi }) => {
    expect(isi).not.toContain('${');
    const hash = `'sha256-${createHash('sha256').update(isi, 'utf8').digest('base64')}'`;
    expect(csp).toContain(hash);
  });

  it('CSP tidak mengizinkan skrip inline atau eval secara umum', () => {
    const scriptSrc = /script-src ([^;]+);/.exec(csp)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain('report-uri /api/csp-laporan');
  });
});
