// Kumpulan ikon kategori, dipakai bersama oleh Menu (kasir), Products, dan
// pengelola kategori supaya pilihannya sama di semua layar.
//
// Daftar ini dulu hanya berisi ikon makanan dan minuman, padahal aplikasinya
// dipakai juga oleh toko sparepart: kategori client memakai kunci seperti
// `boxes` dan `circle-dot` yang tidak ada di daftar, sehingga SEMUA kategori
// jatuh ke ikon cadangan berupa cangkir kopi. Sekarang daftarnya mencakup
// barang umum dan otomotif, dan cadangannya ikon kotak yang netral.

import {
  Battery,
  Bike,
  Box,
  Boxes,
  Cake,
  Circle,
  CircleDot,
  Coffee,
  Cog,
  Cookie,
  CupSoda,
  Disc3,
  Donut,
  Droplet,
  GlassWater,
  Grid2x2,
  IceCream,
  Leaf,
  Lightbulb,
  Link2,
  Pizza,
  Sandwich,
  Shirt,
  Soup,
  Sparkles,
  Tag,
  Utensils,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  // Umum
  { key: 'boxes', label: 'Kotak', Icon: Boxes },
  { key: 'box', label: 'Paket', Icon: Box },
  { key: 'tag', label: 'Label', Icon: Tag },
  { key: 'grid', label: 'Kisi', Icon: Grid2x2 },
  { key: 'sparkles', label: 'Baru', Icon: Sparkles },
  // Otomotif / bengkel
  { key: 'circle-dot', label: 'Gear', Icon: CircleDot },
  { key: 'circle', label: 'Lingkaran', Icon: Circle },
  { key: 'disc', label: 'Cakram', Icon: Disc3 },
  { key: 'chain', label: 'Rantai', Icon: Link2 },
  { key: 'wrench', label: 'Kunci', Icon: Wrench },
  { key: 'cog', label: 'Mesin', Icon: Cog },
  { key: 'bike', label: 'Motor', Icon: Bike },
  { key: 'oil', label: 'Oli', Icon: Droplet },
  { key: 'battery', label: 'Aki', Icon: Battery },
  { key: 'lamp', label: 'Lampu', Icon: Lightbulb },
  { key: 'electric', label: 'Kelistrikan', Icon: Zap },
  { key: 'apparel', label: 'Apparel', Icon: Shirt },
  // Makanan & minuman (toko lain yang memakai aplikasi ini)
  { key: 'coffee', label: 'Kopi', Icon: Coffee },
  { key: 'cup-soda', label: 'Minuman', Icon: CupSoda },
  { key: 'leaf', label: 'Teh', Icon: Leaf },
  { key: 'cookie', label: 'Kue Kering', Icon: Cookie },
  { key: 'donut', label: 'Donat', Icon: Donut },
  { key: 'cake', label: 'Kue', Icon: Cake },
  { key: 'water', label: 'Air', Icon: GlassWater },
  { key: 'ice-cream', label: 'Es Krim', Icon: IceCream },
  { key: 'pizza', label: 'Pizza', Icon: Pizza },
  { key: 'sandwich', label: 'Roti Isi', Icon: Sandwich },
  { key: 'soup', label: 'Sup', Icon: Soup },
  { key: 'utensils', label: 'Makanan', Icon: Utensils },
];

export const categoryIconMap: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICONS.map((c) => [c.key, c.Icon]),
);

/** Kategori tanpa ikon (atau ikon lama yang sudah tidak dikenal) memakai kotak, bukan cangkir kopi. */
export function getCategoryIcon(key: string | null | undefined): LucideIcon {
  return (key && categoryIconMap[key]) || Boxes;
}
