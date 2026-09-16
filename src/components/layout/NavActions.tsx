import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Lock,
  LogOut,
  Moon,
  PackageOpen,
  PanelTopClose,
  PanelTopOpen,
  RefreshCcw,
  Settings as SettingsIcon,
  ShoppingBag,
  Store,
  Sun,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from '@/lib/router';
import { useAuth } from '@/stores/auth';
import { usePinLock } from '@/stores/pinLock';
import { useUI } from '@/stores/ui';
import { usePwaInstall } from '@/lib/pwaInstall';
import { pendingCount } from '@/lib/sync';
import { db } from '@/lib/db';
import { cn } from '@/lib/format';
import { hasCapability, roleLabel } from '@/lib/roles';

type MenuKey = 'profile' | 'notifications' | null;

/**
 * `brand` sits on the purple TopNav, `surface` on the light/dark console header.
 * Only the trigger chrome changes — the dropdown panels are surface-coloured in
 * both cases.
 */
export type NavActionsTone = 'brand' | 'surface';

interface Notice {
  id: string;
  tone: 'info' | 'warning' | 'danger';
  icon: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Account, notifications, theme, and install controls. Shared so the admin
 * console can drop the TopNav without losing sign-out or alerts.
 */
export function NavActions({
  tone = 'brand',
  showAutoHideToggle = false,
  onOpenChange,
}: {
  tone?: NavActionsTone;
  showAutoHideToggle?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { profile, store, signOut } = useAuth();
  const { theme, setTheme, toggleTheme, navAutoHide, toggleNavAutoHide } = useUI();
  const { canInstall, promptInstall } = usePwaInstall();
  const pinEnabled = usePinLock((s) => s.pinEnabled);
  const lockApp = usePinLock((s) => s.lock);
  const navigate = useNavigate();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const brand = tone === 'brand';
  const canSeeInventory = hasCapability(profile?.role, 'manageInventory');
  const canOpenSettings =
    hasCapability(profile?.role, 'manageStoreSettings') ||
    hasCapability(profile?.role, 'manageInventory') ||
    hasCapability(profile?.role, 'useCashier');
  const canOpenShifts = hasCapability(profile?.role, 'manageShifts');
  const canSeeWebOrders = hasCapability(profile?.role, 'useCashier');

  useEffect(() => {
    onOpenChange?.(openMenu !== null);
  }, [openMenu, onOpenChange]);

  const lowStockCount =
    useLiveQuery(async () => {
      if (!profile?.store_id || !canSeeInventory) return 0;
      const prods = await db.products.where('store_id').equals(profile.store_id).toArray();
      return prods.filter(
        (p) => p.track_stock && Number(p.stock_qty ?? 0) <= Number(p.min_stock ?? 0),
      ).length;
    }, [canSeeInventory, profile?.store_id]) ?? 0;

  // Pesanan dari storefront publik menunggu konfirmasi — lihat Orders.tsx tab
  // "Pesanan Website". Admin dan kasir sama-sama harus melihat ini.
  const webOrderCount =
    useLiveQuery(async () => {
      if (!profile?.store_id || !canSeeWebOrders) return 0;
      return db.orders
        .where('store_id')
        .equals(profile.store_id)
        .filter((o) => o.order_status === 'awaiting_confirmation')
        .count();
    }, [canSeeWebOrders, profile?.store_id]) ?? 0;

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const t = setInterval(async () => setPending(await pendingCount()), 4000);
    pendingCount().then(setPending);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  async function installDesktopApp() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast.success('Aplikasi terpasang di desktop.');
    } else if (outcome === 'dismissed') {
      toast.message('Install dibatalkan.');
    } else {
      toast.message('Install belum tersedia dari browser ini.');
    }
  }

