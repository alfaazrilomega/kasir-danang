import { useEffect, useRef } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShoppingBag,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import { cn } from '@/lib/format';
import type { AdminModuleKey, AdminModuleSection } from '@/lib/adminModules';

/**
 * Full-height admin navigation. Renders as a fixed rail on desktop (collapsible to
 * icons only) and as a slide-in drawer on mobile, where `onClose` is provided.
 */
export function AdminSidebar({
  sections,
  activeModule,
  onSelect,
  collapsed,
  onToggleCollapse,
  query,
  onQueryChange,
  storeName,
  userName,
  roleName,
  onNavigate,
  onClose,
  className,
}: {
  sections: AdminModuleSection[];
  activeModule: AdminModuleKey | null;
  onSelect: (key: AdminModuleKey) => void;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  storeName: string;
  userName: string;
  roleName: string;
  onNavigate: (path: string) => void;
  onClose?: () => void;
  className?: string;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Keep the selected module visible when the nav is long or restored from storage.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeModule, collapsed]);

  return (
    <aside
      className={cn(
        // Carries the brand accent, so switching accent in Settings recolours the
        // rail too. Dark mode drops to the deepest brand shade: still clearly
        // purple, but light enough against the ink-950 workspace to keep its edge.
        'flex h-full shrink-0 flex-col border-r border-black/10 bg-brand-600 text-white transition-[width] duration-200 dark:border-white/10 dark:bg-brand-950',
        collapsed ? 'w-[76px]' : 'w-[264px]',
        className,
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 border-b border-white/15 px-2 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand-700">
            <StoreIcon size={17} />
          </span>
          <button
            onClick={onToggleCollapse}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/75 transition hover:bg-white/15 hover:text-white"
            title="Perlebar sidebar"
            aria-label="Perlebar sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 border-b border-white/15 px-3 py-3.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
            <StoreIcon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/65">
              Admin Console
            </div>
            <div className="truncate text-sm font-bold">{storeName}</div>
          </div>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="hidden h-8 w-8 place-items-center rounded-lg text-white/75 transition hover:bg-white/15 hover:text-white lg:grid"
              title="Ciutkan sidebar"
              aria-label="Ciutkan sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              autoFocus
              className="grid h-8 w-8 place-items-center rounded-lg text-white/75 transition hover:bg-white/15 hover:text-white lg:hidden"
              aria-label="Tutup menu admin"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {collapsed ? (
        <button
          onClick={onToggleCollapse}
          className="mx-auto mt-3 grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-white/80 transition hover:bg-white/25 hover:text-white"
          title="Cari modul"
          aria-label="Cari modul"
        >
          <Search size={15} />
        </button>
      ) : (
        <div className="border-b border-white/15 px-3 py-3">
          <label className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 focus-within:bg-white/25">
            <Search size={14} className="shrink-0 text-white/60" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  onQueryChange('');
                  return;
                }
                if (event.key !== 'Enter') return;
                const first = sections[0]?.items[0];
                if (first) onSelect(first.key);
              }}
              placeholder="Cari modul..."
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/60 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => onQueryChange('')}
                className="shrink-0 text-white/60 transition hover:text-white"
                aria-label="Hapus pencarian"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        {sections.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-white/70">Modul tidak ditemukan.</p>
        )}
        {sections.map((section) => (
          <div key={section.title}>
            {collapsed ? (
              <div className="mx-3 my-2 h-px bg-white/15" />
            ) : (
              <div className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">
                {section.title}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const selected = item.key === activeModule;
                return (
                  <button
                    key={item.key}
                    ref={selected ? activeRef : undefined}
                    onClick={() => onSelect(item.key)}
                    aria-current={selected ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl text-left text-sm font-medium transition',
                      collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                      selected
                        ? 'bg-white text-brand-700 shadow-sm dark:text-brand-800'
                        : 'text-white/85 hover:bg-white/15 hover:text-white',
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.status === 'planned' && (
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
                              selected ? 'bg-brand-600/10 text-brand-700' : 'bg-white/20 text-white/75',
                            )}
                          >
                            Soon
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-white/15 p-3', collapsed && 'px-2')}>
        {collapsed ? (
          <button
            onClick={() => onNavigate('/menu')}
            className="grid h-10 w-full place-items-center rounded-xl bg-white/15 text-white transition hover:bg-white/25"
            title="Buka POS Kasir"
            aria-label="Buka POS Kasir"
          >
            <ShoppingBag size={16} />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-brand-700">
                {userName.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{userName}</div>
                <div className="truncate text-[10px] uppercase tracking-wide text-white/65">
                  {roleName}
                </div>
              </div>
            </div>
            <button
              onClick={() => onNavigate('/menu')}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25"
            >
              <ShoppingBag size={14} /> Buka POS Kasir
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
