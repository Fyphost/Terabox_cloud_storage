'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkDeleteLibrary, deleteLibraryEntry, listLibrary, type LibrarySort } from '@/lib/api/library';

export function useLibrary(search: string, sort: LibrarySort) {
  return useInfiniteQuery({
    queryKey: ['library', { search, sort }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listLibrary({ search: search || undefined, cursor: pageParam, sort, take: 24 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useDeleteFromLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (savedMediaId: string) => deleteLibraryEntry(savedMediaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

export function useBulkDeleteLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => bulkDeleteLibrary(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}
