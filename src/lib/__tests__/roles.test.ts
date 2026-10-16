import { beforeEach, describe, expect, it } from 'vitest';
import {
  canAccessRoute,
  capabilitiesForRole,
  defaultCapabilitiesForRole,
  defaultRouteForRole,
  hasCapability,
  navItemsForRole,
  normalizeRole,
  setCapabilityOverrides,
} from '@/lib/roles';

beforeEach(() => {
  // Override disimpan di level modul; bersihkan supaya tes tidak saling bocor.
  setCapabilityOverrides([]);
});

describe('normalizeRole', () => {
  it('memetakan role manager lama ke admin', () => {
    expect(normalizeRole('manager')).toBe('admin');
  });

  it('role tak dikenal jatuh ke cashier, bukan admin', () => {
    // Default harus yang paling sedikit haknya.
    expect(normalizeRole('sesuatu')).toBe('cashier');
    expect(normalizeRole(null)).toBe('cashier');
  });
});

describe('hasCapability', () => {
  it('mengikuti matriks bawaan', () => {
    expect(hasCapability('admin', 'manageUsers')).toBe(true);
    expect(hasCapability('cashier', 'manageUsers')).toBe(false);
    expect(hasCapability('warehouse', 'manageInventory')).toBe(true);
    expect(hasCapability('warehouse', 'useCashier')).toBe(false);
  });

  it('override bisa MEMATIKAN capability', () => {
    setCapabilityOverrides([
      { role: 'admin', capability: 'manageCustomers', enabled: false },
    ]);
    expect(hasCapability('admin', 'manageCustomers')).toBe(false);
    // Capability lain tidak ikut terpengaruh.
    expect(hasCapability('admin', 'manageInventory')).toBe(true);
  });

  it('override TIDAK BISA memberi capability di luar hak bawaan', () => {
    // Aturan keamanan inti: pengaturan toko hanya boleh mengurangi.
    setCapabilityOverrides([
      { role: 'cashier', capability: 'manageUsers', enabled: true },
    ]);
    expect(hasCapability('cashier', 'manageUsers')).toBe(false);
  });

  it('baris enabled=true tidak mematikan apa pun', () => {
    setCapabilityOverrides([{ role: 'admin', capability: 'manageUsers', enabled: true }]);
    expect(hasCapability('admin', 'manageUsers')).toBe(true);
  });

  it('override satu role tidak bocor ke role lain', () => {
    setCapabilityOverrides([{ role: 'cashier', capability: 'useCashier', enabled: false }]);
    expect(hasCapability('cashier', 'useCashier')).toBe(false);
    expect(hasCapability('admin', 'useCashier')).toBe(true);
  });
});

describe('capabilitiesForRole', () => {
  it('membuang yang dimatikan, sedangkan default tetap utuh', () => {
    const sebelum = capabilitiesForRole('admin').length;
    setCapabilityOverrides([{ role: 'admin', capability: 'managePromos', enabled: false }]);
    expect(capabilitiesForRole('admin')).toHaveLength(sebelum - 1);
    expect(defaultCapabilitiesForRole('admin')).toHaveLength(sebelum);
  });
});

describe('canAccessRoute', () => {
  it('menutup rute saat capability-nya dimatikan', () => {
    expect(canAccessRoute('admin', '/expenses')).toBe(true);
    setCapabilityOverrides([{ role: 'admin', capability: 'manageExpenses', enabled: false }]);
    expect(canAccessRoute('admin', '/expenses')).toBe(false);
  });

  it('gudang tidak bisa membuka rute kasir', () => {
    expect(canAccessRoute('warehouse', '/menu')).toBe(false);
    expect(canAccessRoute('warehouse', '/products')).toBe(true);
  });

  it('stock opname butuh manageInventory', () => {
    expect(canAccessRoute('warehouse', '/stock-opname')).toBe(true);
    expect(canAccessRoute('cashier', '/stock-opname')).toBe(false);
  });
});

describe('navItemsForRole', () => {
  it('menu ikut hilang saat capability dimatikan', () => {
    const sebelum = navItemsForRole('admin').some((i) => i.to === '/expenses');
    expect(sebelum).toBe(true);
    setCapabilityOverrides([{ role: 'admin', capability: 'manageExpenses', enabled: false }]);
    expect(navItemsForRole('admin').some((i) => i.to === '/expenses')).toBe(false);
  });
});

describe('defaultRouteForRole', () => {
  it('mengarahkan tiap role ke halaman yang bisa dibuka', () => {
    expect(defaultRouteForRole('warehouse')).toBe('/products');
    expect(defaultRouteForRole('cashier')).toBe('/menu');
    expect(defaultRouteForRole('customer')).toBe('/customer');
    expect(defaultRouteForRole('admin')).toBe('/');
  });
});
