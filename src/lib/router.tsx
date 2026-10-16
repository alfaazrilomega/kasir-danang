import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

interface AppLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

type NavigateFn = (to: string | number, options?: NavigateOptions) => void;

interface RouterValue {
  location: AppLocation;
  navigate: NavigateFn;
}

interface RouteProps {
  path: string;
  element: ReactNode;
}

const RouterContext = createContext<RouterValue | null>(null);

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const onPopState = () => setLocation(readLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback<NavigateFn>((to, options = {}) => {
    if (typeof to === 'number') {
      window.history.go(to);
      return;
    }
    const nextUrl = to || '/';
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method]({ usr: options.state ?? null }, '', nextUrl);
    setLocation(readLocation());
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function Routes({ children }: { children: ReactNode }) {
  const location = useLocation();
  const current = normalizePath(location.pathname);
  let fallback: ReactElement<RouteProps> | null = null;

  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue;
    if (child.props.path === '*') {
      fallback = child;
      continue;
    }
    if (normalizePath(child.props.path) === current) return <>{child.props.element}</>;
  }

  return fallback ? <>{fallback.props.element}</> : null;
}

export function Route(_props: RouteProps) {
  return null;
}

export function Navigate({ to, replace, state }: { to: string; replace?: boolean; state?: unknown }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, replace, state, to]);
  return null;
}

export function Link({
  to,
  replace,
  state,
  onClick,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  replace?: boolean;
  state?: unknown;
}) {
  const navigate = useNavigate();
  return (
    <a
      {...props}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey ||
          props.target
        ) {
          return;
        }
        event.preventDefault();
        navigate(to, { replace, state });
      }}
    />
  );
}

export function NavLink({
  to,
  end,
  className,
  ...props
}: Omit<Parameters<typeof Link>[0], 'className'> & {
  end?: boolean;
  className?: string | ((args: { isActive: boolean }) => string);
}) {
  const location = useLocation();
  const active = isActivePath(location.pathname, to, Boolean(end));
  const resolvedClassName = typeof className === 'function' ? className({ isActive: active }) : className;
  return <Link {...props} to={to} className={resolvedClassName} />;
}

export function useNavigate(): NavigateFn {
  return useRouter().navigate;
}

export function useLocation(): AppLocation {
  return useRouter().location;
}

function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router belum tersedia.');
  return value;
}

function readLocation(): AppLocation {
  return {
    pathname: window.location.pathname || '/',
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state?.usr ?? null,
  };
}

function normalizePath(path: string) {
  if (!path || path === '/') return '/';
  return path.replace(/\/+$/, '');
}

function isActivePath(pathname: string, to: string, end: boolean) {
  const current = normalizePath(pathname);
  const target = normalizePath(to);
  if (end) return current === target;
  return current === target || current.startsWith(`${target}/`);
}
