import { db } from './db';
import { getBackendClient } from './api';
import { isUuid } from './format';
import type {
  Category,
  Customer,
  Order,
  OrderItem,
  OrderPayment,
  Product,
  ProductChannelMapping,
  Promo,
  Purchase,
  PurchaseItem,
  PurchasePayment,
  SalesChannel,
  Shift,
  StockMovement,
  Store,
  Supplier,
  SupplierProductMapping,
  CashMovement,
  Expense,
  ExpenseCategory,
  LoyaltyTransaction,
} from '@/types';

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randId(): string {
  return crypto.randomUUID();
}

/**
 * UUID deterministik dari sebuah kunci teks.
 *
 * Data demo dulu memakai id yang enak dibaca ('cat-1', 'shift-030', 'po-001').
 * Kolom-kolom itu bertipe uuid di Postgres, jadi SETIAP baris seed ditolak
 * dengan 22P02 — dan karena error database dulu ditelan, kegagalannya tidak
 * pernah terlihat: data demo hanya hidup di IndexedDB dan tidak pernah bisa
 * dipakai menguji apa pun yang menyentuh server.
 *
 * Fungsi ini tetap deterministik (seed dijalankan dua kali menimpa baris yang
 * sama, bukan menggandakannya) tetapi menghasilkan UUID yang sah.
 */
export function seedUuid(key: string): string {
  let h1 = 0x9e3779b9;
  let h2 = 0x85ebca6b;
  let h3 = 0xc2b2ae35;
  let h4 = 0x27d4eb2f;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ (c + i), 1597334677);
    h3 = Math.imul(h3 ^ (c + i * 7), 2246822519);
    h4 = Math.imul(h4 ^ (c + i * 13), 3266489917);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const raw = hex(h1) + hex(h2) + hex(h3) + hex(h4);
  const variant = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `4${raw.slice(13, 16)}`,
    `${variant}${raw.slice(17, 20)}`,
    raw.slice(20, 32),
  ].join('-');
}

