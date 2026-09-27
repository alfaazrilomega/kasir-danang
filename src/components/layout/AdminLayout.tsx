import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { useLocation, useNavigate } from '@/lib/router';
import { AppShell } from '@/components/layout/AppShell';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { NavActions } from '@/components/layout/NavActions';
import { useAuth } from '@/stores/auth';
import { normalizeRole, roleLabel } from '@/lib/roles';
import {
  filterSections,
  findModule,
  pathForModule,
  resolveActiveModule,
  sectionsForRole,
  sectionTitleFor,
  type AdminModuleKey,
} from '@/lib/adminModules';

const SIDEBAR_PREF_KEY = 'kasir.admin.sidebar.v1';

/** Roles that work out of the console. Cashier/customer keep the plain shell. */
const CONSOLE_ROLES = new Set(['admin', 'warehouse']);

/** Lets a page hang its own controls in the console header bar. */
const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function AdminHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}

/** Remembers the rail state and the last opened module across reloads. */
function readSidebarPref(): { collapsed: boolean; module: AdminModuleKey | null } {
  try {
    const raw = localStorage.getItem(SIDEBAR_PREF_KEY);
    if (!raw) return { collapsed: false, module: null };
    const parsed = JSON.parse(raw) as { collapsed?: unknown; module?: unknown };
    return {
      collapsed: parsed.collapsed === true,
      module: findModule(parsed.module as string)?.key ?? null,
    };
  } catch {
    return { collapsed: false, module: null };
  }
}

/**
 * The persistent admin console: the module rail stays mounted while the content
 * column swaps per route, so navigating away from the dashboard no longer drops
 * the sidebar.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, store } = useAuth();
  const [pref] = useState(readSidebarPref);
  const [collapsed, setCollapsed] = useState(pref.collapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remembered, setRemembered] = useState<AdminModuleKey | null>(pref.module);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const roleSections = useMemo(() => sectionsForRole(profile?.role), [profile?.role]);
  const sections = useMemo(() => filterSections(roleSections, query), [roleSections, query]);
  const activeModule = useMemo(
    () => resolveActiveModule(location.pathname, location.search, remembered),
    [location.pathname, location.search, remembered],
  );
  const enabled = CONSOLE_ROLES.has(normalizeRole(profile?.role)) && roleSections.length > 0;

  const selectModule = useCallback(
    (key: AdminModuleKey) => {
      const item = findModule(key);
      if (!item) return;
      setRemembered(key);
      setDrawerOpen(false);
      navigate(pathForModule(item));
    },
    [navigate],
  );

  const toggleCollapse = useCallback(() => {
    setCollapsed((value) => !value);
    setQuery('');
  }, []);

  // Close the mobile drawer with Escape, and whenever we grow back to desktop.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = () => media.matches && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    media.addEventListener('change', onChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onChange);
    };
  }, [drawerOpen]);

  // Ctrl/Cmd+B collapses the rail, the same shortcut editors use.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, toggleCollapse]);

  // Each page is its own view: start it at the top instead of inheriting the
  // scroll offset of the previous one.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname, location.search]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_PREF_KEY,
        JSON.stringify({ collapsed, module: activeModule }),
      );
    } catch {
      // Storage can be unavailable (private mode); the layout still works.
    }
  }, [activeModule, collapsed]);

  if (!enabled) return <AppShell>{children}</AppShell>;

  const sidebarProps = {
    sections,
    activeModule,
    onSelect: selectModule,
    query,
    onQueryChange: setQuery,
    storeName: store?.name ?? 'TokoKu',
    userName: profile?.full_name ?? profile?.email ?? 'Admin',
    roleName: roleLabel(profile?.role),
    onNavigate: navigate,
  };

  const active = activeModule ? findModule(activeModule) : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden supports-[height:100dvh]:h-[100dvh]">
      {/* No TopNav here: the rail replaces its links, and its account/alert
          controls move into the console header below. The row deliberately does
          not clip overflow so those dropdowns can hang over the content. */}
      <div className="flex min-h-0 w-full flex-1 bg-ink-50 dark:bg-ink-950">
        <AdminSidebar
          {...sidebarProps}
          className="hidden lg:flex"
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />

        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            <AdminSidebar
              {...sidebarProps}
              className="absolute inset-y-0 left-0 shadow-2xl"
              collapsed={false}
              onClose={() => setDrawerOpen(false)}
            />
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* flex-wrap: di layar 393px kontrol milik halaman cuma kebagian 42px
              dari 287px yang dibutuhkan, jadi penyaring periode Dasbor terbaca
              "Har" saja. Di bawah lg kontrolnya turun ke baris sendiri selebar
              layar; dari lg ke atas tetap satu baris seperti semula. */}
          <header className="relative z-30 flex flex-wrap items-center gap-3 border-b border-ink-100 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900 md:px-6 lg:flex-nowrap">
            <button
              onClick={() => setDrawerOpen(true)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700 lg:hidden dark:bg-ink-800 dark:text-ink-200"
              aria-label="Buka menu admin"
            >
              <MenuIcon size={17} />
            </button>

            {/* min-w: judul halaman tidak boleh menyusut sampai hilang ketika
                kontrol halaman ikut berebut tempat di layar sempit. Satuannya
                piksel — huruf dasar aplikasi 14px, jadi 6rem cuma 84px. Di layar
                lebar judulnya boleh lega karena kontrol sudah muat seluruhnya. */}
            <div className="min-w-[112px] flex-1 lg:min-w-[220px]">
              <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                <span className="hidden sm:inline">Admin Console</span>
                <ChevronRight size={11} className="hidden sm:inline" />
                <span className="truncate">
                  {activeModule ? sectionTitleFor(activeModule) : 'Halaman'}
                </span>
              </div>
              <h1 className="truncate text-lg font-bold md:text-xl">{active?.label ?? 'TokoKu'}</h1>
            </div>

            {/* The divider only earns its place when the page actually put
                controls in the slot, so `:empty` drives it rather than state.

                Kontrol milik halaman boleh menyusut dan digulir mendatar: di
                layar 393px penyaring periode Dasbor selebar 287px mendorong
                lonceng dan avatar keluar layar, dan cangkang admin memotongnya
                (overflow-hidden), sehingga akun tidak bisa dibuka sama sekali. */}
            <div
              ref={setHeaderSlot}
              /* Bilah gulir disembunyikan, jadi tepi kanan dibuat memudar sebagai
                 tanda masih ada kontrol lain di sebelahnya. Di layar lebar tidak
                 ada yang tersembunyi, jadi tanpa efek. */
              className="peer tanpa-bilah order-last flex w-full min-w-0 shrink items-center gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-18px),transparent)] empty:hidden lg:order-none lg:w-auto lg:[mask-image:none]"
            />
            {/* Pemisah ini memisahkan kontrol halaman dari tombol akun. Di
                bawah lg kontrolnya sudah pindah ke baris sendiri, jadi garis
                ini tidak memisahkan apa pun dan ikut disembunyikan. */}
            <div className="ml-1 hidden h-7 w-px shrink-0 bg-ink-200 dark:bg-ink-700 lg:peer-[:not(:empty)]:block" />
            <NavActions tone="surface" />
          </header>

          <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin md:p-6">
            <div className="mx-auto w-full max-w-[1400px]">
              <HeaderSlotContext.Provider value={headerSlot}>{children}</HeaderSlotContext.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
