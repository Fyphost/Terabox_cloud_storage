'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useUIStore, type Toast } from '@/lib/store/ui.store';
import { cn } from '@/lib/utils/cn';

export function Toaster() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end sm:bottom-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, toast.ttl);
    return () => window.clearTimeout(id);
  }, [toast.ttl, onDismiss]);

  const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? XCircle : Info;
  const accent =
    toast.variant === 'success'
      ? 'text-success'
      : toast.variant === 'error'
        ? 'text-danger'
        : 'text-primary';

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-[min(95vw,380px)] items-start gap-3 rounded-xl border border-border bg-surface p-3 pr-2 shadow-elevated',
        'animate-slide-up',
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', accent)} aria-hidden />
      <div className="min-w-0 flex-1 pt-0.5">
        {toast.title && <p className="text-sm font-medium text-fg">{toast.title}</p>}
        {toast.description && (
          <p className={cn('text-sm text-muted-fg', toast.title && 'mt-0.5')}>{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
