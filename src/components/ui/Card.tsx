import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/format';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...rest} />;
}
