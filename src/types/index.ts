export type UserRole = 'admin' | 'manager' | 'warehouse' | 'cashier' | 'customer';
// 'other' dipakai penjualan hasil impor massal: berkasnya tidak menyimpan
// metode bayar, dan menebak 'cash' akan merusak rekap metode pembayaran.
// 'card' tetap ada untuk pesanan lama; kasir kini ditawari 'transfer'.
export type PaymentMethod = 'cash' | 'card' | 'ewallet' | 'qris' | 'transfer' | 'other';
export type PaymentStatus = 'paid' | 'unpaid' | 'partial';
/** Tunai/langsung bayar vs tempo (piutang yang dicairkan belakangan). */
export type PaymentTerm = 'cash' | 'tempo';
export type OrderPaymentMethod = 'cash' | 'transfer' | 'card' | 'ewallet' | 'qris' | 'other';
export type OrderStatus = 'done' | 'pending' | 'canceled' | 'awaiting_confirmation';
export type OrderType = 'dine_in' | 'take_away';

export interface Store {
  id: string;
  name: string;
  address?: string | null;
  currency: string;
  tax_rate: number;
  logo_url?: string | null;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  points_per_amount: number; // points earned per 1 unit of currency
  low_stock_threshold: number;
  /** Industry classification (fnb | retail | bakery | service). Drives POS feature flags. */
  industry?: string | null;
  /** Per-store feature overrides on top of industry defaults. */
  features?: Record<string, unknown> | null;
  created_at?: string;
  /** Gambar tanda tangan (data URL) di faktur A4. */
  invoice_signature_url?: string | null;
  /** Nama penanda tangan faktur A4. */
  /** Nomor WhatsApp toko untuk tombol Chat di halaman produk. */
  shop_phone?: string | null;
  return_policy?: string | null;
  warranty_info?: string | null;
  /** Tujuan pembayaran manual toko online (Tripay belum terintegrasi). */
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  qris_image_url?: string | null;
  /** Banner promo di halaman produk toko online. */
  pdp_banner_url?: string | null;
  /** Kota toko, tampil di kartu produk toko online. */
  shop_city?: string | null;
  invoice_signer_name?: string | null;
}

export interface Profile {
  id: string;
  store_id: string | null;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  avatar_url?: string | null;
}

export interface Category {
  id: string;
  store_id: string;
  name: string;
  icon: string | null;
  sort_order: number;
}

export interface ProductSize {
  label: string;
  price_modifier: number;
}

export interface Product {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: number;
  sizes: ProductSize[];
  is_active: boolean;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  stock_qty: number;
  min_stock: number;
  track_stock: boolean;
  /** Berat satuan dalam gram; dipakai menghitung ongkir. 0 = belum diisi. */
  weight_gram?: number;
  /** Ukuran paket (cm) untuk berat volumetrik ekspedisi. 0 = belum diisi. */
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  /** Merek, ditampilkan di halaman produk toko online. */
  brand?: string | null;
  /** Label variasi (mis. "12T"); produk aktif bernama sama tampil sebagai satu produk bervariasi. */
  variant_name?: string | null;
  /** Harga coret sebelum diskon; 0 = tidak ada. */
  compare_at_price?: number;
  /** Foto tambahan untuk galeri halaman produk. */
  images?: string[];
  /** Spesifikasi bebas ala marketplace, mis. [{ label: 'Bahan', value: 'Baja' }]. */
  spec?: { label: string; value: string }[];
  /** Nama atribut variasi, mis. "Ukuran" atau "Warna" (bawaan: Variasi). */
  variant_label?: string | null;
  warranty_type?: string | null;
  warranty_period?: string | null;
  /** "Apa yang ada di dalam kotak". */
  box_contents?: string | null;
  /** Sorotan produk, satu poin per baris. */
  highlights?: string | null;
  license_type?: string | null;
  license_code?: string | null;
  /** Tautan video produk (YouTube atau file video) untuk galeri. */
  video_url?: string | null;
}

export interface Customer {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  joined_date: string;
  is_active: boolean;
  points: number;
  /** Alamat utama; diisi pembeli dari akun storefront. */
  address?: string | null;
  /** Wilayah alamat utama; dipisah dari teks alamat supaya ongkir bisa dihitung. */
  address_province?: string | null;
  address_city?: string | null;
}

export interface Promo {
  id: string;
  store_id: string;
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  size: string | null;
  qty: number;
  price: number;
  note: string | null;
  cost_price?: number | null;
}