function pad(num: number, size = 2): string {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

function formatIso(d: Date): string {
  return d.toISOString();
}

/**
 * Nomor pesanan versi platform, meniru format asli supaya pencarian &
 * rekonsiliasi bisa dicoba dengan data demo.
 * Shopee: alfanumerik (cth. 2608113TQ8HWAB). TikTok: numerik panjang.
 */
function fakePlatformOrderNo(channelCode: string): string {
  const digits = '0123456789';
  const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const pick = (src: string, n: number) =>
    Array.from({ length: n }, () => src[Math.floor(Math.random() * src.length)]).join('');
  if (channelCode === 'tiktok') return pick(digits, 18);
  if (channelCode === 'shopee') return `${pick(digits, 7)}${pick(alnum, 7)}`;
  return `${channelCode.toUpperCase().slice(0, 3)}-${pick(digits, 10)}`;
}

export async function generate1000Data(
  targetStoreId = 'store-default-001',
  /** Id profil yang sedang login; dipakai untuk cashier_id/created_by. */
  actorId?: string | null,
) {
  // Hanya UUID asli yang boleh dipakai: 'usr-admin-001' dkk tidak ada di
  // tabel profiles sehingga melanggar foreign key.
  const actor = isUuid(actorId) ? (actorId as string) : null;
  const now = new Date();

  // 1. STORE
  const store: Store = {
    id: targetStoreId,
    name: 'TokoKu',
    address: 'Jl. Raya Industri No. 45, Sidoarjo, Jawa Timur',
    currency: 'IDR',
    tax_rate: 0,
    low_stock_threshold: 10,
    points_per_amount: 0.01,
    receipt_header: 'GNNK RACING\nSparepart & Gear Set Motor\nTelp: 0812-3456-7890',
    receipt_footer: 'Terima kasih sudah berbelanja.\nKlaim garansi maksimal 3 hari setelah barang diterima.',
    industry: 'online',
    features: {
      useOrderType: false,
      useTable: false,
      useSizes: false,
      defaultTrackStock: true,
    },
    created_at: new Date(now.getTime() - 60 * 86400000).toISOString(),
  };

  // 2. SALES CHANNELS
  const channels: SalesChannel[] = [
    { id: seedUuid('channel-offline'), store_id: targetStoreId, code: 'offline', name: 'Toko Offline / POS', fee_percent: 0, default_term_days: 0, sort_order: 1, is_active: true, created_at: formatIso(now) },
    { id: seedUuid('channel-tiktok'), store_id: targetStoreId, code: 'tiktok', name: 'TikTok Shop', fee_percent: 4.5, default_term_days: 14, sort_order: 2, is_active: true, created_at: formatIso(now) },
    { id: seedUuid('channel-shopee'), store_id: targetStoreId, code: 'shopee', name: 'Shopee Official', fee_percent: 5.0, default_term_days: 14, sort_order: 3, is_active: true, created_at: formatIso(now) },
    { id: seedUuid('channel-tokopedia'), store_id: targetStoreId, code: 'tokopedia', name: 'Tokopedia Store', fee_percent: 4.0, default_term_days: 14, sort_order: 4, is_active: true, created_at: formatIso(now) },
    { id: seedUuid('channel-website'), store_id: targetStoreId, code: 'website', name: 'Website Resmi', fee_percent: 1.5, default_term_days: 7, sort_order: 5, is_active: true, created_at: formatIso(now) },
    { id: seedUuid('channel-whatsapp'), store_id: targetStoreId, code: 'whatsapp', name: 'WhatsApp Direct Order', fee_percent: 0, default_term_days: 0, sort_order: 6, is_active: true, created_at: formatIso(now) },
  ];

  // 3. CATEGORIES
  const categoryDefs = [
    { name: 'Gear Set Lengkap', icon: 'boxes' },
    { name: 'Gear Belakang', icon: 'circle-dot' },
    { name: 'Gear Depan', icon: 'circle' },
    { name: 'Rantai / Chain', icon: 'link' },
    { name: 'Baut & Kelengkapan', icon: 'wrench' },
    { name: 'Oli & Pelumas Rantai', icon: 'droplet' },
    { name: 'Bahan Baku & Material', icon: 'package' },
    { name: 'Merchandise & Apparel', icon: 'tag' },
  ];

  const categories: Category[] = categoryDefs.map((c, idx) => ({
    id: seedUuid(`cat-${idx + 1}`),
    store_id: targetStoreId,
    name: c.name,
    icon: c.icon,
    sort_order: idx + 1,
  }));

  // 4. PRODUCTS
  //
  // Enam produk pertama BUKAN karangan: SKU, nama, harga jual, dan beratnya
  // disalin apa adanya dari berkas ekspor milik client
  // (tiktok-2026-09-03-11_32.xlsx dan shopee-20260804_20260903.xlsx).
  //
  // Harga MODAL tidak ada di berkas mana pun — ekspor marketplace tidak pernah
  // memuat modal penjual — jadi angka cost di bawah masih perkiraan dan wajib
  // dikoreksi client sebelum laporan laba rugi dipakai untuk mengambil
  // keputusan. Stok juga tidak ada di ekspor penjualan, jadi masih contoh.
  const rawProducts = [
    // ================= DATA ASLI CLIENT =================
    { cat: 'cat-1', name: 'Gear Set Yamaha WR155 Type 428 Black GNNK Racing', sku: 'G-SETWR-428-14-52-B', bar: '899200100101', price: 500000, cost: 285000, stock: 24, gram: 2000 },
    { cat: 'cat-1', name: 'Gear Set Honda CRF150 TYPE 520 Red Alloy Baja GNNK Racing Product', sku: 'SETCRF-13-44AB-R', bar: '899200100102', price: 1100000, cost: 640000, stock: 12, gram: 3000 },
    { cat: 'cat-1', name: 'Gear Set Yamaha Jupiter Z Mx Old GNNK Racing Product', sku: 'G-415/13-36-Ornge+R', bar: '899200100103', price: 425000, cost: 245000, stock: 30, gram: 1000 },
    { cat: 'cat-1', name: 'Gear Set Yamaha MX King Type 415 Black GNNK Racing', sku: 'GB-MX-KING-40-BLACK', bar: '899200100104', price: 195000, cost: 112000, stock: 38, gram: 1000 },
    { cat: 'cat-2', name: 'Gear Belakang Yamaha Fiz R  Rx King GNNK Racing Product', sku: 'Gb-415-41F-Black', bar: '899200200101', price: 195000, cost: 108000, stock: 45, gram: 300 },
    { cat: 'cat-2', name: 'Gear Belakang Honda CRF150 TYPE 520 Red GNNK Racing Product', sku: 'GB-CRF-520-42 Red', bar: '899200200102', price: 350000, cost: 198000, stock: 26, gram: 1000 },

    // ============ CONTOH, MENGIKUTI POLA SKU CLIENT ============
    { cat: 'cat-1', name: 'Gear Set Yamaha Vixion Type 428 Gold GNNK Racing', sku: 'G-SETVIX-428-14-45-G', bar: '899200100105', price: 465000, cost: 268000, stock: 22, gram: 1800 },
    { cat: 'cat-1', name: 'Gear Set Yamaha R15 V3 Type 428 Black GNNK Racing', sku: 'G-SETR15-428-14-47-B', bar: '899200100106', price: 520000, cost: 300000, stock: 18, gram: 1900 },
    { cat: 'cat-1', name: 'Gear Set Honda Sonic 150 Type 420 Red GNNK Racing', sku: 'G-SETSON-420-14-43-R', bar: '899200100107', price: 385000, cost: 222000, stock: 27, gram: 1500 },
    { cat: 'cat-1', name: 'Gear Set Honda CB150R Type 428 Silver GNNK Racing', sku: 'G-SETCB-428-15-45-S', bar: '899200100108', price: 445000, cost: 256000, stock: 20, gram: 1800 },
    { cat: 'cat-1', name: 'Gear Set Suzuki Satria FU150 Type 428 Gold GNNK Racing', sku: 'G-SETFU-428-14-43-G', bar: '899200100109', price: 410000, cost: 236000, stock: 25, gram: 1700 },
    { cat: 'cat-1', name: 'Gear Set Kawasaki KLX150 Type 428 Black GNNK Racing', sku: 'G-SETKLX-428-14-48-B', bar: '899200100110', price: 495000, cost: 285000, stock: 16, gram: 2100 },
    { cat: 'cat-1', name: 'Gear Set Yamaha Aerox 155 Type 415 Black GNNK Racing', sku: 'G-SETAER-415-13-38-B', bar: '899200100111', price: 355000, cost: 205000, stock: 21, gram: 1200 },
    { cat: 'cat-1', name: 'Gear Set Honda Supra X 125 Type 428 Silver GNNK Racing', sku: 'G-SETSUP-428-14-35-S', bar: '899200100112', price: 265000, cost: 152000, stock: 34, gram: 1100 },
    { cat: 'cat-1', name: 'Gear Set Yamaha Jupiter MX 135 Type 428 Red GNNK Racing', sku: 'G-SETMX-428-14-43-R', bar: '899200100113', price: 335000, cost: 193000, stock: 29, gram: 1300 },
    { cat: 'cat-1', name: 'Gear Set Honda Verza 150 Type 428 Black GNNK Racing', sku: 'G-SETVER-428-15-43-B', bar: '899200100114', price: 375000, cost: 216000, stock: 23, gram: 1600 },
    { cat: 'cat-1', name: 'Gear Set Yamaha Byson Type 428 Gold GNNK Racing', sku: 'G-SETBYS-428-14-42-G', bar: '899200100115', price: 425000, cost: 245000, stock: 17, gram: 1700 },
    { cat: 'cat-1', name: 'Gear Set Kawasaki Ninja 250 Type 520 Red Alloy GNNK Racing', sku: 'G-SETNIN-520-14-43-R', bar: '899200100116', price: 985000, cost: 570000, stock: 9, gram: 2800 },

    { cat: 'cat-2', name: 'Gear Belakang Yamaha Vixion Type 428 Ring 45 Gold', sku: 'GB-428-45-VIX-GOLD', bar: '899200200103', price: 165000, cost: 92000, stock: 52, gram: 600 },
    { cat: 'cat-2', name: 'Gear Belakang Honda Beat Type 415 Ring 38 Black', sku: 'GB-415-38-BEAT-BLACK', bar: '899200200104', price: 125000, cost: 68000, stock: 61, gram: 450 },
    { cat: 'cat-2', name: 'Gear Belakang Yamaha Mio Type 415 Ring 39 Silver', sku: 'GB-415-39-MIO-SILVER', bar: '899200200105', price: 130000, cost: 71000, stock: 48, gram: 450 },
    { cat: 'cat-2', name: 'Gear Belakang Suzuki Satria FU Type 428 Ring 43 Gold', sku: 'GB-428-43-FU-GOLD', bar: '899200200106', price: 175000, cost: 98000, stock: 37, gram: 650 },
    { cat: 'cat-2', name: 'Gear Belakang Kawasaki KLX150 Type 428 Ring 48 Black', sku: 'GB-428-48-KLX-BLACK', bar: '899200200107', price: 195000, cost: 110000, stock: 29, gram: 800 },
    { cat: 'cat-2', name: 'Gear Belakang Honda CB150R Type 428 Ring 45 Red', sku: 'GB-428-45-CB-RED', bar: '899200200108', price: 180000, cost: 101000, stock: 33, gram: 700 },
    { cat: 'cat-2', name: 'Gear Belakang Yamaha R15 Type 428 Ring 47 Black Alloy', sku: 'GB-428-47-R15-BLACK', bar: '899200200109', price: 225000, cost: 128000, stock: 24, gram: 750 },
    { cat: 'cat-2', name: 'Gear Belakang Yamaha Aerox Type 415 Ring 38 Gold', sku: 'GB-415-38-AER-GOLD', bar: '899200200110', price: 140000, cost: 77000, stock: 41, gram: 500 },

    { cat: 'cat-3', name: 'Gear Depan Yamaha Vixion Type 428 Mata 14', sku: 'GD-428-14-VIX', bar: '899200300101', price: 65000, cost: 33000, stock: 88, gram: 200 },
    { cat: 'cat-3', name: 'Gear Depan Honda CRF150 Type 520 Mata 13', sku: 'GD-520-13-CRF', bar: '899200300102', price: 95000, cost: 49000, stock: 54, gram: 300 },
    { cat: 'cat-3', name: 'Gear Depan Yamaha Jupiter Z Type 415 Mata 13', sku: 'GD-415-13-JUPZ', bar: '899200300103', price: 55000, cost: 27000, stock: 96, gram: 180 },
    { cat: 'cat-3', name: 'Gear Depan Honda Supra Type 428 Mata 14', sku: 'GD-428-14-SUPRA', bar: '899200300104', price: 60000, cost: 30000, stock: 74, gram: 200 },
    { cat: 'cat-3', name: 'Gear Depan Suzuki Satria FU Type 428 Mata 14', sku: 'GD-428-14-FU', bar: '899200300105', price: 68000, cost: 35000, stock: 63, gram: 220 },
    { cat: 'cat-3', name: 'Gear Depan Kawasaki KLX150 Type 428 Mata 14', sku: 'GD-428-14-KLX', bar: '899200300106', price: 72000, cost: 37000, stock: 47, gram: 240 },

    { cat: 'cat-4', name: 'Rantai Motor Type 428 x 120 Sambungan Gold', sku: 'RT-428-120-GOLD', bar: '899200400101', price: 185000, cost: 104000, stock: 56, gram: 900 },
    { cat: 'cat-4', name: 'Rantai Motor Type 428 x 132 Sambungan Black', sku: 'RT-428-132-BLACK', bar: '899200400102', price: 205000, cost: 115000, stock: 44, gram: 1000 },
    { cat: 'cat-4', name: 'Rantai Motor Type 415 x 116 Standar Silver', sku: 'RT-415-116-SILVER', bar: '899200400103', price: 135000, cost: 74000, stock: 68, gram: 700 },
    { cat: 'cat-4', name: 'Rantai Motor Type 520 x 112 O-Ring Heavy Duty', sku: 'RT-520-112-ORING', bar: '899200400104', price: 425000, cost: 245000, stock: 19, gram: 1600 },
    { cat: 'cat-4', name: 'Rantai Motor Type 420 x 124 Sambungan Gold', sku: 'RT-420-124-GOLD', bar: '899200400105', price: 155000, cost: 86000, stock: 51, gram: 800 },

    { cat: 'cat-5', name: 'Baut Gear Belakang Set 6 Pcs Stainless', sku: 'BT-GB-SET6-SS', bar: '899200500101', price: 45000, cost: 21000, stock: 120, gram: 150 },
    { cat: 'cat-5', name: 'Mur Nut Gear Set 6 Pcs High Tensile', sku: 'BT-NUT-SET6-HT', bar: '899200500102', price: 38000, cost: 17000, stock: 140, gram: 120 },
    { cat: 'cat-5', name: 'Sambungan Rantai / Master Link 428', sku: 'BT-LINK-428', bar: '899200500103', price: 18000, cost: 7000, stock: 210, gram: 40 },
    { cat: 'cat-5', name: 'Sambungan Rantai / Master Link 520', sku: 'BT-LINK-520', bar: '899200500104', price: 25000, cost: 10000, stock: 165, gram: 60 },
    { cat: 'cat-5', name: 'Karet Peredam Tromol Set 4 Pcs', sku: 'BT-KRT-TROMOL-4', bar: '899200500105', price: 55000, cost: 26000, stock: 92, gram: 200 },

    { cat: 'cat-6', name: 'Chain Lube Semprot 400ml Racing', sku: 'OL-LUBE-400', bar: '899200600101', price: 65000, cost: 34000, stock: 78, gram: 450 },
    { cat: 'cat-6', name: 'Chain Cleaner Semprot 500ml', sku: 'OL-CLEAN-500', bar: '899200600102', price: 58000, cost: 30000, stock: 66, gram: 550 },
    { cat: 'cat-6', name: 'Paket Perawatan Rantai (Lube + Cleaner + Sikat)', sku: 'OL-PAKET-RAWAT', bar: '899200600103', price: 145000, cost: 78000, stock: 40, gram: 1100 },

    { cat: 'cat-7', name: 'Baja Karbon S45C Batangan 1 Meter', sku: 'RAW-S45C-1M', bar: '899200700101', price: 320000, cost: 210000, stock: 35, gram: 4000 },
    { cat: 'cat-7', name: 'Aluminium Alloy 7075 Billet Plate', sku: 'RAW-AL7075-PLT', bar: '899200700102', price: 850000, cost: 570000, stock: 14, gram: 5000 },
    { cat: 'cat-7', name: 'Cat Powder Coating Black Doff 5kg', sku: 'RAW-PC-BLACK-5', bar: '899200700103', price: 425000, cost: 275000, stock: 22, gram: 5000 },
    { cat: 'cat-7', name: 'Cat Powder Coating Gold Metalik 5kg', sku: 'RAW-PC-GOLD-5', bar: '899200700104', price: 480000, cost: 310000, stock: 17, gram: 5000 },

    { cat: 'cat-8', name: 'Kaos GNNK Racing Official Black (M)', sku: 'MRC-KAOS-BLK-M', bar: '899200800101', price: 125000, cost: 58000, stock: 45, gram: 250 },
    { cat: 'cat-8', name: 'Kaos GNNK Racing Official Black (L)', sku: 'MRC-KAOS-BLK-L', bar: '899200800102', price: 125000, cost: 58000, stock: 48, gram: 260 },
    { cat: 'cat-8', name: 'Kaos GNNK Racing Official Black (XL)', sku: 'MRC-KAOS-BLK-XL', bar: '899200800103', price: 135000, cost: 62000, stock: 32, gram: 280 },
    { cat: 'cat-8', name: 'Topi Trucker GNNK Racing', sku: 'MRC-TOPI-TRK', bar: '899200800104', price: 95000, cost: 42000, stock: 38, gram: 150 },
    { cat: 'cat-8', name: 'Stiker Set GNNK Racing Die-Cut', sku: 'MRC-STIKER-SET', bar: '899200800105', price: 35000, cost: 12000, stock: 150, gram: 50 },
  ];

  const products: Product[] = rawProducts.map((p, idx) => ({
    id: seedUuid(`prod-${idx + 1}`),
    store_id: targetStoreId,
    category_id: seedUuid(p.cat),
    name: p.name,
    description: null,
    image_url: null,
    sku: p.sku,
    barcode: p.bar,
    base_price: p.price,
    cost_price: p.cost,
    stock_qty: p.stock,
    min_stock: 10,
    track_stock: true,
    is_active: true,
    weight_gram: p.gram,
    // Sparepart tidak punya varian ukuran seperti minuman.
    sizes: [],
  }));

  // 5. SUPPLIERS (IDR & USD with Kurs)
  const supplierDefs = [
    { name: 'PT Baja Presisi Nusantara', cur: 'IDR', rate: 1, term: 30, dp: 30, contact: 'Pak Hendro', phone: '08123456701' },
    { name: 'CV Logam Jaya Sidoarjo', cur: 'IDR', rate: 1, term: 14, dp: 20, contact: 'Ibu Rahayu', phone: '08123456702' },
    { name: 'Zhejiang Chain Manufacturing Co., Ltd.', cur: 'USD', rate: 16250, term: 45, dp: 50, contact: 'Chen Wei', phone: '+86755888899' },
    { name: 'Osaka Sprocket Industries Ltd.', cur: 'USD', rate: 16200, term: 30, dp: 40, contact: 'Kenji Sato', phone: '+8135559876' },
    { name: 'PT Powder Coating Warna Prima', cur: 'IDR', rate: 1, term: 14, dp: 0, contact: 'Pak Budi Gunawan', phone: '08123456705' },
    { name: 'CV Kemasan Nusantara Grafika', cur: 'IDR', rate: 1, term: 14, dp: 50, contact: 'Ibu Ratna', phone: '08123456706' },
    { name: 'Guangzhou Alloy Billet Supply', cur: 'USD', rate: 16300, term: 45, dp: 30, contact: 'Li Ming', phone: '+86205551234' },
    { name: 'PT Baut Mur Teknik Utama', cur: 'IDR', rate: 1, term: 7, dp: 0, contact: 'Pak Joko', phone: '08123456708' },
    { name: 'CV Pelumas Rantai Mandiri', cur: 'IDR', rate: 1, term: 14, dp: 20, contact: 'Pak Tono', phone: '08123456709' },
    { name: 'Bandung Apparel Garment Studio', cur: 'IDR', rate: 1, term: 30, dp: 50, contact: 'Kang Asep', phone: '08123456710' },
  ];

  const suppliers: Supplier[] = supplierDefs.map((s, idx) => ({
    id: seedUuid(`sup-${idx + 1}`),
    store_id: targetStoreId,
    name: s.name,
    contact_name: s.contact,
    phone: s.phone,
    email: `contact@${s.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    address: 'Kawasan Industri Terpadu No. ' + (idx + 1),
    currency: s.cur,
    exchange_rate: s.rate,
    default_term_days: s.term,
    default_dp_percent: s.dp,
    notes: null,
    is_active: true,
    created_at: formatIso(new Date(now.getTime() - 45 * 86400000)),
  }));

  // 6. PURCHASES & PURCHASE ITEMS (40 POs)
  const purchases: Purchase[] = [];
  const purchaseItems: PurchaseItem[] = [];
  const purchasePayments: PurchasePayment[] = [];

  for (let i = 1; i <= 40; i++) {
    const sup = sample(suppliers);
    const pDate = new Date(now.getTime() - (42 - i) * 86400000);
    const isReceived = i <= 32;
    const isPaid = i <= 28;
    const pId = seedUuid(`po-${pad(i, 3)}`);

    const pItemsCount = rand(2, 4);
    let subtotalIdr = 0;

    for (let k = 0; k < pItemsCount; k++) {
      const prod = sample(products);
      const qty = rand(10, 50);
      const isUsd = sup.currency === 'USD';
      const costIdr = prod.cost_price;
      const costUsd = Number((costIdr / (sup.exchange_rate || 16200)).toFixed(2));
      const lineTotalIdr = qty * costIdr;
      subtotalIdr += lineTotalIdr;

      const pItem: PurchaseItem = {
        id: seedUuid(`poi-${pad(i, 3)}-${k + 1}`),
        purchase_id: pId,
        product_id: prod.id,
        name: prod.name,
        sku: prod.sku,
        barcode: prod.barcode,
        qty,
        received_qty: isReceived ? qty : 0,
        cost_price: costIdr,
        original_cost_price: isUsd ? costUsd : costIdr,
        currency: sup.currency,
        subtotal: lineTotalIdr,
        note: null,
      };
      purchaseItems.push(pItem);
    }

    const discount = i % 5 === 0 ? Math.round(subtotalIdr * 0.05) : 0;
    const tax = Math.round((subtotalIdr - discount) * 0.1);
    const totalIdr = subtotalIdr - discount + tax;
    const paidAmount = isPaid ? totalIdr : (totalIdr * sup.default_dp_percent) / 100;

    purchases.push({
      id: pId,
      store_id: targetStoreId,
      supplier_id: sup.id,
      invoice_number: `PO-2026-${pad(i, 4)}`,
      status: isPaid ? 'received' : isReceived ? 'received' : 'ordered',
      order_date: pDate.toISOString().slice(0, 10),
      expected_date: new Date(pDate.getTime() + 7 * 86400000).toISOString().slice(0, 10),
      due_date: new Date(pDate.getTime() + (sup.default_term_days || 14) * 86400000).toISOString().slice(0, 10),
      currency: sup.currency,
      exchange_rate: sup.exchange_rate,
      subtotal: subtotalIdr,
      discount,
      tax,
      other_cost: 0,
      total: totalIdr,
      paid_amount: paidAmount,
      dp_percent: sup.default_dp_percent,
      received_at: isReceived ? new Date(pDate.getTime() + 3 * 86400000).toISOString() : null,
      notes: null,
      created_by: actor,
      created_at: formatIso(pDate),
    });

    if (paidAmount > 0) {
      purchasePayments.push({
        id: seedUuid(`popay-${pad(i, 3)}-1`),
        store_id: targetStoreId,
        purchase_id: pId,
        type: isPaid ? 'settlement' : 'dp',
        amount: paidAmount,
        method: 'transfer',
        reference: `TRF-${pad(i, 4)}`,
        paid_at: formatIso(pDate),
        note: isPaid ? 'Pelunasan faktur' : 'Pembayaran DP',
        created_by: actor,
      });
    }
  }

  // 7. CUSTOMERS (80 customers)
  const firstNames = ['Budi', 'Siti', 'Danang', 'Dewi', 'Rizky', 'Agus', 'Putri', 'Bambang', 'Anisa', 'Fajar', 'Indah', 'Eko', 'Nurul', 'Arief', 'Mega', 'Bayu', 'Dian', 'Wahyu', 'Rina', 'Hendra'];
  const lastNames = ['Santoso', 'Rahmawati', 'Prasetyo', 'Lestari', 'Pratama', 'Setiawan', 'Hidayat', 'Kusuma', 'Saputra', 'Wahyuni', 'Utami', 'Nugroho', 'Wijaya', 'Suryani', 'Gunawan'];
  const customers: Customer[] = [];

  for (let i = 1; i <= 80; i++) {
    const fn = sample(firstNames);
    const ln = sample(lastNames);
    const name = `${fn} ${ln}`;
    const custDate = new Date(now.getTime() - rand(10, 90) * 86400000);

    customers.push({
      id: seedUuid(`cust-${pad(i, 3)}`),
      store_id: targetStoreId,
      name,
      phone: `081${rand(10, 99)}${rand(1000, 9999)}${rand(10, 99)}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@gmail.com`,
      location: sample(['Yogyakarta', 'Sleman', 'Bantul', 'Solo', 'Semarang', 'Jakarta', 'Surabaya']),
      points: rand(50, 2500),
      is_active: true,
      joined_date: custDate.toISOString().slice(0, 10),
    });
  }

  // 8. PROMOS
  const promos: Promo[] = [
    { id: seedUuid('pro-1'), store_id: targetStoreId, code: 'DISKON10', name: 'Diskon Kemerdekaan 10%', type: 'percent', value: 10, start_date: '2026-08-01', end_date: '2026-09-30', is_active: true },
    { id: seedUuid('pro-2'), store_id: targetStoreId, code: 'HEMAT20', name: 'Hemat Hebat Rp 20rb', type: 'fixed', value: 20000, start_date: '2026-08-01', end_date: '2026-09-30', is_active: true },
    { id: seedUuid('pro-3'), store_id: targetStoreId, code: 'TIKTOKPROMO', name: 'Live Shopping TikTok 15%', type: 'percent', value: 15, start_date: '2026-08-01', end_date: '2026-09-30', is_active: true },
    { id: seedUuid('pro-4'), store_id: targetStoreId, code: 'SHOPEEGILA', name: 'Shopee Mantul 12%', type: 'percent', value: 12, start_date: '2026-08-01', end_date: '2026-09-30', is_active: true },
    { id: seedUuid('pro-5'), store_id: targetStoreId, code: 'MEMBERVIP', name: 'Spesial Member VIP 20%', type: 'percent', value: 20, start_date: '2026-08-01', end_date: '2026-09-30', is_active: true },
  ];

  // 9. SHIFTS (30 shifts)
  const shifts: Shift[] = [];
  const cashMovements: CashMovement[] = [];

  for (let s = 1; s <= 30; s++) {
    const shiftDate = new Date(now.getTime() - (30 - s) * 86400000);
    const openedAt = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate(), 8, 0, 0);
    const closedAt = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate(), 22, 0, 0);
    const openingCash = 300000;
    const shiftSales = rand(1500000, 4500000);
    const shiftOrders = rand(15, 35);
    const diff = s === 30 ? null : sample([0, 0, 0, -5000, 10000]);

    const shiftId = seedUuid(`shift-${pad(s, 3)}`);
    shifts.push({
      id: shiftId,
      store_id: targetStoreId,
      cashier_id: actor,
      opened_at: formatIso(openedAt),
      closed_at: s === 30 ? null : formatIso(closedAt),
      opening_cash: openingCash,
      closing_cash: s === 30 ? null : openingCash + shiftSales + (diff ?? 0),
      expected_cash: s === 30 ? null : openingCash + shiftSales,
      total_sales: shiftSales,
      total_orders: shiftOrders,
      notes: `Shift Kasir Hari ke-${s}`,
    });

    cashMovements.push({
      id: seedUuid(`cm-open-${s}`),
      store_id: targetStoreId,
      shift_id: shiftId,
      type: 'in',
      amount: openingCash,
      note: 'Modal awal kasir',
      created_at: formatIso(openedAt),
    });
  }

  // 10. ORDERS (360+ orders over 30 days)
  const orders: Order[] = [];
  const orderItems: OrderItem[] = [];
  const orderPayments: OrderPayment[] = [];
  const stockMovements: StockMovement[] = [];
  const loyaltyTransactions: LoyaltyTransaction[] = [];

  const platformCodes = [
    { code: 'offline', label: 'Offline', weight: 40 },
    { code: 'tiktok', label: 'TikTok', weight: 20 },
    { code: 'shopee', label: 'Shopee', weight: 20 },
    { code: 'tokopedia', label: 'Tokopedia', weight: 10 },
    { code: 'website', label: 'Website', weight: 5 },
    { code: 'whatsapp', label: 'WhatsApp', weight: 5 },
  ];

  function pickPlatform() {
    const totalW = platformCodes.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * totalW;
    for (const p of platformCodes) {
      if (r < p.weight) return p;
      r -= p.weight;
    }
    return platformCodes[0];
  }

  let orderGlobalCounter = 1;

  for (let day = 30; day >= 0; day--) {
    const ordersPerDay = rand(11, 16);
    const dayDate = new Date(now.getTime() - day * 86400000);

    for (let ord = 0; ord < ordersPerDay; ord++) {
      const orderId = seedUuid(`ord-${pad(orderGlobalCounter, 4)}`);
      const plat = pickPlatform();
      const hour = rand(8, 21);
      const minute = rand(0, 59);
      const second = rand(0, 59);
      const orderTime = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, minute, second);

      // Order number format: #[YYMMDD-HHMMSS]-[NamaToko]-[Platform]
      const tsCode = `${String(orderTime.getFullYear()).slice(2)}${pad(orderTime.getMonth() + 1)}${pad(orderTime.getDate())}-${pad(hour)}${pad(minute)}${pad(second)}`;
      const storePart = store.name.replace(/[^a-zA-Z0-9]+/g, '') || 'Toko';
      const orderNumber = `#${tsCode}-${storePart}-${plat.label}`;

      const cust = Math.random() < 0.65 ? sample(customers) : null;
      const isTempo = plat.code !== 'offline' && Math.random() < 0.7;
      const paymentMethod = sample(['cash', 'qris', 'card', 'ewallet'] as const);

      const itemCount = rand(1, 4);
      let subtotal = 0;
      let orderCost = 0;

      for (let it = 0; it < itemCount; it++) {
        const prod = sample(products);
        const qty = rand(1, 3);
        const price = prod.base_price;
        const cost = prod.cost_price;
        const lineTotal = price * qty;

        subtotal += lineTotal;
        orderCost += cost * qty;

        const orderItemRow: OrderItem = {
          id: seedUuid(`oi-${pad(orderGlobalCounter, 4)}-${it + 1}`),
          order_id: orderId,
          product_id: prod.id,
          name: prod.name,
          price,
          qty,
          cost_price: cost,
          size: prod.sizes.length ? sample(prod.sizes).label : null,
          note: it === 0 && Math.random() < 0.2 ? 'Less sweet / request khusus' : null,
        };
        orderItems.push(orderItemRow);

        stockMovements.push({
          id: seedUuid(`sm-${orderId}-${prod.id}`),
          store_id: targetStoreId,
          product_id: prod.id,
          type: 'sale',
          qty_delta: -qty,
          reason: `Penjualan ${orderNumber} (${plat.label})`,
          ref_order_id: orderId,
          created_at: formatIso(orderTime),
        });
      }

      const discount = Math.random() < 0.25 ? Math.round(subtotal * 0.1) : 0;
      const tax = Math.round((subtotal - discount) * 0.1);
      const total = subtotal - discount + tax;
      const pointsEarned = cust ? Math.floor(total * 0.01) : 0;

      const isCanceled = Math.random() < 0.02;
      const isPaid = !isCanceled && (!isTempo || Math.random() < 0.85);
      const paidAmount = isPaid ? total : 0;

      orders.push({
        id: orderId,
        store_id: targetStoreId,
        customer_id: cust?.id ?? null,
        customer_name: null,
        cashier_id: actor,
        shift_id: seedUuid(`shift-${pad(Math.min(30, 31 - day), 3)}`),
        order_number: orderNumber,
        subtotal,
        tax,
        discount,
        total,
        payment_method: paymentMethod,
        payment_status: isCanceled ? 'unpaid' : isPaid ? 'paid' : 'unpaid',
        order_status: isCanceled ? 'canceled' : 'done',
        order_type: sample(['dine_in', 'take_away'] as const),
        table_number: plat.code === 'offline' && Math.random() < 0.5 ? `Meja ${rand(1, 15)}` : null,
        sales_channel: plat.code,
        payment_term: isTempo ? 'tempo' : 'cash',
        due_date: isTempo ? new Date(orderTime.getTime() + 14 * 86400000).toISOString().slice(0, 10) : null,
        paid_amount: paidAmount,
        settled_at: isPaid && isTempo ? new Date(orderTime.getTime() + 3 * 86400000).toISOString() : null,
        received_amount: paymentMethod === 'cash' ? Math.ceil(total / 10000) * 10000 : total,
        change_amount: paymentMethod === 'cash' ? Math.max(0, (Math.ceil(total / 10000) * 10000) - total) : 0,
        points_earned: pointsEarned,
        notes: `Pesanan via ${plat.label}`,
        original_total: null,
        adjustment_amount: 0,
        adjustment_note: null,
        adjusted_at: null,
        adjusted_by: null,
        external_order_no: plat.code === 'offline' ? null : fakePlatformOrderNo(plat.code),
        created_at: formatIso(orderTime),
      });

      if (isTempo && isPaid) {
        orderPayments.push({
          id: seedUuid(`ordpay-${pad(orderGlobalCounter, 4)}`),
          store_id: targetStoreId,
          order_id: orderId,
          amount: total,
          method: 'transfer',
          reference: `CAIR-${plat.label.toUpperCase()}-${orderId}`,
          paid_at: new Date(orderTime.getTime() + 3 * 86400000).toISOString(),
          note: 'Pencairan tempo marketplace',
          created_by: actor,
        });
      }

      if (pointsEarned > 0 && cust) {
        loyaltyTransactions.push({
          id: seedUuid(`loy-${orderId}`),
          store_id: targetStoreId,
          customer_id: cust.id,
          points_delta: pointsEarned,
          reason: `Poin dari transaksi ${orderNumber}`,
          ref_order_id: orderId,
          created_at: formatIso(orderTime),
        });
      }

      orderGlobalCounter++;
    }
  }

  // 11b. PENGELUARAN OPERASIONAL (untuk laporan laba rugi)
  const expenses: Expense[] = [];
  const expenseTemplates: { category: ExpenseCategory; desc: string; min: number; max: number; monthly: boolean }[] = [
    { category: 'sewa', desc: 'Sewa ruko', min: 3500000, max: 3500000, monthly: true },
    { category: 'gaji', desc: 'Gaji karyawan', min: 4500000, max: 6000000, monthly: true },
    { category: 'listrik_air', desc: 'Listrik & air', min: 650000, max: 1200000, monthly: true },
    { category: 'internet', desc: 'Internet toko', min: 350000, max: 350000, monthly: true },
    { category: 'transport', desc: 'Ongkos kirim & bensin', min: 50000, max: 250000, monthly: false },
    { category: 'pemasaran', desc: 'Iklan marketplace', min: 100000, max: 600000, monthly: false },
    { category: 'perlengkapan', desc: 'Kantong & struk', min: 40000, max: 180000, monthly: false },
    { category: 'perawatan', desc: 'Servis peralatan', min: 150000, max: 500000, monthly: false },
  ];

  for (let d = 29; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400000);
    const iso = day.toISOString().slice(0, 10);
    for (const tpl of expenseTemplates) {
      // Biaya bulanan hanya di tanggal 1; sisanya muncul acak beberapa hari.
      const hit = tpl.monthly ? day.getDate() === 1 : Math.random() < 0.18;
      if (!hit) continue;
      expenses.push({
        id: seedUuid(`exp-${iso}-${tpl.category}`),
        store_id: targetStoreId,
        category: tpl.category,
        description: tpl.desc,
        amount: rand(tpl.min, tpl.max),
        expense_date: iso,
        payment_method: tpl.monthly ? 'transfer' : 'cash',
        shift_id: null,
        created_by: actor,
        created_at: formatIso(day),
      });
    }
  }

  // 12. PRODUCT CHANNEL MAPPINGS (multi-platform SKU per product)
  const mappingPlatformCodes = ['shopee', 'tiktok', 'tokopedia', 'website'];
  const platformPrefixes: Record<string, string> = {
    shopee: 'SHP',
    tiktok: 'TT',
    tokopedia: 'TKPD',
    website: 'WEB',
  };
  const productChannelMappings: ProductChannelMapping[] = [];
  for (const prod of products) {
    if (!prod.sku) continue;
    // Each product gets mapped to 2-4 random platforms
    const platformCount = rand(2, 4);
    const shuffled = [...mappingPlatformCodes].sort(() => Math.random() - 0.5);
    for (let p = 0; p < platformCount; p++) {
      const code = shuffled[p];
      const prefix = platformPrefixes[code];
      productChannelMappings.push({
        // Id deterministik: generate1000Data bisa terpanggil lebih dari sekali
        // (auth.ts memanggilnya di signIn dan refreshProfile). Dengan id acak,
        // seed kedua menambah baris kembar untuk (produk, channel) yang sama.
        id: seedUuid(`pcm-${prod.id}-${code}`),
        store_id: targetStoreId,
        product_id: prod.id,
        channel_code: code,
        external_sku: `${prefix}-${prod.sku}`,
        external_url: code === 'website'
          ? `https://tokokasirnusantara.com/produk/${prod.sku?.toLowerCase()}`
          : `https://${code}.com/shop/tokokasirnusantara/${prod.sku?.toLowerCase()}`,
        is_synced: Math.random() < 0.85,
        last_synced_at: Math.random() < 0.85 ? formatIso(new Date(now.getTime() - rand(0, 7) * 86400000)) : null,
      });
    }
  }

  // 13. SUPPLIER PRODUCT MAPPINGS (supplier catalog with supplier-specific SKU)
  const supplierProductMappings: SupplierProductMapping[] = [];
  for (const sup of suppliers) {
    // Each supplier carries 5-10 products from the catalog
    const productCount = rand(5, 10);
    const shuffledProds = [...products].sort(() => Math.random() - 0.5);
    for (let sp = 0; sp < productCount && sp < shuffledProds.length; sp++) {
      const prod = shuffledProds[sp];
      const supPrefix = sup.name.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
      supplierProductMappings.push({
        // Alasan sama seperti product_channel_mappings di atas.
        id: seedUuid(`spm-${sup.id}-${prod.id}`),
        store_id: targetStoreId,
        supplier_id: sup.id,
        product_id: prod.id,
        // Diturunkan dari produknya, bukan nomor urut hasil acak: kalau tidak,
        // seed berikutnya memberi kode yang sama ke produk berbeda dan menabrak
        // unique index (supplier_id, lower(supplier_sku)) di Postgres.
        supplier_sku: `${supPrefix}-${prod.sku ?? prod.id.slice(0, 8)}`,
        supplier_barcode: `${sup.id}-${prod.barcode || pad(sp + 1, 12)}`,
        supplier_product_name: prod.name,
        last_cost_price: sup.currency === 'USD'
          ? Number((prod.cost_price / (sup.exchange_rate || 16200)).toFixed(2))
          : prod.cost_price,
        currency: sup.currency,
      });
    }
  }

  // BULK INSERT INTO DEXIE
  await db.transaction('rw', [
    db.stores, db.sales_channels, db.categories, db.products, db.suppliers,
    db.purchases, db.purchase_items, db.purchase_payments, db.customers,
    db.promos, db.shifts, db.cash_movements, db.stock_movements,
    db.orders, db.order_items, db.order_payments, db.loyalty_transactions, db.expenses,
    db.product_channel_mappings, db.supplier_product_mappings,
  ], async () => {
    // Jumlah baris anak per induk itu acak (rand(2,4)), sedangkan id induknya
    // tetap. Dengan bulkPut saja, sisa baris dari seed sebelumnya ikut bertahan:
    // satu nota bisa menumpuk 4 item padahal subtotalnya hanya menghitung 2,
    // dan item lama tetap memakai mata uang supplier yang lama. Jadi baris anak
    // milik induk yang akan ditulis ulang dibersihkan dulu.
    const purchaseIds = purchases.map((row) => row.id);
    const orderIds = orders.map((row) => row.id);
    await db.purchase_items.where('purchase_id').anyOf(purchaseIds).delete();
    await db.purchase_payments.where('purchase_id').anyOf(purchaseIds).delete();
    await db.order_items.where('order_id').anyOf(orderIds).delete();
    await db.order_payments.where('order_id').anyOf(orderIds).delete();

    await db.stores.put(store);
    await db.sales_channels.bulkPut(channels);
    await db.categories.bulkPut(categories);
    await db.products.bulkPut(products);
    await db.suppliers.bulkPut(suppliers);
    await db.purchases.bulkPut(purchases);
    await db.purchase_items.bulkPut(purchaseItems);
    await db.purchase_payments.bulkPut(purchasePayments);
    await db.customers.bulkPut(customers);
    await db.promos.bulkPut(promos);
    await db.shifts.bulkPut(shifts);
    await db.cash_movements.bulkPut(cashMovements);
    await db.stock_movements.bulkPut(stockMovements);
    await db.orders.bulkPut(orders);
    await db.order_items.bulkPut(orderItems);
    await db.order_payments.bulkPut(orderPayments);
    await db.loyalty_transactions.bulkPut(loyaltyTransactions);
    await db.expenses.bulkPut(expenses);
    await db.product_channel_mappings.bulkPut(productChannelMappings);
    await db.supplier_product_mappings.bulkPut(supplierProductMappings);
  });

  const totalCount =
    1 + channels.length + categories.length + products.length + suppliers.length +
    purchases.length + purchaseItems.length + purchasePayments.length +
    customers.length + promos.length + shifts.length + cashMovements.length +
    stockMovements.length + orders.length + orderItems.length +
    orderPayments.length +
    loyaltyTransactions.length + expenses.length + productChannelMappings.length +
    supplierProductMappings.length;

  return {
    totalRecords: totalCount,
    breakdown: {
      store: 1,
      channels: channels.length,
      categories: categories.length,
      products: products.length,
      suppliers: suppliers.length,
      purchases: purchases.length,
      purchaseItems: purchaseItems.length,
      purchasePayments: purchasePayments.length,
      customers: customers.length,
      promos: promos.length,
      shifts: shifts.length,
      cashMovements: cashMovements.length,
      stockMovements: stockMovements.length,
      orders: orders.length,
      orderItems: orderItems.length,
      orderPayments: orderPayments.length,
      loyaltyTransactions: loyaltyTransactions.length,
      expenses: expenses.length,
      productChannelMappings: productChannelMappings.length,
      supplierProductMappings: supplierProductMappings.length,
    },
  };
}

/**
 * Dorong hasil seed ke Postgres.
 *
 * Seeder hanya menulis ke IndexedDB, sehingga data demo dulu tidak pernah ada
 * di server: setiap fitur yang menyentuh product_id/shift_id lewat API pasti
 * gagal. Urutan tabel di bawah mengikuti ketergantungan foreign key.
 *
 * Best-effort: kegagalan satu tabel (mis. role tidak berhak menulis promo)
 * tidak menggagalkan sisanya, tapi tetap dilaporkan.
 */
export async function pushSeedToServer(): Promise<{ pushed: number; failures: string[]; skipped?: boolean }> {
  const api = getBackendClient();
  if (!navigator.onLine) return { pushed: 0, failures: ['offline'] };

  // Dorongan dilakukan PER TABEL, bukan sekali untuk semuanya.
  //
  // Dulu penjaganya melihat tabel produk saja: kalau produk sudah ada, seluruh
  // dorongan dilewati. Akibatnya tabel lain yang kebetulan kosong — misalnya
  // pemetaan SKU platform yang terhapus saat impor — tidak pernah terisi lagi.
  // Sekarang tiap tabel diperiksa sendiri: yang sudah berisi dilewati (supaya
  // login tidak mengirim ulang ribuan baris), yang kosong diisi.

  // stores sengaja dilewati supaya nama toko asli hasil bootstrap tidak tertimpa.
  const order: { table: string; rows: () => Promise<unknown[]> }[] = [
    { table: 'sales_channels', rows: () => db.sales_channels.toArray() },
    { table: 'categories', rows: () => db.categories.toArray() },
    { table: 'products', rows: () => db.products.toArray() },
    { table: 'customers', rows: () => db.customers.toArray() },
    { table: 'promos', rows: () => db.promos.toArray() },
    { table: 'suppliers', rows: () => db.suppliers.toArray() },
    { table: 'purchases', rows: () => db.purchases.toArray() },
    { table: 'purchase_items', rows: () => db.purchase_items.toArray() },
    { table: 'purchase_payments', rows: () => db.purchase_payments.toArray() },
    { table: 'shifts', rows: () => db.shifts.toArray() },
    { table: 'cash_movements', rows: () => db.cash_movements.toArray() },
    { table: 'orders', rows: () => db.orders.toArray() },
    { table: 'order_items', rows: () => db.order_items.toArray() },
    { table: 'order_payments', rows: () => db.order_payments.toArray() },
    { table: 'stock_movements', rows: () => db.stock_movements.toArray() },
    { table: 'loyalty_transactions', rows: () => db.loyalty_transactions.toArray() },
    { table: 'expenses', rows: () => db.expenses.toArray() },
    { table: 'product_channel_mappings', rows: () => db.product_channel_mappings.toArray() },
    { table: 'supplier_product_mappings', rows: () => db.supplier_product_mappings.toArray() },
  ];

  const CHUNK = 200;
  let pushed = 0;
  const failures: string[] = [];

  let skippedAll = true;
  const didorong = new Set<string>();
  for (const step of order) {
    const rows = await step.rows();
    if (!rows.length) continue;

    const { data: sudahAda, error: probeError } = await api.from(step.table).select('id').limit(1);
    // Kalau pemeriksaan gagal, jangan menebak: lewati tabel ini daripada
    // menimpa data yang mungkin sudah benar di server.
    if (probeError) {
      failures.push(`${step.table} (periksa): ${probeError.message}`);
      continue;
    }
    if (Array.isArray(sudahAda) && sudahAda.length > 0) continue;

    skippedAll = false;
    didorong.add(step.table);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await api.from(step.table).upsert(slice);
      if (error) {
        failures.push(`${step.table}: ${error.message}`);
        break; // potongan berikutnya akan gagal dengan alasan sama
      }
      pushed += slice.length;
    }
  }

  // Unggahan di atas hanya menimpa, tidak pernah membuang. Karena jumlah baris
  // anak per induk itu acak sedangkan id induknya tetap, sisa baris dari seed
  // sebelumnya menumpuk di server: satu nota bisa punya lebih banyak item
  // daripada yang dihitung subtotalnya, dan item lama tetap memakai mata uang
  // supplier yang lama.
  //
  // Pemangkasan hanya untuk tabel yang BARUSAN didorong. Kalau tabelnya
  // dilewati karena server sudah berisi, memangkas anaknya membuat induk dan
  // anak tidak lagi cocok: subtotal pesanan tetap menghitung baris yang sudah
  // ikut terhapus.
  //
  // Urutannya juga penting: pangkas SESUDAH unggahan berhasil, dan hanya baris
  // yang id-nya tidak ada di data lokal. Menghapus lebih dulu lalu mengunggah
  // pernah membuat data hilang ketika salinan lokalnya ternyata tidak lengkap.
  // tidak lengkap.
  if (!failures.length) {
    const prune: { table: string; parent: string; rows: () => Promise<{ id: string }[]> }[] = [
      { table: 'purchase_items', parent: 'purchase_id', rows: () => db.purchase_items.toArray() },
      { table: 'order_items', parent: 'order_id', rows: () => db.order_items.toArray() },
    ];
    for (const step of prune) {
      if (!didorong.has(step.table)) continue; // tabel ini tidak didorong, jangan disentuh
      const local = await step.rows();
      if (!local.length) continue; // tanpa pembanding, jangan hapus apa pun
      const keepIds = local.map((row) => row.id);
      const parentIds = [...new Set(local.map((row) => (row as Record<string, unknown>)[step.parent] as string))]
        .filter(Boolean);
      for (let i = 0; i < parentIds.length; i += 100) {
        const slice = parentIds.slice(i, i + 100);
        const { error } = await api
          .from(step.table)
          .delete()
          .in(step.parent, slice)
          .not_in('id', keepIds);
        if (error) {
          failures.push(`${step.table} (pangkas): ${error.message}`);
          break;
        }
      }
    }
  }

  return { pushed, failures, skipped: skippedAll };
}

/** Diekspor khusus untuk unit test. */
export { seedUuid as __seedUuid };
