'use client';

import * as DialogPrim from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export const Dialog = DialogPrim.Root;
export const DialogTrigger = DialogPrim.Trigger;

export function DialogContent({
  children,
  title,
  description,
  className,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <DialogPrim.Portal>
      <DialogPrim.Overlay className="fixed inset-0 z-40 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrim.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(95vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <DialogPrim.Title className="text-base font-semibold">{title}</DialogPrim.Title>
            {description && (
              <DialogPrim.Description className="mt-1 text-xs text-muted">
                {description}
              </DialogPrim.Description>
            )}
          </div>
          <DialogPrim.Close
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </DialogPrim.Close>
        </div>
        {children}
      </DialogPrim.Content>
    </DialogPrim.Portal>
  );
}
