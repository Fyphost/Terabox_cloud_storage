'use client';

import * as DialogPrim from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export const Dialog = DialogPrim.Root;
export const DialogTrigger = DialogPrim.Trigger;
export const DialogClose = DialogPrim.Close;

export function DialogContent({
  children,
  title,
  description,
  className,
  size = 'md',
}: {
  children: ReactNode;
  title: string;
  description?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const widths: Record<typeof size, string> = {
    sm: 'w-[min(95vw,360px)]',
    md: 'w-[min(95vw,460px)]',
    lg: 'w-[min(95vw,640px)]',
  };
  return (
    <DialogPrim.Portal>
      <DialogPrim.Overlay
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm data-[state=open]:animate-fade-in"
      />
      <DialogPrim.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-6 shadow-elevated focus:outline-none',
          widths[size],
          'data-[state=open]:animate-scale-in',
          className,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <DialogPrim.Title className="text-lg font-semibold tracking-tight text-fg">
              {title}
            </DialogPrim.Title>
            {description && (
              <DialogPrim.Description className="mt-1 text-sm text-muted-fg">
                {description}
              </DialogPrim.Description>
            )}
          </div>
          <DialogPrim.Close
            aria-label="Close"
            className="-mr-2 -mt-2 rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </DialogPrim.Close>
        </div>
        {children}
      </DialogPrim.Content>
    </DialogPrim.Portal>
  );
}
