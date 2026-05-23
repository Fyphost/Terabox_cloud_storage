import { apiFetch } from './client.js';
import type { ApiLibraryPage } from '@/types/api';

export function listLibrary(
  params: { search?: string; cursor?: string; take?: number } = {},
  signal?: AbortSignal,
): Promise<ApiLibraryPage> {
  const usp = new URLSearchParams();
  if (params.search) usp.set('search', params.search);
  if (params.cursor) usp.set('cursor', params.cursor);
  if (params.take) usp.set('take', String(params.take));
  const qs = usp.toString();
  return apiFetch<ApiLibraryPage>(`/library${qs ? `?${qs}` : ''}`, { signal });
}

export function deleteLibraryEntry(savedMediaId: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/library/${encodeURIComponent(savedMediaId)}`, {
    method: 'DELETE',
    signal,
  });
}
