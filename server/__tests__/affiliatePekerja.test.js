import { describe, expect, it } from 'vitest';
import { emailKomisiDibayar, emailKomisiMasuk, emailPesananBaru, emailUndangan, emailUndanganAdmin, judulProduk } from '../affiliate/pekerja.js';

const toko = 'GNNK Racing';
const affiliate = { name: 'Andi' };
const order = { order_number: 'WEB-123', buyer_name: 'Budi', items_value: 191000 };

describe('judulProduk', () => {
  it('satu nama, banyak nama, dan kosong', () => {
    expect(judulProduk(['Gear Belakang'])).toBe('Gear Belakang');
    expect(judulProduk(['Gear', 'Rantai', 'Gir Depan'])).toBe('Gear +2 produk lain');
    expect(judulProduk([])).toBe('Produk');
    expect(judulProduk(null)).toBe('Produk');
  });
});

describe('email affiliate memakai judul Sejoli', () => {
  it('order baru: "Order #{invoice} {produk} baru dari {pembeli}"', () => {
    const e = emailPesananBaru({ toko, affiliate, order, produk: ['Gear Belakang'], komisi: 19100, tautan: 'https://x/toko/affiliate?tab=order' });
    expect(e.subject).toBe('Order #WEB-123 Gear Belakang baru dari Budi');
    expect(e.text).toContain('Rp 19.100');
    expect(e.text).toContain('Rp 191.000');
  });

  it('komisi masuk: "{affiliate}, Komisi untuk anda dari order #{invoice} {produk}"', () => {
    const e = emailKomisiMasuk({ toko, affiliate, order, produk: ['Gear', 'Rantai'], komisi: 25000, tautan: 'https://x' });
    expect(e.subject).toBe('Andi, Komisi untuk anda dari order #WEB-123 Gear +1 produk lain');
    expect(e.text).toContain('Rp 25.000');
  });

  it('komisi dibayar: "{affiliate}, Komisi untuk anda sudah dibayarkan"', () => {
    const e = emailKomisiDibayar({
      toko,
      affiliate,
      payout: { amount: 75500, commission_count: 3, paid_at: '2026-10-11T05:00:00Z', note: 'BCA' },
      tautan: 'https://x',
    });
    expect(e.subject).toBe('Andi, Komisi untuk anda sudah dibayarkan');
    expect(e.text).toContain('Rp 75.500 (3 komisi)');
    expect(e.text).toContain('Catatan: BCA');
  });

  it('judul email selalu satu baris walau nama memuat baris baru', () => {
    const jahat = { name: 'Andi\r\nBcc: korban@contoh.id' };
    const a = emailPesananBaru({ toko, affiliate, order: { ...order, buyer_name: 'Budi\nX-Uji: 1' }, produk: ['Gear\tBelakang'], komisi: 1, tautan: 'https://x' });
    const b = emailKomisiMasuk({ toko, affiliate: jahat, order, produk: ['Gear'], komisi: 1, tautan: 'https://x' });
    const c = emailKomisiDibayar({ toko, affiliate: jahat, payout: { amount: 1, commission_count: 1, paid_at: '2026-10-11T05:00:00Z', note: null }, tautan: 'https://x' });
    for (const e of [a, b, c]) expect(e.subject).not.toMatch(/[\r\n\t]/);
    expect(a.subject).toBe('Order #WEB-123 Gear Belakang baru dari Budi X-Uji: 1');
    expect(c.subject).toBe('Andi Bcc: korban@contoh.id, Komisi untuk anda sudah dibayarkan');
  });

  it('email undangan: judul satu baris, pesan di-escape, tautan dari alamat toko', () => {
    const e = emailUndangan({
      toko,
      affiliate: { name: 'Andi\r\nBcc: x@contoh.id' },
      nama: 'Budi <b>',
      pesan: 'Toko langgananku <script>alert(1)</script>',
      tautan: 'https://store.gnnkracing.id/aff/undangan/tok123',
      hari: 7,
    });
    expect(e.subject).toBe('Andi Bcc: x@contoh.id mengundang kamu ke GNNK Racing');
    expect(e.text).toContain('Terima undangan: https://store.gnnkracing.id/aff/undangan/tok123');
    expect(e.text).toContain('Tautan ini berlaku 7 hari.');
    expect(e.html).toContain('href="https://store.gnnkracing.id/aff/undangan/tok123"');
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('Halo Budi &lt;b&gt;,');
    const tanpa = emailUndangan({ toko, affiliate, nama: null, pesan: null, tautan: 'https://x/aff/undangan/t', hari: 1 });
    expect(tanpa.text.startsWith('Halo,')).toBe(true);
    expect(tanpa.html).not.toContain('blockquote');
  });

  it('nama dari pengguna di-escape di HTML', () => {
    const e = emailPesananBaru({
      toko,
      affiliate: { name: '<img src=x onerror=alert(1)>' },
      order: { ...order, buyer_name: '"Budi"&' },
      produk: ['<b>Gear</b>'],
      komisi: 1,
      tautan: 'https://x',
    });
    expect(e.html).not.toContain('<img src=x');
    expect(e.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(e.html).toContain('&quot;Budi&quot;&amp;');
    expect(e.html).toContain('&lt;b&gt;Gear&lt;/b&gt;');
  });
});

describe('email jawaban klien (spesifikasi 0002)', () => {
  it('komisi dibayar menyebut rincian bila ada bonus atau potongan (D-40)', () => {
    const polos = emailKomisiDibayar({ toko, affiliate, payout: { amount: 75500, commission_count: 3, paid_at: '2026-10-11T05:00:00Z', note: null, commission_total: 75500, bonus_total: 0, deduction_total: 0 }, tautan: 'https://x' });
    expect(polos.text).not.toContain('Rincian');
    const rinci = emailKomisiDibayar({ toko, affiliate, payout: { amount: 186000, commission_count: 2, paid_at: '2026-10-11T05:00:00Z', note: null, commission_total: 191000, bonus_total: 104000, deduction_total: 109000 }, tautan: 'https://x' });
    expect(rinci.text).toContain('Rincian: komisi Rp 191.000 + bonus target Rp 104.000 - potongan retur dan pembatalan Rp 109.000');
    expect(rinci.html).toContain('potongan retur dan pembatalan Rp 109.000');
  });

  it('undangan khusus admin menyebut tarif dan meminta mendaftar dengan email yang sama (D-32)', () => {
    const e = emailUndanganAdmin({ toko, nama: 'Budi', pesan: null, tautan: 'https://toko/aff/undangan/abc', hari: 7, tarif: [{ type: 'percentage', value: 15 }] });
    expect(e.subject).toBe('GNNK Racing mengundang kamu menjadi affiliate');
    expect(e.text).toContain('Komisi kamu: 15% dari nilai barang.');
    expect(e.text).toContain('Daftar sebagai affiliate: https://toko/aff/undangan/abc');
    expect(e.text).toContain('Daftar dengan alamat email ini');
    const tetap = emailUndanganAdmin({ toko, nama: null, pesan: '<b>hai</b>', tautan: 'https://t', hari: 7, tarif: [{ type: 'fixed', value: 5000 }] });
    expect(tetap.text).toContain('Komisi kamu: Rp 5.000 per barang.');
    expect(tetap.html).toContain('&lt;b&gt;hai&lt;/b&gt;');
  });
});
