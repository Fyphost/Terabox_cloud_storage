import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg shadow-sm transition-colors',
          'placeholder:text-muted-fg',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30',
          'disabled:opacity-60 disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    );
  },
);
