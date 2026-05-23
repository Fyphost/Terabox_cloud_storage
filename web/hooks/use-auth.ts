'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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

export function useSignup() {
  return useMutation({
    mutationFn: (args: { email: string; password: string; displayName?: string }) => signupApi(args),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { email: string; password: string }) => loginApi(args),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, { user: data.user });
      qc.invalidateQueries({ queryKey: ['library'] });
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
