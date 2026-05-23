import { apiFetch } from './client.js';
import type { ApiSaveJob } from '@/types/api';

export function saveQualities(
  mediaId: string,
  qualities: string[],
  signal?: AbortSignal,
): Promise<{ jobs: ApiSaveJob[] }> {
  return apiFetch<{ jobs: ApiSaveJob[] }>('/save', {
    method: 'POST',
    body: { mediaId, qualities },
    signal,
  });
}

export interface SaveStatus {
  savedMediaId: string;
  variantId: string;
  quality: string;
  state: 'PENDING' | 'DOWNLOADING' | 'COMPLETE' | 'FAILED';
  progress: number;
  error: string | null;
}

export function getSaveStatus(savedMediaId: string, signal?: AbortSignal): Promise<SaveStatus> {
  return apiFetch<SaveStatus>(`/save/${encodeURIComponent(savedMediaId)}`, { signal });
}
