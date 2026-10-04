// Industry classification + per-industry feature flags + optional seed
// templates. Settings saves stores.industry and can override `features`
// without changing the industry itself.

import {
  Coffee,
  Globe,
  Croissant,
  Scissors,
  Store as StoreIcon,
  type LucideIcon,
} from 'lucide-react';

export type IndustryId = 'online' | 'fnb' | 'retail' | 'bakery' | 'service';

export interface IndustryFeatures {
  /** Show dine-in / take-away toggle on order panel. */
  useOrderType: boolean;
  /** Show table-number input on order panel. */
  useTable: boolean;
  /** Allow product sizes (S/M/L pills). */
  useSizes: boolean;
  /** New products default to track_stock = true. */
  defaultTrackStock: boolean;
  /** Harga jual sudah termasuk pajak: pajak diekstrak, bukan ditambahkan. */
  taxInclusive?: boolean;
  /**
   * Keadaan awal centang pajak di tiap transaksi kasir. Kosong = tercentang,
   * perilaku sebelum centang per transaksi ada.
   */
  taxDefaultOn?: boolean;
}

export interface IndustryDef {
  id: IndustryId;
  label: string;
  /** Short tagline shown on the industry option card. */
  tagline: string;
  /** Longer description shown when selected. */
  description: string;
  Icon: LucideIcon;
  features: IndustryFeatures;
  defaultTaxRate: number;
  /** Sample categories seeded when the user opts in. */
  seedCategories: { name: string; icon: string }[];
  /** Sample products seeded when the user opts in. Category name must match seedCategories. */
  seedProducts: SeedProduct[];
}

export interface SeedProduct {
  name: string;
  category: string;
  base_price: number;
  cost_price?: number;
  image?: string;
  sizes?: { label: string; price_modifier: number }[];
  track_stock?: boolean;
  stock_qty?: number;
  min_stock?: number;
}

const FNB_SIZES = [
  { label: 'S', price_modifier: 0 },
  { label: 'M', price_modifier: 5000 },
  { label: 'L', price_modifier: 10000 },
];

