import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from '@/lib/router';
import { Store } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useUI } from '@/stores/ui';
import { cn } from '@/lib/format';
import { navItemsForRole } from '@/lib/roles';
import { NavActions } from '@/components/layout/NavActions';

export function TopNav() {
  const { profile, store } = useAuth();
  const { navAutoHide } = useUI();
  const [revealed, setRevealed] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const links = useMemo(() => navItemsForRole(profile?.role), [profile?.role]);
  const handleMenuOpenChange = useCallback((open: boolean) => setMenuOpen(open), []);

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const scheduleHide = (delay = 350) => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setRevealed(false), delay);
  };
  const showNav = () => {
    cancelHide();
    setRevealed(true);
  };

  useEffect(() => {
    if (!navAutoHide) {
      cancelHide();
      setRevealed(true);
      return;
    }
    // When auto-hide turns on, give the user ~1.5s to move their cursor before hiding.
    scheduleHide(1500);
    return cancelHide;
  }, [navAutoHide]);

  useEffect(() => {
    if (menuOpen) {
      showNav();
    } else if (navAutoHide) {
      scheduleHide(600);
    }
  }, [menuOpen, navAutoHide]);

  const shown = !navAutoHide || revealed || menuOpen;

  return (
    <>
      {navAutoHide && (
        <div onMouseEnter={showNav} className="fixed inset-x-0 top-0 z-30 h-3" aria-hidden />
      )}
      <header
        onMouseEnter={navAutoHide ? showNav : undefined}
        onMouseLeave={
          navAutoHide
            ? () => {
                if (!menuOpen) scheduleHide();
              }
            : undefined
        }
        onFocusCapture={navAutoHide ? showNav : undefined}
        className={cn(
          'inset-x-0 top-0 z-30 bg-brand-600 text-white shadow-card transition-transform duration-300',
          navAutoHide ? 'fixed' : 'sticky',
          navAutoHide && !shown && '-translate-y-full',
        )}
      >
        <div className="mx-auto flex items-center gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 font-bold uppercase tracking-tight">
            <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white/15">
              {store?.logo_url ? (
                <img src={store.logo_url} alt="" className="h-full w-full bg-white object-contain p-0.5" />
              ) : (
                <Store size={18} />
              )}
            </span>
            <div className="leading-tight">
              <div className="text-[10px] opacity-70">Aplikasi</div>
              <div className="-mt-0.5">TOKOKU</div>
            </div>
          </div>

          <nav className="hidden md:flex flex-1 items-center justify-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-4 py-1.5 text-sm font-semibold transition',
                    isActive ? 'bg-white text-ink-900 shadow-card' : 'text-white/85 hover:bg-white/10',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto">
            <NavActions tone="brand" showAutoHideToggle onOpenChange={handleMenuOpenChange} />
          </div>
        </div>

        {/* mobile nav */}
        <div className="md:hidden flex gap-1 overflow-x-auto px-2 pb-2 scrollbar-thin">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold',
                  isActive ? 'bg-white text-ink-900' : 'bg-white/10 text-white',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </header>
    </>
  );
}
