import { useEffect, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/format';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
};

export function Modal({ open, onClose, title, children, size = 'md' }: Props) {
  const idJudul = useId();
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? idJudul : undefined}
        className={cn('w-full card max-h-[90vh] overflow-y-auto scrollbar-thin', sizeClass[size])}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between gap-2 border-b border-ink-100 dark:border-ink-800 py-2 pl-4 pr-2">
            <h3 id={idJudul} className="font-semibold">
              {title}
            </h3>
            {/* 44 px: target sentuh di HP. Huruf dasar 14 px, jadi ukurannya ditulis dalam piksel. */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
