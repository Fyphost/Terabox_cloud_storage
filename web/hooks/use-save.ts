'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSaveStatus, saveQualities, type SaveStatus } from '@/lib/api/save';

export function useSaveQualities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mediaId, qualities }: { mediaId: string; qualities: string[] }) =>
      saveQualities(mediaId, qualities),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

/**
 * Polls a single save job until terminal state. Backoff is naive (2s) but
 * fine for v1; switch to SSE later for instant updates.
 */
export function useSaveStatus(savedMediaId: string | null | undefined) {
  return useQuery<SaveStatus>({
    queryKey: ['save', savedMediaId],
    queryFn: ({ signal }) => getSaveStatus(savedMediaId!, signal),
    enabled: !!savedMediaId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 2000;
      return data.state === 'COMPLETE' || data.state === 'FAILED' ? false : 2000;
    },
  });
}
