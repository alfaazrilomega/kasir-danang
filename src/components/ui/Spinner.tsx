import { cn } from '@/lib/format';

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
      role="status"
      aria-label="loading"
    />
  );
}
