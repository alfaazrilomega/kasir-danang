import { Star } from 'lucide-react';
import { cn } from '@/lib/format';

/** Lima bintang rating seperti marketplace; bintang terisi mengikuti nilai (dibulatkan setengah). */
export function Bintang({ nilai, ukuran = 14, className }: { nilai: number; ukuran?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`Rating ${nilai.toFixed(1)} dari 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={ukuran}
          className={nilai >= i - 0.25 ? 'fill-amber-400 text-amber-400' : 'fill-ink-200 text-ink-200 dark:fill-ink-700 dark:text-ink-700'}
        />
      ))}
    </span>
  );
}
