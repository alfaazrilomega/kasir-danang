import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, className, id, ...rest }, ref) => {
    const _id = id ?? rest.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={_id} className="block text-sm font-medium text-ink-700 dark:text-ink-200">
            {label}
          </label>
        )}
        <input ref={ref} id={_id} className={cn('input', className)} {...rest} />
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : hint ? (
          <p className="text-xs text-ink-500">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, hint, error, className, id, ...rest }, ref) => {
    const _id = id ?? rest.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={_id} className="block text-sm font-medium text-ink-700 dark:text-ink-200">
            {label}
          </label>
        )}
        <textarea ref={ref} id={_id} className={cn('input min-h-[80px]', className)} {...rest} />
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : hint ? (
          <p className="text-xs text-ink-500">{hint}</p>
        ) : null}
      </div>
    );
  },
);
TextArea.displayName = 'TextArea';
