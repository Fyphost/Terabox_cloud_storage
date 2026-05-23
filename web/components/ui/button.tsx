import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils/cn';

const button = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md font-medium select-none',
    'transition-[background-color,box-shadow,transform,color] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:translate-y-px',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
        secondary:
          'bg-surface text-fg border border-border hover:bg-muted shadow-sm',
        ghost: 'text-fg hover:bg-muted',
        outline: 'border border-border text-fg hover:bg-muted',
        danger: 'bg-danger text-danger-fg hover:bg-danger/90 shadow-sm',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
});
