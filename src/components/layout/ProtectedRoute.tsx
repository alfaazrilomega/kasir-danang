import { Navigate, useLocation } from '@/lib/router';
import type { ReactNode } from 'react';
import { useAuth } from '@/stores/auth';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { Store } from 'lucide-react';
import { canAccessRoute, defaultRouteForRole } from '@/lib/roles';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { ready, userId, profile, signOut } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-brand-600">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (!userId) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!profile?.store_id) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50 p-6 text-ink-900 dark:bg-ink-950 dark:text-white">
        <div className="card w-full max-w-md p-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40">
            <Store size={22} />
          </div>
          <h1 className="mt-4 text-lg font-bold">Akun belum terhubung ke toko</h1>
          <p className="mt-2 text-sm text-ink-500">
            Jalankan bootstrap admin di server atau hubungkan profil akun ini ke
            <code className="mx-1 rounded bg-ink-100 px-1 py-0.5 text-[11px] dark:bg-ink-800">
              store_id
            </code>
            sebelum memakai aplikasi kasir.
          </p>
          <Button
            className="mt-5"
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            Keluar
          </Button>
        </div>
      </div>
    );
  }
  if (!canAccessRoute(profile.role, location.pathname)) {
    const fallback = defaultRouteForRole(profile.role);
    if (fallback !== location.pathname) {
      return <Navigate to={fallback} replace />;
    }
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50 p-6 text-ink-900 dark:bg-ink-950 dark:text-white">
        <div className="card w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold">Akses tidak tersedia</h1>
          <p className="mt-2 text-sm text-ink-500">
            Role akun ini belum memiliki akses ke halaman tersebut.
          </p>
          <Button
            className="mt-5"
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            Keluar
          </Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
