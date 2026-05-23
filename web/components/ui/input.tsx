import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-12 w-full rounded-md border border-border bg-surface px-3 text-base text-fg placeholder:text-muted',
          'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent',
          className,
        )}
        {...props}
      />
    );
  },
);
