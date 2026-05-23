import { cn } from '@/lib/utils/cn';

export default function QualityBadge({ quality, className }: { quality: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded border border-border bg-surface/80 px-1.5 text-[10px] font-semibold tracking-wide text-fg/90',
        className,
      )}
    >
      {quality.toUpperCase()}
    </span>
  );
}
