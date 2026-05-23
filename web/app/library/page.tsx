'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import LibraryGrid from '@/components/library/LibraryGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser, isRegistered } from '@/hooks/use-auth';

export default function LibraryPage() {
  const router = useRouter();
  const { data, isLoading } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && !isRegistered(data?.user)) {
      router.replace('/auth/login?next=/library');
    }
  }, [isLoading, data?.user, router]);

  return (
    <div className="container py-6 md:py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Library</h1>
          <p className="mt-1 text-sm text-muted-fg">Stream media you saved.</p>
        </div>
      </header>

      {isLoading || !isRegistered(data?.user) ? (
        <Skeleton className="h-10 w-full max-w-md" />
      ) : (
        <LibraryGrid />
      )}
    </div>
  );
}
