import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/format';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';

const toneClass: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  danger:  'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  info:    'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  brand:   'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200',
  neutral: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
};

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...rest }: Props) {
  return <span className={cn('pill', toneClass[tone], className)} {...rest} />;
}
