import { apiFetch } from './client.js';

export function ensureAnon(): Promise<{ userId: string; token: string }> {
  return apiFetch('/auth/anon', { method: 'POST' });
}

export function getMe(): Promise<{ user: { id: string; kind: string; email: string | null } | null }> {
  return apiFetch('/auth/me');
}
