import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Database,
  DollarSign,
  History,
  LayoutDashboard,
  Percent,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Truck,
  Undo2,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { canAccessRoute, hasCapability, type Capability } from '@/lib/roles';
import type { UserRole } from '@/types';

export type AdminModuleKey =
  | 'overview'
  | 'roles'
  | 'users'
  | 'store-settings'
  | 'categories'
  | 'suppliers'
  | 'customers'
  | 'products'
  | 'stock-mutation'
  | 'stock-opname'
  | 'supplier-purchase'
  | 'supplier-return'
  | 'shift'
  | 'pos'
  | 'transactions'
  | 'customer-return'
  | 'promos'
  | 'expenses'
  | 'sales-report'
  | 'cashier-report'
  | 'profit-report'
  | 'stock-report';

export interface AdminModuleItem {
  key: AdminModuleKey;
  label: string;
  icon: LucideIcon;
  /** Own page. Modules without a route are panels rendered by the Dashboard. */
  route?: string;
  /** Access gate for route-less panels; routed modules reuse the route's gate. */
  capability?: Capability;
  description: string;
  status?: 'ready' | 'planned';
}

export interface AdminModuleSection {
  title: string;
  items: AdminModuleItem[];
}

export const ADMIN_MODULE_SECTIONS: AdminModuleSection[] = [
  {
    title: 'Ringkasan',
    items: [
      {
        key: 'overview',
        label: 'Dashboard',
        icon: LayoutDashboard,
        capability: 'manageStoreSettings',
        description: 'Performa penjualan, kesehatan bisnis, dan aktivitas terbaru.',
      },
    ],
  },
  {
    title: 'Pengaturan Sistem',
    items: [
      { key: 'roles', label: 'Role', icon: ShieldCheck, route: '/users', description: 'Kelola hak akses dan role user.' },
      { key: 'users', label: 'User', icon: UserCog, route: '/users', description: 'Tambah admin gudang, kasir, dan pembeli.' },
      { key: 'store-settings', label: 'Store Settings', icon: SettingsIcon, route: '/settings', description: 'Profil toko, struk, pajak, fitur POS.' },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { key: 'categories', label: 'Category', icon: Tags, route: '/products', description: 'Kategori produk dan menu.' },
      { key: 'suppliers', label: 'Suppliers', icon: Truck, route: '/suppliers', description: 'Database pemasok, termin, dan DP default.' },
      { key: 'customers', label: 'Customers', icon: Users, route: '/customers', description: 'Data pelanggan dan loyalitas.' },
      { key: 'products', label: 'Produk', icon: Boxes, route: '/products', description: 'Produk, barcode, harga beli, harga jual, stok.' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { key: 'stock-mutation', label: 'Mutasi Stok', icon: RotateCcw, capability: 'manageInventory', description: 'Riwayat pergerakan keluar masuk stok.' },
      { key: 'stock-opname', label: 'Stock Opname', icon: ClipboardCheck, capability: 'manageInventory', description: 'Persiapan audit stok fisik.' },
    ],
  },
  {
    title: 'Transaksi Supplier',
    items: [
      { key: 'supplier-purchase', label: 'Pembelian Supplier', icon: ShoppingCart, route: '/purchases', description: 'Nota pembelian, DP, pelunasan, dan terima barang.' },
      { key: 'supplier-return', label: 'Retur Supplier', icon: Undo2, capability: 'managePurchasing', description: 'Pengembalian barang ke supplier.', status: 'planned' },
    ],
  },
  {
    title: 'Penjualan',
    items: [
      { key: 'shift', label: 'Shift Kasir', icon: ClipboardList, route: '/shifts', description: 'Buka/tutup shift dan kas harian.' },
      { key: 'pos', label: 'POS Kasir', icon: ShoppingBag, route: '/menu', description: 'Input pemesanan dan pembayaran.' },
      { key: 'transactions', label: 'Riwayat Transaksi', icon: History, route: '/orders', description: 'Order, status pembayaran, dan struk.' },
      { key: 'customer-return', label: 'Retur Customer', icon: RotateCcw, capability: 'useCashier', description: 'Retur penjualan pelanggan.', status: 'planned' },
      { key: 'promos', label: 'Promo', icon: Percent, route: '/promos', description: 'Diskon, voucher, dan kampanye penjualan.' },
      { key: 'expenses', label: 'Pengeluaran', icon: WalletCards, route: '/shifts', description: 'Cash movement keluar dari shift.' },
    ],
  },
  {
    title: 'Laporan',
    items: [
      { key: 'sales-report', label: 'Laporan Penjualan', icon: BarChart3, route: '/reports', description: 'Ringkasan penjualan dan metode bayar.' },
      { key: 'cashier-report', label: 'Laporan Kasir', icon: UserCog, route: '/reports?tab=cashier', description: 'Performa, shift, dan selisih kas per kasir.' },
      { key: 'profit-report', label: 'Laporan Laba', icon: DollarSign, route: '/reports', description: 'Revenue, HPP, dan laba kotor.' },
      { key: 'stock-report', label: 'Laporan Stok', icon: Database, capability: 'manageInventory', description: 'Nilai modal, status stok, dan pergerakan terakhir.' },
    ],
  },
];

const ALL_MODULES = ADMIN_MODULE_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({ item, section: section.title })),
);

