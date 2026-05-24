'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bulkDeleteLibrary,
  deleteLibraryEntry,
  getSavedMedia,
  listLibrary,
  type LibrarySort,
} from '@/lib/api/library';

const ANY_LIBRARY_KEY = ['library'] as const;

export function useLibrary(search: string, sort: LibrarySort) {
  return useInfiniteQuery({
    queryKey: [...ANY_LIBRARY_KEY, 'list', { search, sort }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listLibrary({ search: search || undefined, cursor: pageParam, sort, take: 24 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep library lists fresh while a save is in progress.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const items = data.pages.flatMap((p) => p.items);
      const inFlight = items.some(
        (i) => i.state === 'PENDING' || i.state === 'IN_PROGRESS',
      );
      return inFlight ? 4000 : false;
    },
  });
}

export function useSavedMedia(savedMediaId: string | null | undefined) {
  return useQuery({
    queryKey: [...ANY_LIBRARY_KEY, 'detail', savedMediaId],
    queryFn: ({ signal }) => getSavedMedia(savedMediaId!, signal),
    enabled: !!savedMediaId,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return d.state === 'PENDING' || d.state === 'IN_PROGRESS' ? 2500 : false;
    },
  });
}

export function useDeleteFromLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (savedMediaId: string) => deleteLibraryEntry(savedMediaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ANY_LIBRARY_KEY }),
  });
}

export function useBulkDeleteLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => bulkDeleteLibrary(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ANY_LIBRARY_KEY }),
  });
}