export interface Order {
  id: string;
  store_id: string;
  customer_id: string | null;
  cashier_id: string | null;
  order_number: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  order_type: OrderType;
  table_number: string | null;
  notes: string | null;
  created_at: string;
  promo_code?: string | null;
  received_amount?: number | null;
  change_amount?: number | null;
  points_earned: number;
  shift_id?: string | null;
  /** Kode channel penjualan (offline, shopee, tiktok, ...). */
  sales_channel: string;
  payment_term: PaymentTerm;
  /** Jatuh tempo piutang untuk order tempo. */
  due_date: string | null;
  /** Dijaga trigger database dari daftar order_payments. */
  paid_amount: number;
  settled_at: string | null;
  /** Total sebelum disesuaikan; terisi saat harga diedit setelah terjual. */
  original_total: number | null;
  adjustment_amount: number;
  adjustment_note: string | null;
  adjusted_at: string | null;
  adjusted_by: string | null;
  /** Nomor pesanan milik platform: Shopee "No. Pesanan", TikTok "Order Id". */
  external_order_no: string | null;
  /**
   * Nama pelanggan yang diketik langsung, tanpa baris di tabel pelanggan.
   * Dipakai impor rekap marketplace dan penjualan cepat di kasir.
   */
  customer_name: string | null;
  /** Diisi hanya untuk pesanan tamu dari storefront publik (checkout tanpa login). */
  customer_phone?: string | null;
  /** Kanal & jejak transaksi payment gateway (Tripay); kosong untuk bayar manual. */
  /** Wilayah tujuan kirim, dipakai perhitungan ongkir. */
  delivery_province?: string | null;
  delivery_city?: string | null;
  payment_channel?: string | null;
  payment_reference?: string | null;
  payment_url?: string | null;
  /** Alamat kirim, teks polos — belum ada perhitungan ongkir (KiriminAja belum terintegrasi). */
  delivery_address?: string | null;
  /**
   * Ongkos kirim yang dibebankan ke pembeli. Sudah termasuk di `total`, tapi
   * DIKELUARKAN dari pendapatan di laba rugi: uangnya diteruskan ke kurir dan
   * tidak punya HPP, jadi memasukkannya akan membesarkan margin secara palsu.
   */
  shipping_cost?: number;
  /** true = harga jual sudah termasuk pajak; pajak diekstrak, bukan ditambahkan. */
  tax_inclusive?: boolean;
}

/**
 * Isi sebuah produk set.
 *
 * Set tidak punya stok sendiri: stoknya adalah stok komponennya, dan menjual
 * satu set memotong stok tiap komponen sebanyak takarannya.
 */
export interface ProductComponent {
  id: string;
  store_id: string;
  parent_product_id: string;
  component_product_id: string;
  qty: number;
  created_at?: string;
}

export interface SalesChannel {
  id: string;
  store_id: string;
  code: string;
  name: string;
  /** Estimasi potongan marketplace (%) untuk perkiraan penerimaan bersih. */
  fee_percent: number;
  default_term_days: number;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
}

export interface OrderPayment {
  id: string;
  store_id: string;
  order_id: string;
  amount: number;
  method: OrderPaymentMethod;
  paid_at: string;
  reference: string | null;
  note: string | null;
  created_by: string | null;
  created_at?: string;
}

export interface Shift {
  id: string;
  store_id: string;
  cashier_id: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  total_sales: number;
  total_orders: number;
  notes: string | null;
}

export type CashMovementType = 'open' | 'close' | 'in' | 'out' | 'sale' | 'refund';

export interface CashMovement {
  id: string;
  store_id: string;
  shift_id: string | null;
  type: CashMovementType;
  amount: number;
  note: string | null;
  created_at: string;
}

export type StockMovementType = 'sale' | 'restock' | 'adjust' | 'refund';

export interface StockMovement {
  id: string;
  store_id: string;
  product_id: string | null;
  type: StockMovementType;
  qty_delta: number;
  reason: string | null;
  ref_order_id: string | null;
  created_at: string;
}

export interface LoyaltyTransaction {
  id: string;
  store_id: string;
  customer_id: string;
  points_delta: number;
  reason: string | null;
  ref_order_id: string | null;
  created_at: string;
}

/** Pembatasan hak akses per role, per toko. Hanya bisa mengurangi akses. */
export interface RolePermission {
  id: string;
  store_id: string;
  role: string;
  capability: string;
  enabled: boolean;
  updated_at?: string;
}

export type StockOpnameStatus = 'draft' | 'posted' | 'canceled';

/** Sesi perhitungan stok fisik. */
export interface StockOpname {
  id: string;
  store_id: string;
  status: StockOpnameStatus;
  note: string | null;
  counted_by: string | null;
  started_at: string;
  posted_at: string | null;
  created_at?: string;
}

export interface StockOpnameItem {
  id: string;
  opname_id: string;
  product_id: string;
  /** Stok menurut sistem saat sesi dibuat, dibekukan sebagai pembanding. */
  system_qty: number;
  counted_qty: number | null;
  note: string | null;
}

export type ExpenseCategory =
  | 'sewa'
  | 'gaji'
  | 'listrik_air'
  | 'internet'
  | 'transport'
  | 'pemasaran'
  | 'perlengkapan'
  | 'perawatan'
  | 'pajak_retribusi'
  /** Biaya jasa pihak ketiga saat mengirim uang ke supplier. */
  | 'biaya_admin'
  | 'lainnya';

