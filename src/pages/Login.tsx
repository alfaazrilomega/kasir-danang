import { useState } from 'react';
import { useNavigate } from '@/lib/router';
import { Store } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/stores/auth';

export function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    navigate('/');
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-10 text-white">
        <div className="flex items-center gap-3 font-bold uppercase tracking-tight">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
            <Store size={22} />
          </span>
          <div className="leading-tight">
            <div className="text-[10px] opacity-70">Aplikasi</div>
            <div className="-mt-0.5 text-lg">KASIR</div>
          </div>
        </div>
        <div>
          <h1 className="font-display text-5xl font-bold leading-tight">Cashier Dashboard</h1>
          <p className="mt-3 max-w-md text-white/80">
            Offline-first POS. Tetap melayani pelanggan walau jaringan putus, otomatis sinkron saat online.
          </p>
        </div>
        <p className="text-xs opacity-60">© Aplikasi Kasir - self-hosted React + Postgres</p>
      </div>
      <div className="grid place-items-center p-6">
        <form onSubmit={submit} className="card w-full max-w-md p-6">
          <h2 className="text-xl font-bold">Masuk</h2>
          <p className="text-sm text-ink-500">Gunakan akun yang terdaftar di backend kasir.</p>
          <div className="mt-5 space-y-3">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="mt-5 w-full" disabled={busy}>
            {busy ? <Spinner /> : null} Masuk
          </Button>

          <div className="mt-6 border-t border-ink-100 pt-4 dark:border-ink-800">
            <span className="block text-xs font-semibold uppercase tracking-wider text-ink-500 mb-2">
              Akun Demo Cepat (Klik untuk Pilih Role):
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@example.com');
                  setPassword('change-me-strong-password');
                }}
                className="rounded-xl border border-ink-200 bg-ink-50 p-2 text-left hover:border-brand-500 hover:bg-brand-50/50 dark:border-ink-700 dark:bg-ink-800 dark:hover:bg-brand-950/30"
              >
                <div className="font-bold text-ink-900 dark:text-ink-100">👑 Admin</div>
                <div className="text-[10px] text-ink-500">admin@example.com</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('gudang@example.com');
                  setPassword('gudang12345');
                }}
                className="rounded-xl border border-ink-200 bg-ink-50 p-2 text-left hover:border-brand-500 hover:bg-brand-50/50 dark:border-ink-700 dark:bg-ink-800 dark:hover:bg-brand-950/30"
              >
                <div className="font-bold text-ink-900 dark:text-ink-100">📦 Gudang</div>
                <div className="text-[10px] text-ink-500">gudang@example.com</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('kasir@example.com');
                  setPassword('kasir12345');
                }}
                className="rounded-xl border border-ink-200 bg-ink-50 p-2 text-left hover:border-brand-500 hover:bg-brand-50/50 dark:border-ink-700 dark:bg-ink-800 dark:hover:bg-brand-950/30"
              >
                <div className="font-bold text-ink-900 dark:text-ink-100">🛒 Kasir</div>
                <div className="text-[10px] text-ink-500">kasir@example.com</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('customer@example.com');
                  setPassword('customer12345');
                }}
                className="rounded-xl border border-ink-200 bg-ink-50 p-2 text-left hover:border-brand-500 hover:bg-brand-50/50 dark:border-ink-700 dark:bg-ink-800 dark:hover:bg-brand-950/30"
              >
                <div className="font-bold text-ink-900 dark:text-ink-100">👤 Customer</div>
                <div className="text-[10px] text-ink-500">customer@example.com</div>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
