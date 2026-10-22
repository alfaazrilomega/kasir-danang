import { describe, expect, it } from 'vitest';
import { fotoLewatToko, fotoPembeli, gantiFotoDalam } from '../fotoToko.js';

const WP = 'https://gnnkracing.id/wp-content/uploads/2025/12/GEAR-SET-CRF-150-RED.jpg';

describe('Foto WordPress lewat server toko', () => {
  it('alamat foto WordPress menjadi salinan /foto/wp', () => {
    expect(fotoLewatToko(WP)).toBe('/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg');
    expect(fotoLewatToko('https://gnnkracing.id/wp-content/uploads/2024/01/a_b(1).PNG')).toBe('/foto/wp/2024/01/a_b(1).PNG');
  });

  it('alamat lain, berkas bukan gambar, dan jalur aneh tidak diubah', () => {
    for (const u of [
      'https://down-id.img.susercontent.com/file/id-11134207.webp',
      'https://gnnkracing.id/wp-content/uploads/2025/12/dokumen.pdf',
      'https://gnnkracing.id/wp-content/uploads/2025/12/../../wp-config.php',
      'https://gnnkracing.id/wp-content/uploads/2025/12/nama spasi.jpg',
      'https://gnnkracing.id/wp-content/uploads/foto.jpg',
      'http://gnnkracing.id/wp-content/uploads/2025/12/a.jpg',
      `<img src="${WP}">`,
      'data:image/jpeg;base64,AAAA',
    ]) expect(fotoLewatToko(u)).toBe(u);
    expect(fotoLewatToko(null)).toBe(null);
    expect(fotoLewatToko(12)).toBe(12);
  });

  it('mengganti di seluruh isi JSON tanpa mengubah nilai lain', () => {
    const tanggal = new Date('2026-10-19T00:00:00Z');
    const hasil = gantiFotoDalam({
      store: { pdp_banner_url: WP, name: 'GNNK' },
      products: [{ image_url: WP, images: [WP, 'https://down-id.img.susercontent.com/a.webp'], base_price: 655000, aktif: true, kosong: null }],
      dibuat: tanggal,
    });
    expect(hasil.store).toEqual({ pdp_banner_url: '/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg', name: 'GNNK' });
    expect(hasil.products[0]).toEqual({
      image_url: '/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg',
      images: ['/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg', 'https://down-id.img.susercontent.com/a.webp'],
      base_price: 655000,
      aktif: true,
      kosong: null,
    });
    expect(hasil.dibuat).toBe(tanggal);
  });

  it('Buffer dan kunci "__proto__" tidak dirusak', () => {
    const buf = Buffer.from('abc');
    expect(gantiFotoDalam({ isi: buf }).isi).toBe(buf);
    const asal = JSON.parse(`{"__proto__": {"x": 1}, "foto": "${WP}"}`);
    const hasil = gantiFotoDalam(asal);
    expect(Object.keys(hasil)).toEqual(['__proto__', 'foto']);
    expect(JSON.stringify(hasil)).toBe('{"__proto__":{"x":1},"foto":"/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg"}');
    expect({}.x).toBeUndefined();
  });

  it('middleware hanya berlaku untuk jalur pembeli', () => {
    const jalankan = (path) => {
      let dikirim;
      const res = { json: (b) => { dikirim = b; return res; } };
      fotoPembeli({ path }, res, () => {});
      res.json({ image_url: WP });
      return dikirim.image_url;
    };
    expect(jalankan('/api/public/catalog')).toBe('/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg');
    expect(jalankan('/api/customer/reviewable')).toBe('/foto/wp/2025/12/GEAR-SET-CRF-150-RED.jpg');
    expect(jalankan('/api/query')).toBe(WP);
    expect(jalankan('/api/public-palsu')).toBe(WP);
  });
});
