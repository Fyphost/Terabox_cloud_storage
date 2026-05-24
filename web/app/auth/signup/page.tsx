'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import SignupForm from './SignupForm';

export default function SignupPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-20 h-[400px] w-full max-w-md rounded-2xl" />}>
      <SignupForm />
    </Suspense>
  );
}
