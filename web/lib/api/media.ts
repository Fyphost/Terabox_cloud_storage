import { apiFetch } from './client.js';
import type { ApiMedia } from '@/types/api';

export function getMedia(id: string, signal?: AbortSignal): Promise<ApiMedia> {
  return apiFetch<ApiMedia>(`/media/${encodeURIComponent(id)}`, { signal });
}
