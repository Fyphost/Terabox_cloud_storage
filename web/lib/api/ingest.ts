import { apiFetch } from './client.js';
import type { ApiMedia } from '@/types/api';

export function ingestUrl(url: string, signal?: AbortSignal): Promise<ApiMedia> {
  return apiFetch<ApiMedia>('/ingest', { method: 'POST', body: { url }, signal });
}