export function findModule(key: string | null | undefined): AdminModuleItem | null {
  if (!key) return null;
  return ALL_MODULES.find((entry) => entry.item.key === key)?.item ?? null;
}

export function sectionTitleFor(key: AdminModuleKey): string {
  return ALL_MODULES.find((entry) => entry.item.key === key)?.section ?? 'Admin Console';
}

/**
 * Where clicking a module goes. Route-less modules are Dashboard panels, so they
 * live on `/` behind a `?module=` marker instead of a route of their own.
 */
export function pathForModule(item: AdminModuleItem): string {
  return item.route ?? `/?module=${item.key}`;
}

/**
 * Which sidebar entry the current URL represents.
 *
 * Several modules deliberately share one page (Role/User both open `/users`), so
 * the last explicitly clicked module breaks the tie. It only wins when its own
 * route still matches the URL — arriving at `/reports` from the top nav must not
 * keep "Laporan Kasir" (`/reports?tab=cashier`) highlighted.
 */
export function resolveActiveModule(
  pathname: string,
  search: string,
  remembered: AdminModuleKey | null,
): AdminModuleKey | null {
  const current = normalizePath(pathname);

  if (current === '/') {
    const requested = findModule(new URLSearchParams(search).get('module'));
    if (requested && !requested.route) return requested.key;
    return 'overview';
  }

  const candidates = ALL_MODULES.map((entry) => entry.item).filter(
    (item) => item.route && normalizePath(routePathname(item.route)) === current,
  );
  if (candidates.length === 0) return null;

  const full = `${current}${search}`;
  const matchesFull = (item: AdminModuleItem) => normalizeFullRoute(item.route ?? '') === full;

  const rememberedItem = candidates.find((item) => item.key === remembered);
  if (rememberedItem && matchesFull(rememberedItem)) return rememberedItem.key;

  const exact = candidates.find(matchesFull);
  if (exact) return exact.key;

  return rememberedItem?.key ?? candidates[0].key;
}

/** Drops modules the role cannot open, then drops sections left empty. */
export function sectionsForRole(role: UserRole | string | null | undefined): AdminModuleSection[] {
  return ADMIN_MODULE_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) =>
      item.route
        ? canAccessRoute(role, routePathname(item.route))
        : hasCapability(role, item.capability ?? 'manageStoreSettings'),
    ),
  })).filter((section) => section.items.length > 0);
}

export function filterSections(sections: AdminModuleSection[], query: string): AdminModuleSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        `${item.label} ${section.title} ${item.description}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

function routePathname(route: string): string {
  return route.split('?')[0];
}

function normalizeFullRoute(route: string): string {
  const [pathname, query] = route.split('?');
  return `${normalizePath(pathname)}${query ? `?${query}` : ''}`;
}

function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  return path.replace(/\/+$/, '');
}
