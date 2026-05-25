'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSaveStatus, saveQuality, type SaveStatus } from '@/lib/api/save';
import type { ApiSaveJob } from '@/types/api';

/**
 * Single-quality save. The previous `useSaveQualities` (plural) is gone —
 * the contract is now one save per (user, media), and re-save with a
 * different quality replaces the previous selection.
 */
export function useSaveQuality() {
  const qc = useQueryClient();
  return useMutation<ApiSaveJob, Error, { mediaId: string; quality: string }>({
    mutationFn: ({ mediaId, quality }) => saveQuality(mediaId, quality),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

/**
 * Polls a single save job until terminal state.
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
