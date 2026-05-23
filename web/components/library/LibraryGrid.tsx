'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import LibraryToolbar, { type LibraryView } from './LibraryToolbar';
import LibraryCard from './LibraryCard';
import LibraryListRow from './LibraryListRow';
import { useBulkDeleteLibrary, useLibrary } from '@/hooks/use-library';
import type { LibrarySort } from '@/lib/api/library';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/store/ui.store';

const VIEW_KEY = 'fyphost:library:view';
const SORT_KEY = 'fyphost:library:sort';

export default function LibraryGrid() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<LibraryView>('grid');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Persist view preferences across visits.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'grid' || v === 'list') setView(v);
      const s = localStorage.getItem(SORT_KEY);
      if (s === 'recent' || s === 'oldest' || s === 'name' || s === 'size') setSort(s);
    } catch {
      /* SSR / private mode */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* no-op */
    }
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      /* no-op */
    }
  }, [sort]);

  const q = useLibrary(search, sort);
  const bulkDelete = useBulkDeleteLibrary();

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) {
          void q.fetchNextPage();
        }
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} item${ids.length > 1 ? 's' : ''} from your library?`)) return;
    try {
      const res = await bulkDelete.mutateAsync(ids);
      setSelected(new Set());
      toast({
        variant: 'success',
        title: 'Removed from library',
        description: `${res.removed} item${res.removed === 1 ? '' : 's'} removed.`,
      });
    } catch {
      toast({ variant: 'error', title: 'Bulk delete failed' });
    }
  };

  return (
    <>
      <LibraryToolbar
        search={search}
        onSearchChange={setSearch}
        view={view}
        onViewChange={setView}
        sort={sort}
        onSortChange={setSort}
        selectedCount={selected.size}
        onClearSelection={() => setSelected(new Set())}
        onBulkDelete={onBulkDelete}
        bulkDeleting={bulkDelete.isPending}
      />

      {q.isLoading ? (
        <SkeletonGrid view={view} />
      ) : q.error ? (
        <ErrorState
          message={q.error instanceof Error ? q.error.message : 'Failed to load library.'}
          onRetry={() => q.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState search={search} />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5">
          {items.map((entry) => (
            <LibraryCard
              key={entry.savedMediaId}
              entry={entry}
              selected={selected.has(entry.savedMediaId)}
              selectionMode={selected.size > 0}
              onToggle={() => toggle(entry.savedMediaId)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((entry) => (
            <LibraryListRow
              key={entry.savedMediaId}
              entry={entry}
              selected={selected.has(entry.savedMediaId)}
              selectionMode={selected.size > 0}
              onToggle={() => toggle(entry.savedMediaId)}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="flex h-12 items-center justify-center">
        {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-muted-fg" />}
      </div>
    </>
  );
}

function SkeletonGrid({ view }: { view: LibraryView }) {
  if (view === 'list') {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="aspect-video w-full rounded-2xl" />
      ))}
    </div>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 py-16 text-center">
      <p className="text-sm font-medium text-fg">
        {search ? 'No matches' : 'Your library is empty'}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-fg">
        {search
          ? 'Try a different search term.'
          : 'Paste a TeraBox link and tap Save to keep media here.'}
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-danger/20 bg-danger/5 py-12 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
