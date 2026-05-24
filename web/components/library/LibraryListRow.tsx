'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useDeleteFromLibrary } from '@/hooks/use-library';
import { toast } from '@/lib/store/ui.store';
import { formatBytes } from '@/lib/utils/format';
import type { ApiLibraryItem } from '@/types/api';
import { cn } from '@/lib/utils/cn';

interface Props {
  entry: ApiLibraryItem;
  selected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
}

export default function LibraryListRow({ entry, selected, selectionMode, onToggle }: Props) {
  const del = useDeleteFromLibrary();
  const m = entry.media;
  const inflight = entry.state === 'PENDING' || entry.state === 'IN_PROGRESS';
  const inflightVariants = entry.variants.filter(
    (v) => v.state !== 'PERSISTED' && v.state !== 'FAILED',
  );
  const aggregatePct =
    inflightVariants.length > 0
      ? inflightVariants.reduce((acc, v) => acc + v.progress, 0) / inflightVariants.length
      : 0;

  const onDelete = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Remove this from your library?')) return;
    try {
      await del.mutateAsync(entry.savedMediaId);
      toast({ variant: 'success', title: 'Removed from library' });
    } catch {
      toast({ variant: 'error', title: 'Could not remove' });
    }
  };

  const onClickWrap = (e: MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <Link
      href={`/watch/${entry.savedMediaId}`}
      onClick={onClickWrap}
      className={cn(
        'group flex items-center gap-3 rounded-xl border bg-surface p-2.5 transition-colors',
        selected ? 'border-primary ring-2 ring-ring/30' : 'border-border hover:bg-muted',
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        aria-label={selected ? 'Deselect' : 'Select'}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          selected ? 'border-primary bg-primary text-primary-fg' : 'border-border text-transparent',
        )}
      >
        {selected ? '✓' : ''}
      </button>
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
        {m.thumbnailUrl ? (
          <Image src={m.thumbnailUrl} alt="" fill sizes="96px" className="object-cover" unoptimized />
        ) : null}
        {entry.topQuality && (
          <span className="absolute right-1 bottom-1 inline-flex items-center rounded bg-black/70 px-1 text-[9px] font-semibold uppercase tracking-wide text-white">
            {entry.topQuality}
          </span>
        )}
        {inflight && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/30">
            <div className="h-full bg-primary" style={{ width: `${Math.round(aggregatePct * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{m.name}</p>
        <p className="mt-0.5 text-xs text-muted-fg">
          {formatBytes(m.sizeBytes)}
          {' · '}
          {entry.state === 'COMPLETE' ? (
            <span className="text-success">Ready</span>
          ) : entry.state === 'FAILED' ? (
            <span className="text-danger">Failed</span>
          ) : entry.state === 'PARTIAL' ? (
            <span className="text-warning">Partial</span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {Math.round(aggregatePct * 100)}%
            </span>
          )}
        </p>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={onDelete}>
        <Trash2 className="h-4 w-4 text-muted-fg" aria-hidden />
      </Button>
    </Link>
  );
}
