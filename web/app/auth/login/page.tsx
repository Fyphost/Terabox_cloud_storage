/**
 * Login page — wrapped in Suspense for Next.js 15 App Router compliance.
 *
 * Root cause of build crash:
 *   Next.js 15 requires useSearchParams() to be inside a <Suspense> boundary
 *   because it causes a client-side fetch for the search params during SSR.
 *   Without Suspense, the static generation bailout throws at build time.
 *
 * Fix: export a thin wrapper that provides the Suspense boundary, then render
 * the actual form component inside it.
 */
'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="mx-auto h-8 w-32" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    </div>
  );
}
