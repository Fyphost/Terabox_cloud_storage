'use client';

/**
 * Compact pipeline-aware progress UI for a SavedMedia.
 *
 * Shows one row per claimed variant:
 *   - state badge
 *   - progress bar
 *   - bytes done / total + speed + ETA when in flight
 *   - Retry button when FAILED
 */

import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRetrySavedVariant, isVariantInFlight, variantStateLabel } from '@/hooks/use-save';
import { toast } from '@/lib/store/ui.store';
import { formatBytes, formatDuration } from '@/lib/utils/format';
import type { ApiSavedVariantProgress } from '@/types/api';
import { cn } from '@/lib/utils/cn';

interface Props {
  variants: ApiSavedVariantProgress[];
  compact?: boolean;
}

const BADGE_CLASSES: Record<string, string> = {
  PERSISTED: 'bg-success/10 text-success',
  FAILED: 'bg-danger/10 text-danger',
  PENDING: 'bg-muted text-muted-fg',
  FETCHING: 'bg-primary/10 text-primary',
  DOWNLOADING: 'bg-primary/10 text-primary',
  GENERATING_HLS: 'bg-primary/10 text-primary',
  GENERATING_THUMBNAIL: 'bg-primary/10 text-primary',
  FINALIZING: 'bg-primary/10 text-primary',
};

export default function SaveProgress({ variants, compact = false }: Props) {
  return (
    <ul className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2')}>
      {variants.map((v) => (
        <Row key={v.savedVariantId} v={v} compact={compact} />
      ))}
    </ul>
  );
}

function Row({ v, compact }: { v: ApiSavedVariantProgress; compact: boolean }) {
  const retry = useRetrySavedVariant();
  const inFlight = isVariantInFlight(v.state);
  const persisted = v.state === 'PERSISTED';
  const failed = v.state === 'FAILED';
  const pct = Math.max(0, Math.min(1, v.progress));

  return (
    <li className={cn('rounded-lg border border-border bg-surface', compact ? 'p-2' : 'p-3')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-fg">{v.quality}</span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              BADGE_CLASSES[v.state] ?? 'bg-muted text-muted-fg',
            )}
          >
            {inFlight && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {variantStateLabel(v.state)}
          </span>
        </div>

        <div className="text-right text-xs tabular-nums text-muted-fg">
          {persisted && v.sizeBytes ? formatBytes(v.sizeBytes) : null}
          {inFlight && (
            <>
              {formatBytes(v.bytesDone)}
              {v.bytesTotal ? ` / ${formatBytes(v.bytesTotal)}` : null}
            </>
          )}
        </div>
      </div>

      {(inFlight || persisted) && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              persisted ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${Math.round((persisted ? 1 : pct) * 100)}%` }}
          />
        </div>
      )}

      {inFlight && (
        <p className="mt-1.5 text-xs text-muted-fg">
          {v.pipelineStep ?? 'Working…'}
          {v.speedBytesPerSec
            ? ` · ${formatBytes(v.speedBytesPerSec)}/s`
            : ''}
          {v.etaSec ? ` · ETA ${formatDuration(v.etaSec)}` : ''}
        </p>
      )}

      {failed && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-danger line-clamp-2">
            {v.errorMessage || 'Save failed.'}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={retry.isPending}
            onClick={async () => {
              try {
                await retry.mutateAsync(v.savedVariantId);
                toast({ variant: 'success', title: 'Retry queued' });
              } catch {
                toast({ variant: 'error', title: 'Could not retry' });
              }
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
          </Button>
        </div>
      )}
    </li>
  );
}
