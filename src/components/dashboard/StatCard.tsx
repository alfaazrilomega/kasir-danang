import type { LucideIcon } from 'lucide-react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/format';

interface Props {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Percent change vs previous period. `null` or `undefined` hides the badge. Use `Infinity` for "from 0". */
  trend?: number | null;
  hint?: string;
  /** Optional 0..1 progress bar; defaults to 2/3 when not provided. */
  progress?: number;
}

export function StatCard({ icon: Icon, label, value, trend, hint, progress }: Props) {
  const hasTrend = typeof trend === 'number' && Number.isFinite(trend);
  const newFromZero = trend === Infinity;
  const positive = hasTrend ? trend! >= 0 : true;
  const TrendIcon = !hasTrend ? Minus : positive ? TrendingUp : TrendingDown;
  const bar = Math.max(0, Math.min(1, progress ?? 0.66));
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50">
          <Icon size={14} />
        </span>
        <span>{label}</span>
        {(hasTrend || newFromZero) && (
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
              newFromZero
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15'
                : positive
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15'
                : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15',
            )}
          >
            <TrendIcon size={12} />{' '}
            {newFromZero ? 'New' : `${trend! >= 0 ? '+' : ''}${trend!.toFixed(0)}%`}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${bar * 100}%` }} />
      </div>
    </Card>
  );
}
