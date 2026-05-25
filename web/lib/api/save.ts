import { apiFetch } from './client.js';
import type { ApiSaveJob, ApiSaveStatus } from '@/types/api';

/**
 * Save the chosen quality permanently. Single-quality contract — the API
 * enforces ONE saved media per (user, media), so re-saving with a different
 * quality replaces the previous selection in place.
 */
export function saveQuality(
  mediaId: string,
  quality: string,
  signal?: AbortSignal,
): Promise<ApiSaveJob> {
  return apiFetch<ApiSaveJob>('/save', {
    method: 'POST',
    body: { mediaId, quality },
    signal,
  });
}

export function getSaveStatus(savedMediaId: string, signal?: AbortSignal): Promise<ApiSaveStatus> {
  return apiFetch<ApiSaveStatus>(`/save/${encodeURIComponent(savedMediaId)}`, { signal });
}

export type { ApiSaveStatus as SaveStatus };