export type ExpensePaymentMethod = 'cash' | 'transfer' | 'card' | 'ewallet' | 'other';

/**
 * Pengeluaran operasional. Terpisah dari cash_movements: cash_movements
 * mengurus isi laci kasir, expenses mengurus biaya usaha untuk laba rugi.
 * Kalau dibayar tunai dari laci, keduanya ditulis — tapi laporan laba rugi
 * hanya membaca tabel ini supaya tidak dobel hitung.
 */
export interface Expense {
  id: string;
  store_id: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  /** Terisi hanya bila dibayar tunai dari laci shift tertentu. */
  shift_id: string | null;
  created_by: string | null;
  created_at?: string;
}

export interface Supplier {
  id: string;
  store_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Termin default dalam hari; 0 = tunai. Dipakai untuk menyarankan jatuh tempo. */
  default_term_days: number;
  /** Persentase DP default saat membuat nota baru. */
  default_dp_percent: number;
  /** Mata uang default (IDR, USD). */
  currency: string;
  /** Kurs konversi ke Rupiah (misal 1 USD = 16000). */
  exchange_rate: number;
  notes: string | null;
  is_active: boolean;
  created_at?: string;
}

export type PurchaseStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'canceled';
export type PurchasePaymentType = 'dp' | 'settlement' | 'other';
export type PurchasePaymentMethod = 'cash' | 'transfer' | 'card' | 'ewallet' | 'other';

export interface Purchase {
  id: string;
  store_id: string;
  supplier_id: string | null;
  invoice_number: string;
  status: PurchaseStatus;
  order_date: string;
  expected_date: string | null;
  due_date: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  other_cost: number;
  total: number;
  /** Dijaga trigger database dari daftar purchase_payments. */
  paid_amount: number;
  dp_percent: number;
  /** Mata uang nota (IDR, USD). */
  currency: string;
  /** Kurs konversi ke Rupiah (misal 1 USD = 16000). */
  exchange_rate: number;
  received_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at?: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  barcode?: string | null;
  qty: number;
  received_qty: number;
  /** Harga modal dalam IDR (setelah konversi kurs). */
  cost_price: number;
  /** Harga modal asli dalam valuta asing (USD/IDR). */
  original_cost_price?: number;
  currency?: string;
  subtotal: number;
  note: string | null;
}

export interface PurchasePayment {
  id: string;
  store_id: string;
  purchase_id: string;
  type: PurchasePaymentType;
  amount: number;
  method: PurchasePaymentMethod;
  paid_at: string;
  reference: string | null;
  note: string | null;
  created_by: string | null;
  created_at?: string;
}

export interface CartLine {
  product_id: string;
  name: string;
  size: string | null;
  qty: number;
  price: number;
  /** Harga master saat barang dimasukkan, untuk membatalkan penimpaan harga. */
  base_price: number;
  cost_price: number;
  note: string;
  image_url: string | null;
  sku: string | null;
  track_stock: boolean;
}

/** Maps internal product SKU to platform-specific external SKU (Shopee, TikTok, etc.). */
export interface ProductChannelMapping {
  id: string;
  store_id: string;
  product_id: string;
  channel_code: string;
  external_sku: string;
  external_url: string | null;
  is_synced: boolean;
  last_synced_at: string | null;
  created_at?: string;
}

/** Maps supplier catalog items to internal products with supplier-specific SKU and pricing. */
export interface SupplierProductMapping {
  id: string;
  store_id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string;
  supplier_barcode: string | null;
  supplier_product_name: string;
  last_cost_price: number;
  currency: string;
  created_at?: string;
}

/**
 * Retur pesanan. Acuan utamanya `order_number`, bukan id — sesuai permintaan
 * client: retur dicari dan dicocokkan lewat nomor pemesanan.
 */
export interface OrderReturn {
  id: string;
  store_id: string;
  order_id: string | null;
  order_number: string;
  refund_amount: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OrderReturnItem {
  id: string;
  return_id: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  qty: number;
  refund_price: number;
  /** Barang layak jual dikembalikan ke stok; barang rusak tidak. */
  restock: boolean;
  note: string | null;
}

export interface ProductReview {
  id: string;
  store_id: string;
  product_id: string;
  order_id: string | null;
  customer_id: string | null;
  reviewer_name: string;
  rating: number;
  body: string | null;
  images: string[];
  variant_label: string | null;
  is_hidden: boolean;
  seller_reply: string | null;
  replied_at: string | null;
  created_at: string;
  tags: string[];
  helpful_count: number;
}

export interface ProductQuestion {
  id: string;
  store_id: string;
  product_id: string;
  customer_id: string | null;
  asker_name: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  is_hidden: boolean;
  created_at: string;
}