  const notices: Notice[] = useMemo(() => {
    const out: Notice[] = [];
    if (!online) {
      out.push({
        id: 'offline',
        tone: 'warning',
        icon: <WifiOff size={14} />,
        title: 'Tidak ada koneksi',
        description: 'Order tetap tersimpan lokal dan akan disinkronkan saat online kembali.',
      });
    }
    if (pending > 0) {
      out.push({
        id: 'pending',
        tone: 'info',
        icon: <RefreshCcw size={14} />,
        title: `${pending} pesanan menunggu sync`,
        description: 'Buka Settings untuk menyinkronkan sekarang.',
        action: {
          label: 'Buka Settings',
          onClick: () => {
            setOpenMenu(null);
            navigate('/settings');
          },
        },
      });
    }
    if (canSeeWebOrders && webOrderCount > 0) {
      out.push({
        id: 'weborders',
        tone: 'info',
        icon: <ShoppingBag size={14} />,
        title: `${webOrderCount} pesanan website menunggu konfirmasi`,
        description: 'Buka Orders untuk konfirmasi atau tolak.',
        action: {
          label: 'Buka Orders',
          onClick: () => {
            setOpenMenu(null);
            navigate('/orders');
          },
        },
      });
    }
    if (canSeeInventory && lowStockCount > 0) {
      out.push({
        id: 'lowstock',
        tone: 'danger',
        icon: <PackageOpen size={14} />,
        title: `${lowStockCount} produk stok menipis`,
        description: 'Periksa daftar Products untuk restock.',
        action: {
          label: 'Lihat produk',
          onClick: () => {
            setOpenMenu(null);
            navigate('/products');
          },
        },
      });
    }
    return out;
  }, [canSeeInventory, canSeeWebOrders, online, pending, lowStockCount, webOrderCount, navigate]);

  const initial = (profile?.full_name ?? profile?.email ?? 'U').charAt(0).toUpperCase();
  const iconButton = brand
    ? 'hover:bg-white/10'
    : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800';

