import { apiFetch } from './client';
import type { ApiMedia } from '@/types/api';

/**
 * Trigger ingestion. The homepage analyze button always sends
 * forceRefresh=true so the user never sees stale extractor output.
 */
export function ingestUrl(url: string, opts: { forceRefresh?: boolean } = {}, signal?: AbortSignal): Promise<ApiMedia> {
  return apiFetch<ApiMedia>('/ingest', {
    method: 'POST',
    body: { url, forceRefresh: opts.forceRefresh ?? false },
    signal,
  });
}
