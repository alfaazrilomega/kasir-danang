import {
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Percent,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@/types';

export type EffectiveRole = 'admin' | 'warehouse' | 'cashier' | 'customer';
export type Capability =
  | 'manageUsers'
  | 'manageStoreSettings'
  | 'manageInventory'
  | 'managePurchasing'
  | 'managePromos'
  | 'useCashier'
  | 'manageCustomers'
  | 'manageShifts'
  | 'viewSalesReports'
  | 'viewCustomerPortal';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  warehouse: 'Admin Gudang',
  cashier: 'Kasir',
  customer: 'Pembeli',
};

export const ADMIN_ROLE_OPTIONS: EffectiveRole[] = ['admin', 'warehouse', 'cashier', 'customer'];

export const ROLE_DESCRIPTIONS: Record<EffectiveRole, string> = {
  admin: 'Kontrol penuh: user, pengaturan, inventory, kasir, laporan, dan promo.',
  warehouse: 'Mengelola master produk, kategori, mutasi stok, dan opname.',
  cashier: 'Membuka shift, input pemesanan, retur customer, dan laporan kasir.',
  customer: 'Akses katalog pembeli tanpa fitur operasional toko.',
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  manageUsers: 'User & role',
  manageStoreSettings: 'Pengaturan toko',
  manageInventory: 'Gudang & stok',
  managePurchasing: 'Supplier & pembelian',
  managePromos: 'Promo',
  useCashier: 'POS kasir',
  manageCustomers: 'Customer',
  manageShifts: 'Shift kasir',
  viewSalesReports: 'Laporan',
  viewCustomerPortal: 'Katalog pembeli',
};

const ROLE_CAPABILITIES: Record<EffectiveRole, Capability[]> = {
  admin: [
    'manageUsers',
    'manageStoreSettings',
    'manageInventory',
    'managePurchasing',
    'managePromos',
    'useCashier',
    'manageCustomers',
    'manageShifts',
    'viewSalesReports',
  ],
  warehouse: ['manageInventory', 'managePurchasing'],
  cashier: ['useCashier', 'manageCustomers', 'manageShifts', 'viewSalesReports'],
  customer: ['viewCustomerPortal'],
};

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/menu', label: 'Kasir', icon: ShoppingCart },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/products', label: 'Gudang', icon: Boxes },
  { to: '/suppliers', label: 'Supplier', icon: Truck },
  { to: '/purchases', label: 'Pembelian', icon: ShoppingBag },
  { to: '/promos', label: 'Promos', icon: Percent },
  { to: '/shifts', label: 'Shifts', icon: WalletCards },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/users', label: 'Users', icon: UserCog },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/customer', label: 'Katalog', icon: Store },
];

const ROUTE_CAPABILITIES: Record<string, Capability[]> = {
  '/': ['manageStoreSettings'],
  '/menu': ['useCashier'],
  '/orders': ['useCashier'],
  '/customers': ['manageCustomers'],
  '/products': ['manageInventory'],
  '/suppliers': ['managePurchasing'],
  '/purchases': ['managePurchasing'],
  '/promos': ['managePromos'],
  '/shifts': ['manageShifts'],
  '/reports': ['viewSalesReports'],
  '/users': ['manageUsers'],
  '/settings': ['manageStoreSettings', 'manageInventory', 'useCashier'],
  '/customer': ['viewCustomerPortal'],
};

export function normalizeRole(role: UserRole | string | null | undefined): EffectiveRole {
  if (role === 'manager') return 'admin';
  if (role === 'warehouse' || role === 'cashier' || role === 'customer' || role === 'admin') {
    return role;
  }
  return 'cashier';
}

export function roleLabel(role: UserRole | string | null | undefined): string {
  if (role && role in ROLE_LABELS) return ROLE_LABELS[role as UserRole];
  return ROLE_LABELS[normalizeRole(role)];
}

export function hasCapability(
  role: UserRole | string | null | undefined,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[normalizeRole(role)].includes(capability);
}

export function capabilitiesForRole(role: UserRole | string | null | undefined): Capability[] {
  return [...ROLE_CAPABILITIES[normalizeRole(role)]];
}

export function canAccessRoute(role: UserRole | string | null | undefined, path: string): boolean {
  const base = routeBase(path);
  const required = ROUTE_CAPABILITIES[base];
  if (!required) return true;
  return required.some((capability) => hasCapability(role, capability));
}

export function defaultRouteForRole(role: UserRole | string | null | undefined): string {
  const normalized = normalizeRole(role);
  if (normalized === 'warehouse') return '/products';
  if (normalized === 'cashier') return '/menu';
  if (normalized === 'customer') return '/customer';
  return '/';
}

export function navItemsForRole(role: UserRole | string | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => canAccessRoute(role, item.to));
}

function routeBase(path: string): string {
  if (path === '/') return '/';
  const [, first] = path.split('/');
  return first ? `/${first}` : '/';
}
