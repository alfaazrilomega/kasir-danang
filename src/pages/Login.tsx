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
        </form>
      </div>
    </div>
  );
}
