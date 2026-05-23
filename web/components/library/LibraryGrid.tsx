'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useLibrary } from '@/hooks/use-library';
import LibraryCard from './LibraryCard';

interface Props {
  search: string;
}

export default function LibraryGrid({ search }: Props) {
  const q = useLibrary(search);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll via IntersectionObserver.
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

  if (q.isLoading) {
    return <SkeletonGrid />;
  }

  if (q.error) {
    return (
      <p className="py-10 text-center text-sm text-red-400">
        {q.error instanceof Error ? q.error.message : 'Failed to load library.'}
      </p>
    );
  }

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted">Nothing saved yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
        {items.map((entry) => (
          <LibraryCard key={entry.savedMediaId} entry={entry} />
        ))}
      </div>
      <div ref={sentinelRef} className="flex h-12 items-center justify-center">
        {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </div>
    </>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-video animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}