export const INDUSTRIES: IndustryDef[] = [
  {
    id: 'online',
    label: 'Toko Online',
    tagline: 'Jualan lewat marketplace dan toko fisik.',
    description:
      'Untuk toko yang menjual barang lewat Shopee, TikTok Shop, Tokopedia, dan penjualan langsung. Tidak ada Dine In, Take Away, nomor meja, maupun ukuran S/M/L — varian barang dibedakan lewat SKU-nya sendiri.',
    Icon: Globe,
    features: {
      useOrderType: false,
      useTable: false,
      useSizes: false,
      defaultTrackStock: true,
    },
    defaultTaxRate: 0,
    seedCategories: [
      { name: 'Gear & Rantai', icon: 'cookie' },
      { name: 'Pelumas', icon: 'cup-soda' },
      { name: 'Apparel', icon: 'leaf' },
    ],
    seedProducts: [
      { name: 'Gear Set Honda CRF150', category: 'Gear & Rantai', base_price: 1100000, cost_price: 780000, stock_qty: 8, min_stock: 2, track_stock: true },
      { name: 'Gear Belakang Yamaha Fizr', category: 'Gear & Rantai', base_price: 195000, cost_price: 130000, stock_qty: 20, min_stock: 5, track_stock: true },
      { name: 'Rantai 415-130 L', category: 'Gear & Rantai', base_price: 125000, cost_price: 82000, stock_qty: 25, min_stock: 5, track_stock: true },
      { name: 'Oli Rantai 250ml', category: 'Pelumas', base_price: 65000, cost_price: 41000, stock_qty: 30, min_stock: 6, track_stock: true },
      { name: 'Kaos Racing Team', category: 'Apparel', base_price: 165000, cost_price: 95000, stock_qty: 15, min_stock: 3, track_stock: true },
    ],
  },
  {
    id: 'fnb',
    label: 'F&B / Cafe / Restoran',
    tagline: 'Dine-in & take-away, ukuran, modifier.',
    description:
      'Untuk cafe, kedai kopi, restoran. POS aktifkan opsi tipe order (Dine In / Take Away), nomor meja, dan ukuran (S/M/L).',
    Icon: Coffee,
    features: {
      useOrderType: true,
      useTable: true,
      useSizes: true,
      defaultTrackStock: true,
    },
    defaultTaxRate: 10,
    seedCategories: [
      { name: 'Hot Coffee', icon: 'coffee' },
      { name: 'Iced Coffee', icon: 'cup-soda' },
      { name: 'Tea', icon: 'leaf' },
      { name: 'Dessert', icon: 'cookie' },
    ],
    seedProducts: [
      { name: 'Espresso', category: 'Hot Coffee', base_price: 18000, image: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=400', sizes: FNB_SIZES },
      { name: 'Matcha', category: 'Hot Coffee', base_price: 20000, image: 'https://images.unsplash.com/photo-1545239351-cefa43af60f3?w=400', sizes: FNB_SIZES },
      { name: 'Iced Spanish Latte', category: 'Iced Coffee', base_price: 35000, image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=400', sizes: FNB_SIZES },
      { name: 'Chocolate Frappé', category: 'Iced Coffee', base_price: 38000, image: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400', sizes: FNB_SIZES },
      { name: 'Earl Grey', category: 'Tea', base_price: 22000, image: 'https://images.unsplash.com/photo-1597481499750-3e6b22637e12?w=400', sizes: FNB_SIZES },
      { name: 'Peach Green Tea', category: 'Tea', base_price: 28000, image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400', sizes: FNB_SIZES },
      { name: 'Salted Caramel Truffle', category: 'Dessert', base_price: 40000, image: 'https://images.unsplash.com/photo-1606312619070-d48b4c652a52?w=400' },
      { name: 'Macarons', category: 'Dessert', base_price: 32000, image: 'https://images.unsplash.com/photo-1558326567-98ae2405596b?w=400' },
    ],
  },
  {
    id: 'retail',
    label: 'Warung / Retail / Toko',
    tagline: 'Barcode scan, qty cepat, fokus stok.',
    description:
      'Untuk warung, minimarket, toko kelontong. Tanpa dine-in/meja/ukuran. Barcode jadi fokus utama, qty dapat di-input cepat, stok ter-track.',
    Icon: StoreIcon,
    features: {
      useOrderType: false,
      useTable: false,
      useSizes: false,
      defaultTrackStock: true,
    },
    defaultTaxRate: 0,
    seedCategories: [
      { name: 'Minuman', icon: 'cup-soda' },
      { name: 'Makanan Ringan', icon: 'cookie' },
      { name: 'Sembako', icon: 'utensils' },
      { name: 'Air Mineral', icon: 'water' },
    ],
    seedProducts: [
      { name: 'Indomie Goreng', category: 'Sembako', base_price: 3500, cost_price: 2800, stock_qty: 100, min_stock: 20 },
      { name: 'Beras 5kg', category: 'Sembako', base_price: 70000, cost_price: 60000, stock_qty: 20, min_stock: 5 },
      { name: 'Gula Pasir 1kg', category: 'Sembako', base_price: 15000, cost_price: 12000, stock_qty: 30, min_stock: 10 },
      { name: 'Teh Botol Sosro', category: 'Minuman', base_price: 5000, cost_price: 4000, stock_qty: 50, min_stock: 12 },
      { name: 'Kopi Susu Kaleng', category: 'Minuman', base_price: 7000, cost_price: 5500, stock_qty: 40, min_stock: 12 },
      { name: 'Aqua 600ml', category: 'Air Mineral', base_price: 4000, cost_price: 2800, stock_qty: 80, min_stock: 24 },
      { name: 'Aqua Galon 19L', category: 'Air Mineral', base_price: 20000, cost_price: 17000, stock_qty: 15, min_stock: 5 },
      { name: 'Chitato Sapi Panggang', category: 'Makanan Ringan', base_price: 12000, cost_price: 9500, stock_qty: 30, min_stock: 10 },
      { name: 'Oreo Original', category: 'Makanan Ringan', base_price: 9000, cost_price: 7000, stock_qty: 25, min_stock: 8 },
    ],
  },
  {
    id: 'bakery',
    label: 'Bakery / Roti',
    tagline: 'Take-away saja, fokus stok harian.',
    description:
      'Untuk toko roti & pastry. Tanpa dine-in, tanpa meja. Ukuran opsional (boleh untuk varian roti). Stok harian ter-track.',
    Icon: Croissant,
    features: {
      useOrderType: false,
      useTable: false,
      useSizes: false,
      defaultTrackStock: true,
    },
    defaultTaxRate: 0,
    seedCategories: [
      { name: 'Roti', icon: 'donut' },
      { name: 'Pastry', icon: 'cookie' },
      { name: 'Kue', icon: 'cake' },
      { name: 'Minuman', icon: 'cup-soda' },
    ],
    seedProducts: [
      { name: 'Croissant', category: 'Pastry', base_price: 18000, cost_price: 9000, stock_qty: 40, min_stock: 10 },
      { name: 'Pain au Chocolat', category: 'Pastry', base_price: 22000, cost_price: 11000, stock_qty: 30, min_stock: 8 },
      { name: 'Roti Tawar', category: 'Roti', base_price: 25000, cost_price: 14000, stock_qty: 20, min_stock: 5 },
      { name: 'Roti Sobek Cokelat', category: 'Roti', base_price: 28000, cost_price: 15000, stock_qty: 18, min_stock: 5 },
      { name: 'Donat Glazed', category: 'Roti', base_price: 10000, cost_price: 5000, stock_qty: 60, min_stock: 15 },
      { name: 'Brownies Slice', category: 'Kue', base_price: 15000, cost_price: 8000, stock_qty: 25, min_stock: 8 },
      { name: 'Cheese Cake Slice', category: 'Kue', base_price: 28000, cost_price: 15000, stock_qty: 15, min_stock: 5 },
      { name: 'Iced Americano', category: 'Minuman', base_price: 20000, cost_price: 8000, stock_qty: 0, min_stock: 0, track_stock: false },
    ],
  },
  {
    id: 'service',
    label: 'Salon / Jasa / Service',
    tagline: 'Layanan, tanpa stok, tanpa meja.',
    description:
      'Untuk salon, barbershop, laundry, bengkel kecil. Item = layanan (bukan barang). Stok off secara default, tanpa dine-in/meja/ukuran.',
    Icon: Scissors,
    features: {
      useOrderType: false,
      useTable: false,
      useSizes: false,
      defaultTrackStock: false,
    },
    defaultTaxRate: 0,
    seedCategories: [
      { name: 'Potong Rambut', icon: 'utensils' },
      { name: 'Cuci & Styling', icon: 'cup-soda' },
      { name: 'Treatment', icon: 'leaf' },
      { name: 'Produk', icon: 'cookie' },
    ],
    seedProducts: [
      { name: 'Potong Rambut Pria', category: 'Potong Rambut', base_price: 50000, cost_price: 0, track_stock: false },
      { name: 'Potong Rambut Wanita', category: 'Potong Rambut', base_price: 80000, cost_price: 0, track_stock: false },
      { name: 'Cuci Blow', category: 'Cuci & Styling', base_price: 60000, cost_price: 0, track_stock: false },
      { name: 'Catok', category: 'Cuci & Styling', base_price: 50000, cost_price: 0, track_stock: false },
      { name: 'Creambath', category: 'Treatment', base_price: 90000, cost_price: 0, track_stock: false },
      { name: 'Hair Spa', category: 'Treatment', base_price: 120000, cost_price: 0, track_stock: false },
      { name: 'Shampoo Loreal 250ml', category: 'Produk', base_price: 95000, cost_price: 65000, stock_qty: 15, min_stock: 3, track_stock: true },
      { name: 'Hair Tonic 100ml', category: 'Produk', base_price: 70000, cost_price: 45000, stock_qty: 12, min_stock: 3, track_stock: true },
    ],
  },
];

export const DEFAULT_INDUSTRY: IndustryId = 'online';

/**
 * Jenis usaha yang boleh dipilih di Pengaturan.
 *
 * Aplikasi ini dipakai satu toko online sparepart, jadi pilihan F&B, Bakery,
 * dan Jasa hanya menawarkan bentuk kerja yang tidak akan dipakai — dan yang
 * paling sering salah dipilih, karena Dine In dan nomor meja ikut menyala.
 * Nilainya tetap dikenali kode supaya toko lama tidak rusak; hanya pilihannya
 * yang disembunyikan.
 */
export const SELECTABLE_INDUSTRIES: IndustryDef[] = INDUSTRIES.filter(
  (i) => i.id === 'online',
);

export function getIndustry(id: string | null | undefined): IndustryDef {
  return INDUSTRIES.find((i) => i.id === id) ?? INDUSTRIES[0];
}

/** Merge per-store overrides on top of industry defaults. */
export function resolveFeatures(
  industry: string | null | undefined,
  overrides: Partial<IndustryFeatures> | null | undefined,
): IndustryFeatures {
  const base = getIndustry(industry).features;
  return { ...base, ...(overrides ?? {}) };
}