  return (
    <div className="flex shrink-0 items-center gap-1.5" ref={dropdownRef}>
      {canInstall && (
        <button
          onClick={installDesktopApp}
          className={cn(
            'hidden h-9 w-9 place-items-center rounded-full transition sm:grid',
            brand ? 'bg-white/10 hover:bg-white/20' : iconButton,
          )}
          aria-label="Install aplikasi di desktop"
          title="Install aplikasi di desktop"
        >
          <Download size={18} />
        </button>
      )}

      <button
        onClick={toggleTheme}
        className={cn('relative grid h-9 w-9 place-items-center rounded-full transition', iconButton)}
        aria-label={theme === 'light' ? 'Aktifkan dark mode' : 'Aktifkan light mode'}
        title={theme === 'light' ? 'Aktifkan dark mode' : 'Aktifkan light mode'}
      >
        <Moon
          size={18}
          className={cn(
            'absolute transition-all duration-300',
            theme === 'light' ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50',
          )}
        />
        <Sun
          size={18}
          className={cn(
            'absolute transition-all duration-300',
            theme === 'dark' ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50',
          )}
        />
      </button>

      {showAutoHideToggle && (
        <button
          onClick={toggleNavAutoHide}
          className={cn('hidden h-9 w-9 place-items-center rounded-full transition md:grid', iconButton)}
          aria-label={navAutoHide ? 'Pin menu (selalu tampil)' : 'Sembunyikan menu otomatis'}
          title={
            navAutoHide
              ? 'Pin menu — selalu tampil'
              : 'Auto-hide — arahkan kursor ke atas untuk memunculkan'
          }
          aria-pressed={navAutoHide}
        >
          {navAutoHide ? <PanelTopOpen size={18} /> : <PanelTopClose size={18} />}
        </button>
      )}

      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'notifications' ? null : 'notifications')}
          className={cn('relative grid h-9 w-9 place-items-center rounded-full transition', iconButton)}
          aria-label="Notifikasi"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'notifications'}
        >
          <Bell size={18} />
          {notices.length > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2',
                brand ? 'ring-brand-600' : 'ring-white dark:ring-ink-900',
              )}
            >
              {notices.length > 9 ? '9+' : notices.length}
            </span>
          )}
        </button>
        {openMenu === 'notifications' && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl bg-white text-ink-800 shadow-xl shadow-black/20 dark:bg-ink-900 dark:text-ink-100 ring-1 ring-black/5 dark:ring-white/10"
          >
            <div className="flex items-center justify-between border-b border-ink-100 dark:border-ink-800 px-4 py-3">
              <div>
                <div className="text-sm font-semibold">Notifikasi</div>
                <div className="text-[11px] text-ink-500">
                  {notices.length === 0 ? 'Tidak ada peringatan' : `${notices.length} perlu perhatian`}
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex h-7 w-7 place-items-center rounded-full',
                  online
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15'
                    : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15',
                )}
                title={online ? 'Online' : 'Offline'}
              >
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full',
                    online ? 'bg-emerald-500' : 'bg-rose-500',
                  )}
                />
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15">
                    <CheckCircle2 size={20} />
                  </div>
                  <div className="text-sm font-semibold">Semua aman</div>
                  <div className="text-xs text-ink-500">
                    Tidak ada offline, stok menipis, atau pesanan tertunda.
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {notices.map((n) => (
                    <li key={n.id} className="px-4 py-3 flex items-start gap-3">
                      <span
                        className={cn(
                          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                          n.tone === 'info' &&
                            'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
                          n.tone === 'warning' &&
                            'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
                          n.tone === 'danger' &&
                            'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
                        )}
                      >
                        {n.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{n.title}</div>
                        <div className="text-[11px] text-ink-500">{n.description}</div>
                        {n.action && (
                          <button
                            onClick={n.action.onClick}
                            className="mt-1 text-[11px] font-semibold text-brand-600 hover:underline"
                          >
                            {n.action.label} →
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === 'profile' ? null : 'profile')}
          className={cn(
            'flex items-center gap-2 rounded-full px-2 py-1.5 transition',
            brand
              ? 'bg-white/10 hover:bg-white/20'
              : 'bg-ink-100 hover:bg-ink-200 dark:bg-ink-800 dark:hover:bg-ink-700',
          )}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'profile'}
        >
          <div
            className={cn(
              'grid h-7 w-7 place-items-center rounded-full font-semibold',
              brand ? 'bg-white text-brand-700' : 'bg-brand-600 text-white',
            )}
          >
            {initial}
          </div>
          <div className="hidden md:block text-left leading-tight pr-1">
            <div className="text-xs font-semibold">{profile?.full_name ?? 'User'}</div>
            <div className={cn('text-[10px]', brand ? 'opacity-70' : 'text-ink-500')}>
              {roleLabel(profile?.role)}
            </div>
          </div>
          <ChevronDown
            size={14}
            className={cn('transition-transform', openMenu === 'profile' && 'rotate-180')}
          />
        </button>
        {openMenu === 'profile' && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl bg-white text-ink-800 shadow-xl shadow-black/20 dark:bg-ink-900 dark:text-ink-100 ring-1 ring-black/5 dark:ring-white/10"
          >
            <div className="bg-gradient-to-br from-brand-50 to-white px-4 py-4 dark:from-brand-950/40 dark:to-ink-900">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-600 text-white text-lg font-bold">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{profile?.full_name ?? 'User'}</div>
                  <div className="truncate text-[11px] text-ink-500">{profile?.email ?? '—'}</div>
                </div>
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                  {roleLabel(profile?.role)}
                </span>
              </div>
              {store?.name && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px] dark:bg-ink-950/40">
                  <Store size={12} className="text-brand-600" />
                  <span className="truncate font-medium">{store.name}</span>
                </div>
              )}
            </div>

            <div className="border-t border-ink-100 px-3 py-2 dark:border-ink-800">
              <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                Tampilan
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition',
                    theme === 'light'
                      ? 'bg-white text-ink-900 shadow-sm'
                      : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-200',
                  )}
                >
                  <Sun size={12} /> Light
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition',
                    theme === 'dark'
                      ? 'bg-ink-950 text-white shadow-sm'
                      : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-200',
                  )}
                >
                  <Moon size={12} /> Dark
                </button>
              </div>
            </div>

            <div className="border-t border-ink-100 py-1 dark:border-ink-800">
              {canOpenSettings && (
                <MenuItem
                  icon={<SettingsIcon size={14} />}
                  label="Pengaturan"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate('/settings');
                  }}
                />
              )}
              {canOpenShifts && (
                <MenuItem
                  icon={<Clock size={14} />}
                  label="Shift saya"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate('/shifts');
                  }}
                />
              )}
              {pinEnabled && (
                <MenuItem
                  icon={<Lock size={14} />}
                  label="Kunci aplikasi"
                  onClick={() => {
                    setOpenMenu(null);
                    lockApp();
                  }}
                />
              )}
              {canOpenSettings && (
                <MenuItem
                  icon={<UserRound size={14} />}
                  label="Akun & profil"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate('/settings');
                  }}
                />
              )}
            </div>
            <div className="border-t border-ink-100 py-1 dark:border-ink-800">
              <button
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                onClick={async () => {
                  setOpenMenu(null);
                  await signOut();
                  navigate('/login');
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
    >
      <span className="text-ink-500">{icon}</span>
      {label}
    </button>
  );
}
