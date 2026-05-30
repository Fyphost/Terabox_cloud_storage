import { apiFetch } from './client';

export interface AdminQueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface AdminStats {
  users: { total: number; registered: number; anon: number; verified: number };
  media: { total: number; variants: number; persisted: number };
  saves: { total: number; complete: number; pending: number; downloading: number; failed: number };
  storage: { permanentBytes: number; cacheBytes: number };
  queues: { save: AdminQueueCounts; cleanupCache: AdminQueueCounts; cleanupStorage: AdminQueueCounts };
}

export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  kind: 'ANON' | 'REGISTERED';
  role: 'USER' | 'ADMIN';
  emailVerifiedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export function getAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  return apiFetch<AdminStats>('/admin/stats', { signal });
}

export function listAdminUsers(
  params: { cursor?: string; take?: number } = {},
  signal?: AbortSignal,
): Promise<{ items: AdminUser[]; nextCursor: string | null }> {
  const usp = new URLSearchParams();
  if (params.cursor) usp.set('cursor', params.cursor);
  if (params.take) usp.set('take', String(params.take));
  const qs = usp.toString();
  return apiFetch(`/admin/users${qs ? `?${qs}` : ''}`, { signal });
}

export function listFailedAdminJobs(
  params: { take?: number } = {},
  signal?: AbortSignal,
): Promise<Array<{
  id: string | undefined;
  name: string;
  data: unknown;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: number;
}>> {
  const usp = new URLSearchParams();
  if (params.take) usp.set('take', String(params.take));
  const qs = usp.toString();
  return apiFetch(`/admin/jobs/failed${qs ? `?${qs}` : ''}`, { signal });
}
