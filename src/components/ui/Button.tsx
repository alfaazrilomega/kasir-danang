import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: '',
  lg: 'px-5 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', className, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(variantClass[variant], sizeClass[size], className)}
        {...rest}
      />
    );
  },
);
Button.displayName = 'Button';
