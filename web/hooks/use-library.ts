'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteLibraryEntry, listLibrary } from '@/lib/api/library';

export function useLibrary(search: string) {
  return useInfiniteQuery({
    queryKey: ['library', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listLibrary({ search: search || undefined, cursor: pageParam, take: 24 }, signal),
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
