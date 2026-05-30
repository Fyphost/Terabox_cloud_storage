import { apiFetch } from './client';
import type {
  ApiEnqueuedClaim,
  ApiEnqueueSaveResult,
  ApiSavedMediaProgress,
} from '@/types/api';

export function saveQualities(
  mediaId: string,
  qualities: string[],
  signal?: AbortSignal,
): Promise<ApiEnqueueSaveResult> {
  return apiFetch<ApiEnqueueSaveResult>('/save', {
    method: 'POST',
    body: { mediaId, qualities },
    signal,
  });
}

export function getSavedMediaProgress(
  savedMediaId: string,
  signal?: AbortSignal,
): Promise<ApiSavedMediaProgress> {
  return apiFetch<ApiSavedMediaProgress>(
    `/save/${encodeURIComponent(savedMediaId)}`,
    { signal },
  );
}

export function retrySavedVariant(savedVariantId: string): Promise<ApiEnqueuedClaim> {
  return apiFetch<ApiEnqueuedClaim>(
    `/save/variant/${encodeURIComponent(savedVariantId)}/retry`,
    { method: 'POST' },
  );
}
