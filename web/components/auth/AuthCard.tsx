import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export default function AuthCard({ title, subtitle, children, footer, className }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-bg px-4 py-12">
      <div className={cn('w-full max-w-md', className)}>
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-fg"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-blue-700 text-white shadow-card">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            Fyphost
          </Link>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-7 shadow-card">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-fg">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && (
          <p className="mt-6 text-center text-sm text-muted-fg">{footer}</p>
        )}
      </div>
    </div>
  );
}
