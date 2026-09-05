import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@/lib/router';
import { Delete, Lock, LogOut, Store } from 'lucide-react';
import { cn } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { usePinLock } from '@/stores/pinLock';

const PIN_LENGTH = 4;

export function PinLockScreen() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { verifyPin, unlock, disablePin } = usePinLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || verifyingRef.current) return;
    verifyingRef.current = true;
    setBusy(true);
    verifyPin(pin)
      .then((ok) => {
        if (ok) {
          unlock();
        } else {
          setError(true);
          setTimeout(() => {
            setPin('');
            setError(false);
          }, 600);
        }
      })
      .finally(() => {
        verifyingRef.current = false;
        setBusy(false);
      });
  }, [pin, verifyPin, unlock]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return;
      if (/^\d$/.test(e.key)) {
        setPin((p) => (p.length < PIN_LENGTH ? p + e.key : p));
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Escape') {
        setPin('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const press = (digit: string) => {
    if (busy) return;
    setPin((p) => (p.length < PIN_LENGTH ? p + digit : p));
  };
  const backspace = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  };

  async function forgotPin() {
    const ok = confirm(
      'Reset PIN dan keluar?\n\nPIN akan dihapus dan Anda akan sign out. Setelah login kembali, Anda bisa mengatur PIN baru di Settings.',
    );
    if (!ok) return;
    disablePin();
    await signOut();
    navigate('/login', { replace: true });
  }

  const initial = (profile?.full_name ?? profile?.email ?? 'U').charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl shadow-black/40 dark:bg-ink-900">
        <div className="mb-4 flex flex-col items-center gap-2">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white">
            <Lock size={22} />
          </div>
          <div className="text-center">
            <h2 className="text-base font-bold">Aplikasi terkunci</h2>
            <p className="text-xs text-ink-500">Masukkan PIN untuk melanjutkan</p>
          </div>
          {profile && (
            <div className="mt-1 flex items-center gap-2 rounded-full bg-ink-100 px-3 py-1 text-xs dark:bg-ink-800">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                {initial}
              </span>
              <span className="font-medium">{profile.full_name ?? profile.email}</span>
            </div>
          )}
        </div>

        <div
          className={cn(
            'mb-5 flex justify-center gap-3 transition',
            error && 'animate-pulse-error',
          )}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <span
                key={i}
                className={cn(
                  'h-3 w-3 rounded-full border-2 transition',
                  error
                    ? 'border-rose-500 bg-rose-500'
                    : filled
                      ? 'border-brand-600 bg-brand-600'
                      : 'border-ink-300 dark:border-ink-700',
                )}
              />
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <KeyButton key={d} onClick={() => press(d)} disabled={busy}>
              {d}
            </KeyButton>
          ))}
          <div />
          <KeyButton onClick={() => press('0')} disabled={busy}>
            0
          </KeyButton>
          <KeyButton onClick={backspace} disabled={busy || pin.length === 0} subtle>
            <Delete size={18} />
          </KeyButton>
        </div>

        <div className="mt-5 flex items-center justify-between text-xs">
          <button
            onClick={forgotPin}
            className="font-semibold text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"
          >
            Lupa PIN?
          </button>
          <button
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
            className="inline-flex items-center gap-1 font-semibold text-ink-500 hover:text-rose-500"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 border-t border-ink-100 pt-3 text-[10px] uppercase tracking-wider text-ink-400 dark:border-ink-800">
          <Store size={10} /> TokoKu
        </div>
      </div>
    </div>
  );
}

function KeyButton({
  children,
  onClick,
  disabled,
  subtle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-14 rounded-2xl text-xl font-semibold transition active:scale-95 disabled:opacity-40',
        subtle
          ? 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300'
          : 'bg-ink-50 text-ink-800 hover:bg-ink-100 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700',
      )}
    >
      {children}
    </button>
  );
}
