import { apiFetch } from './client.js';
import type { ApiShareTokenInfo, ApiSharedMedia } from '@/types/api';

/**
 * Public: resolve a share token to a media presentation with freshly-signed
 * playback URLs. No auth required (the token is the capability).
 */
export function resolveShare(token: string, signal?: AbortSignal): Promise<ApiSharedMedia> {
  return apiFetch<ApiSharedMedia>(`/share/${encodeURIComponent(token)}`, { signal });
}

/** Authenticated: mint or fetch the share token for a SavedMedia. Idempotent. */
export function getShareToken(
  savedMediaId: string,
  signal?: AbortSignal,
): Promise<ApiShareTokenInfo> {
  return apiFetch<ApiShareTokenInfo>(`/share/by-saved/${encodeURIComponent(savedMediaId)}`, {
    method: 'POST',
    signal,
  });
}

/** Authenticated: revoke a share token (owner only). */
export function revokeShareToken(savedMediaId: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/share/by-saved/${encodeURIComponent(savedMediaId)}`, {
    method: 'DELETE',
    signal,
  });
}
