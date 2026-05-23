import { apiFetch } from './client.js';

export interface PublicUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: 'USER' | 'ADMIN';
  kind: 'ANON' | 'REGISTERED';
  emailVerified: boolean;
  createdAt: string;
}

export interface MeResponse {
  user: PublicUser | null;
}

export function getMe(signal?: AbortSignal): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me', { signal, skipRefresh: true });
}

export function ensureAnon(): Promise<{ user: PublicUser }> {
  return apiFetch('/auth/anon', { method: 'POST', skipRefresh: true });
}

export function signup(args: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ user: PublicUser; message: string }> {
  return apiFetch('/auth/signup', { method: 'POST', body: args, skipRefresh: true });
}

export function login(args: { email: string; password: string }): Promise<{ user: PublicUser }> {
  return apiFetch('/auth/login', { method: 'POST', body: args, skipRefresh: true });
}

export function logout(): Promise<void> {
  return apiFetch('/auth/logout', { method: 'POST', skipRefresh: true });
}

export function verifyEmail(token: string): Promise<{ user: PublicUser; message: string }> {
  return apiFetch('/auth/verify-email', { method: 'POST', body: { token }, skipRefresh: true });
}

export function resendVerification(email: string): Promise<void> {
  return apiFetch('/auth/resend-verification', {
    method: 'POST',
    body: { email },
    skipRefresh: true,
  });
}

export function forgotPassword(email: string): Promise<void> {
  return apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: { email },
    skipRefresh: true,
  });
}

export function resetPassword(args: { token: string; password: string }): Promise<void> {
  return apiFetch('/auth/reset-password', {
    method: 'POST',
    body: args,
    skipRefresh: true,
  });
}
