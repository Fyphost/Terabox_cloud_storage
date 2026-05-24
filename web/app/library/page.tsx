'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import LibraryGrid from '@/components/library/LibraryGrid';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthGate } from '@/hooks/use-auth';

export default function LibraryPage() {
  const auth = useAuthGate('/library');

  return (
    <div className="container py-6 md:py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Library</h1>
          <p className="mt-1 text-sm text-muted-fg">
            Stream what you saved — local only, independent of upstream links.
          </p>
        </div>
        <Button asChild size="md">
          <Link href="/?focus=1">
            <Plus className="h-4 w-4" aria-hidden /> Add video
          </Link>
        </Button>
      </header>

      {!auth.ready || !auth.isRegistered ? (
        <Skeleton className="h-10 w-full max-w-md" />
      ) : (
        <LibraryGrid />
      )}
    </div>
  );
}
