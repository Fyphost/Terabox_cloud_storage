'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  forgotPassword as forgotPasswordApi,
  getMe,
  login as loginApi,
  logout as logoutApi,
  resendVerification as resendVerificationApi,
  resetPassword as resetPasswordApi,
  signup as signupApi,
  verifyEmail as verifyEmailApi,
  type PublicUser,
} from '@/lib/api/auth';

const ME_KEY = ['auth', 'me'] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => getMe(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function isRegistered(user: PublicUser | null | undefined): user is PublicUser {
  return !!user && user.kind === 'REGISTERED';
}

/**
 * Stable auth gate.
 *
 *   - `ready === true` means the auth bootstrap query has settled at least
 *     once (success OR error). Pages MUST NOT redirect before this is true,
 *     otherwise they race with the cookie/getMe round-trip and create the
 *     login-loop bug we saw in v2.
 *   - When ready and not registered, this hook redirects to /auth/login
 *     once with a `next` param.
 *   - When ready and registered, callers can render the gated UI.
 */
export interface AuthGate {
  ready: boolean;
  user: PublicUser | null;
  isRegistered: boolean;
}

export function useAuthGate(returnTo: string): AuthGate {
  const router = useRouter();
  const q = useCurrentUser();
  const ready = !q.isPending; // first settle (data OR error)
  const user = q.data?.user ?? null;
  const registered = isRegistered(user);

  useEffect(() => {
    if (!ready) return;
    if (!registered) {
      const next = encodeURIComponent(returnTo);
      router.replace(`/auth/login?next=${next}`);
    }
  }, [ready, registered, router, returnTo]);

  return { ready, user, isRegistered: registered };
}

export function useSignup() {
  return useMutation({
    mutationFn: (args: { email: string; password: string; displayName?: string }) => signupApi(args),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { email: string; password: string }) => loginApi(args),
    onSuccess: async (data) => {
      // Prime the cache synchronously, then force /auth/me to refetch and
      // settle BEFORE callers navigate. This eliminates the login-loop where
      // the next page sees a stale "user: null" before the cookie round-trip.
      qc.setQueryData(ME_KEY, { user: data.user });
      await qc.invalidateQueries({ queryKey: ['library'] }).catch(() => undefined);
      await qc.refetchQueries({ queryKey: ME_KEY }).catch(() => undefined);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => logoutApi(),
    onSuccess: async () => {
      qc.setQueryData(ME_KEY, { user: null });
      qc.removeQueries({ queryKey: ['library'] });
      router.push('/');
    },
  });
}

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => verifyEmailApi(token),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, { user: data.user });
    },
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: (email: string) => resendVerificationApi(email) });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (email: string) => forgotPasswordApi(email) });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (args: { token: string; password: string }) => resetPasswordApi(args),
  });
}
