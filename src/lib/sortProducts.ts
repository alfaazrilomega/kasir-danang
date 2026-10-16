// Aturan urut produk yang sama di semua daftar (kasir, pencari, katalog).
//
// Banyak produk client bernama persis sama dan hanya dibedakan SKU, misalnya
// 16 "Gear Belakang Yamaha Fiz R ..." dengan SKU Gb-415-30F s/d 47F. Karena itu
// urutannya nama dulu, lalu SKU, dengan angka dibaca sebagai angka (12 < 13 <
// 100), bukan huruf per huruf.
const opsi: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

export function urutNamaSku(
  a: { name: string; sku?: string | null },
  b: { name: string; sku?: string | null },
): number {
  return (
    a.name.localeCompare(b.name, 'id', opsi) || (a.sku ?? '').localeCompare(b.sku ?? '', 'id', opsi)
  );
}
