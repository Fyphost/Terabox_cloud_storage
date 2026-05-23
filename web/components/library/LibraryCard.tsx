'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Play, Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { formatBytes } from '@/lib/utils/format';
import { useDeleteFromLibrary } from '@/hooks/use-library';
import { toast } from '@/lib/store/ui.store';
import type { ApiLibraryEntry } from '@/types/api';
import { cn } from '@/lib/utils/cn';

interface Props {
  entry: ApiLibraryEntry;
  selected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
}

export default function LibraryCard({ entry, selected, selectionMode, onToggle }: Props) {
  const del = useDeleteFromLibrary();
  const m = entry.media;
  const isReady = entry.state === 'COMPLETE';
  const isPending = entry.state === 'PENDING' || entry.state === 'DOWNLOADING';

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
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-surface transition-shadow',
        selected ? 'border-primary ring-2 ring-ring/30' : 'border-border hover:shadow-card',
      )}
    >
      <Link href={`/m/${m.id}`} onClick={onClickWrap} className="block">
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {m.thumbnailUrl ? (
            <Image
              src={m.thumbnailUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-0 transition-opacity group-hover:opacity-100" />
          <span className="absolute right-2 top-2 inline-flex items-center rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {entry.quality}
          </span>
          {isReady && (
            <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-primary opacity-0 shadow-elevated transition-opacity group-hover:opacity-100">
              <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden />
            </span>
          )}
          {isPending && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(entry.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="p-3">
          <h3 className="line-clamp-2 text-sm font-medium text-fg">{m.name}</h3>
          <p className="mt-1 text-xs text-muted-fg">
            {formatBytes(m.sizeBytes)}
            {' · '}
            {isReady ? (
              'Ready'
            ) : entry.state === 'FAILED' ? (
              <span className="text-danger">Failed</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {entry.state.toLowerCase()}
              </span>
            )}
          </p>
        </div>
      </Link>

      {/* Selection checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        aria-label={selected ? 'Deselect' : 'Select'}
        aria-pressed={selected}
        className={cn(
          'absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-white/90 text-xs font-semibold shadow-sm transition-opacity',
          selected
            ? 'border-primary bg-primary text-primary-fg opacity-100'
            : 'border-border text-muted-fg opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
      >
        {selected ? '✓' : ''}
      </button>

      {/* Delete (hover) */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete"
        className="absolute right-2 bottom-[3.75rem] flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/90 text-muted-fg shadow-sm opacity-0 transition-opacity hover:bg-danger hover:text-white group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </article>
  );
}
