// Spec 0003: gambar banner beranda dilayani dari data URL yang disimpan admin.
import { describe, expect, it } from 'vitest';
import { bacaGambarBanner, bannerPublik, SYARAT_BANNER_BERLAKU } from '../bannerToko.js';

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`;

describe('Banner toko', () => {
  it('membaca data URL JPEG, PNG, dan WebP menjadi biner dengan tipe yang benar', () => {
    const hasil = bacaGambarBanner(jpeg);
    expect(hasil.mime).toBe('image/jpeg');
    expect([...hasil.isi.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bacaGambarBanner(jpeg.replace('image/jpeg', 'image/png')).mime).toBe('image/png');
    expect(bacaGambarBanner(jpeg.replace('image/jpeg', 'image/webp')).mime).toBe('image/webp');
  });

  it('menolak tipe yang bisa menjalankan isi (SVG, HTML), teks biasa, dan data kosong', () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    expect(bacaGambarBanner(svg)).toBeNull();
    expect(bacaGambarBanner(`data:text/html;base64,${Buffer.from('<script>').toString('base64')}`)).toBeNull();
    expect(bacaGambarBanner('https://contoh.id/a.jpg')).toBeNull();
    expect(bacaGambarBanner('data:image/jpeg;base64,')).toBeNull();
    expect(bacaGambarBanner(null)).toBeNull();
  });

  it('baris publik tidak membawa isi gambar dan memberi versi dari waktu ubah', () => {
    const r = bannerPublik({ id: 'b1', title: '', link_url: '/toko?flash=1', versi: '0123456789ab', ada_hp: true, image_data: jpeg });
    expect(r).toEqual({ id: 'b1', title: null, link_url: '/toko?flash=1', v: '0123456789ab', ada_hp: true });
    expect(JSON.stringify(r)).not.toContain('base64');
  });

  it('syarat berlaku memeriksa aktif, jadwal mulai, dan jadwal selesai', () => {
    expect(SYARAT_BANNER_BERLAKU).toMatch(/is_active = true/);
    expect(SYARAT_BANNER_BERLAKU).toMatch(/starts_at is null or starts_at <= now\(\)/);
    expect(SYARAT_BANNER_BERLAKU).toMatch(/ends_at is null or ends_at > now\(\)/);
  });
});
