import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Lock, ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/format';
import { usePinLock } from '@/stores/pinLock';

const PIN_LENGTH = 4;

type Mode = 'create' | 'change' | 'disable';
type Step = 'current' | 'new' | 'confirm';

export function PinSetupModal({
  open,
  mode,
  onClose,
}: {
  open: boolean;
  mode: Mode;
  onClose: () => void;
}) {
  const { setPin, verifyPin, disablePin } = usePinLock();
  const [step, setStep] = useState<Step>(mode === 'create' ? 'new' : 'current');
  const [value, setValue] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep(mode === 'create' ? 'new' : 'current');
    setValue('');
    setNewPin('');
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, mode]);

  useEffect(() => {
    if (value.length !== PIN_LENGTH || busy) return;
    void advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function advance() {
    setBusy(true);
    setError(null);
    try {
      if (step === 'current') {
        const ok = await verifyPin(value);
        if (!ok) {
          setError('PIN saat ini salah.');
          setValue('');
          return;
        }
        if (mode === 'disable') {
          disablePin();
          toast.success('PIN dinonaktifkan.');
          onClose();
          return;
        }
        setStep('new');
        setValue('');
      } else if (step === 'new') {
        setNewPin(value);
        setStep('confirm');
        setValue('');
      } else if (step === 'confirm') {
        if (value !== newPin) {
          setError('PIN konfirmasi tidak cocok. Ulangi.');
          setNewPin('');
          setStep('new');
          setValue('');
          return;
        }
        await setPin(newPin);
        toast.success(mode === 'create' ? 'PIN diaktifkan.' : 'PIN diperbarui.');
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'create'
      ? 'Atur PIN'
      : mode === 'change'
        ? 'Ganti PIN'
        : 'Nonaktifkan PIN';

  const stepLabel =
    step === 'current'
      ? 'Masukkan PIN saat ini'
      : step === 'new'
        ? mode === 'change'
          ? 'PIN baru'
          : 'Pilih 4 digit PIN'
        : 'Ulangi PIN baru';

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4 text-center">
        <div className="grid h-12 w-12 mx-auto place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40">
          {mode === 'disable' ? <Lock size={20} /> : <ShieldCheck size={20} />}
        </div>
        <div>
          <div className="text-sm font-semibold">{stepLabel}</div>
          {mode === 'create' && step === 'new' && (
            <p className="text-xs text-ink-500 mt-1">
              Disarankan PIN yang mudah Anda ingat tapi tidak gampang ditebak (hindari tanggal lahir).
            </p>
          )}
        </div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
            setValue(v);
            setError(null);
          }}
          className="sr-only"
          aria-label="PIN"
        />

        <div
          onClick={() => inputRef.current?.focus()}
          className="flex justify-center gap-3 cursor-text"
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const filled = i < value.length;
            return (
              <span
                key={i}
                className={cn(
                  'h-3.5 w-3.5 rounded-full border-2 transition',
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

        {error && <div className="text-xs text-rose-600">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
        </div>
      </div>
    </Modal>
  );
}
