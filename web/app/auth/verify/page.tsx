'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import VerifyContent from './VerifyContent';

export default function VerifyPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-20 h-[300px] w-full max-w-md rounded-2xl" />}>
      <VerifyContent />
    </Suspense>
  );
}
