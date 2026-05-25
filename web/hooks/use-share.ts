'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getShareToken, resolveShare, revokeShareToken } from '@/lib/api/share';
import type { ApiSharedMedia, ApiShareTokenInfo } from '@/types/api';

/** Public-by-token resolution. Used on /share/[token]. */
export function useSharedMedia(token: string | null | undefined) {
  return useQuery<ApiSharedMedia>({
    queryKey: ['share', token],
    queryFn: ({ signal }) => resolveShare(token!, signal),
    enabled: !!token,
    // Share URLs are permanent but the inner signed URLs are short-lived.
    // Refresh every 5 minutes so playback URLs are always fresh in long-open
    // tabs.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Owner-side: get-or-mint a share token for a saved media. */
export function useShareToken() {
  const qc = useQueryClient();
  return useMutation<ApiShareTokenInfo, Error, string>({
    mutationFn: (savedMediaId) => getShareToken(savedMediaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

/** Owner-side: revoke a token (e.g. if shared to the wrong person). */
export function useRevokeShareToken() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (savedMediaId) => revokeShareToken(savedMediaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}
