import { apiFetch } from './client.js';
import type { ApiLibraryPage } from '@/types/api';

export type LibrarySort = 'recent' | 'oldest' | 'name' | 'size';

export function listLibrary(
  params: { search?: string; cursor?: string; take?: number; sort?: LibrarySort } = {},
  signal?: AbortSignal,
): Promise<ApiLibraryPage> {
  const usp = new URLSearchParams();
  if (params.search) usp.set('search', params.search);
  if (params.cursor) usp.set('cursor', params.cursor);
  if (params.take) usp.set('take', String(params.take));
  if (params.sort) usp.set('sort', params.sort);
  const qs = usp.toString();
  return apiFetch<ApiLibraryPage>(`/library${qs ? `?${qs}` : ''}`, { signal });
}

export function deleteLibraryEntry(savedMediaId: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/library/${encodeURIComponent(savedMediaId)}`, {
    method: 'DELETE',
    signal,
  });
}

export function bulkDeleteLibrary(savedMediaIds: string[]): Promise<{ removed: number }> {
  return apiFetch<{ removed: number }>('/library/bulk-delete', {
    method: 'POST',
    body: { savedMediaIds },
  });
}
