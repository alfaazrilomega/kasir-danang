import { describe, expect, it } from 'vitest';
import { idPixelDariToko } from '@/lib/pixelToko';

// Butir 15 PERMINTAAN-CLIENT.md. ID pixel dari database ditempel ke URL skrip
// pihak ketiga, jadi nilai yang bentuknya tidak dikenal harus dianggap kosong,
// termasuk nilai lama yang sudah tersimpan sebelum penjaga server ada.

describe('idPixelDariToko', () => {
  it('ID yang sah diteruskan apa adanya', () => {
    expect(
      idPixelDariToko({
        meta_pixel_id: '1234567890123456',
        tiktok_pixel_id: 'C4A1B2C3D4E5F6G7H8I9',
        google_ads_id: 'AW-123456789',
        google_ads_purchase_label: 'AbC-D_efG-h12_34-567',
      }),
    ).toEqual({
      meta: '1234567890123456',
      tiktok: 'C4A1B2C3D4E5F6G7H8I9',
      googleAds: 'AW-123456789',
      googleAdsLabel: 'AbC-D_efG-h12_34-567',
    });
  });

  it('nilai tersimpan yang bentuknya tidak dikenal dianggap kosong, tidak dipasang', () => {
    const ids = idPixelDariToko({
      meta_pixel_id: '1234567890"></script><script>alert(1)</script>',
      tiktok_pixel_id: 'C4A1B2C3D4E5F6G7H8I9&lib=x',
      google_ads_id: 'AW-123456789/../evil.js',
      google_ads_purchase_label: 'label dengan spasi',
    });
    expect(ids).toEqual({ meta: null, tiktok: null, googleAds: null, googleAdsLabel: null });
  });

  it('toko tanpa data pixel menghasilkan semua kosong', () => {
    expect(idPixelDariToko(null)).toEqual({ meta: null, tiktok: null, googleAds: null, googleAdsLabel: null });
    expect(idPixelDariToko({ meta_pixel_id: '   ' }).meta).toBeNull();
  });
});
