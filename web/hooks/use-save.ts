'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSavedMediaProgress,
  retrySavedVariant,
  saveQualities,
} from '@/lib/api/save';
import type {
  ApiSavedMediaProgress,
  ApiSavedVariantProgress,
} from '@/types/api';

export function useSaveQualities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mediaId, qualities }: { mediaId: string; qualities: string[] }) =>
      saveQualities(mediaId, qualities),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

/**
 * Live progress for a SavedMedia. Polls every 1.5s while any variant is in
 * flight; stops polling once everything is in a terminal state.
 */
export function useSaveProgress(savedMediaId: string | null | undefined) {
  return useQuery<ApiSavedMediaProgress>({
    queryKey: ['save', 'progress', savedMediaId],
    queryFn: ({ signal }) => getSavedMediaProgress(savedMediaId!, signal),
    enabled: !!savedMediaId,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 1500;
      return d.state === 'PENDING' || d.state === 'IN_PROGRESS' ? 1500 : false;
    },
  });
}

export function useRetrySavedVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (savedVariantId: string) => retrySavedVariant(savedVariantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['save', 'progress'] });
      qc.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

// ─── Helpers shared by progress UI ──────────────────────────────────────────

export function isVariantInFlight(state: ApiSavedVariantProgress['state']): boolean {
  return (
    state === 'PENDING' ||
    state === 'FETCHING' ||
    state === 'DOWNLOADING' ||
    state === 'GENERATING_HLS' ||
    state === 'GENERATING_THUMBNAIL' ||
    state === 'FINALIZING'
  );
}

export function variantStateLabel(state: ApiSavedVariantProgress['state']): string {
  switch (state) {
    case 'PENDING':              return 'Queued';
    case 'FETCHING':             return 'Connecting';
    case 'DOWNLOADING':          return 'Downloading';
    case 'GENERATING_HLS':       return 'Packaging';
    case 'GENERATING_THUMBNAIL': return 'Capturing thumbnail';
    case 'FINALIZING':           return 'Finalizing';
    case 'PERSISTED':            return 'Ready';
    case 'FAILED':               return 'Failed';
    case 'PENDING_DELETE':       return 'Removing';
    case 'EPHEMERAL':            return 'Not saved';
    case 'CACHED':               return 'Cached';
    default:                     return state;
  }
}
