'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { ArrowLeft, Bookmark, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import PlayerSkeleton from '@/components/player/PlayerSkeleton';
import SaveProgress from '@/components/library/SaveProgress';
import ShareMenu from '@/components/media/ShareMenu';
import { useAuthGate } from '@/hooks/use-auth';
import { useDeleteFromLibrary, useSavedMedia } from '@/hooks/use-library';
import { toast } from '@/lib/store/ui.store';
import { formatBytes, formatDuration } from '@/lib/utils/format';
import type { ApiLibraryVariant } from '@/types/api';
import { useRouter } from 'next/navigation';

const HlsPlayer = dynamic(() => import('@/components/player/HlsPlayer'), {
  ssr: false,
  loading: () => <PlayerSkeleton />,
});

const VALID_ID = /^[A-Za-z0-9_-]{4,40}$/;

export default function WatchPage() {
  const router = useRouter();
  const rawParam = useParams<{ savedMediaId: string | string[] }>()?.savedMediaId;
  const savedMediaId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
  if (!savedMediaId || !VALID_ID.test(savedMediaId.trim())) {
    notFound();
  }

  const auth = useAuthGate(`/watch/${savedMediaId}`);
  const { data, isLoading, error } = useSavedMedia(auth.isRegistered ? savedMediaId : null);
  const del = useDeleteFromLibrary();

  if (!auth.ready || (!auth.isRegistered)) {
    return (
      <div className="container py-6 md:py-10">
        <PlayerSkeleton />
        <Skeleton className="mt-4 h-6 w-1/2" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container py-6 md:py-10">
        <PlayerSkeleton />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container py-10 text-center">
        <p className="text-sm text-danger">
          {error instanceof Error ? error.message : 'Saved media not found.'}
        </p>
      </div>
    );
  }

  const persistedVariants = data.variants.filter((v) => v.state === 'PERSISTED');
  const hasPlayable = data.masterPlaylistUrl !== null && persistedVariants.length > 0;

  const onDelete = async () => {
    if (!confirm('Remove this from your library?')) return;
    try {
      await del.mutateAsync(data.savedMediaId);
      toast({ variant: 'success', title: 'Removed from library' });
      router.push('/library');
    } catch {
      toast({ variant: 'error', title: 'Could not remove' });
    }
  };

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/watch/${data.savedMediaId}`
      : `/watch/${data.savedMediaId}`;

  return (
    <div className="container max-w-5xl py-4 md:py-8">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Library
      </Link>

      <div className="mt-3">
        {hasPlayable ? (
          <HlsPlayer src={data.masterPlaylistUrl} poster={data.media.thumbnailUrl} />
        ) : (
          <NotReadyPlaceholder thumbnailUrl={data.media.thumbnailUrl} />
        )}
      </div>

      <section className="mt-5 flex gap-4 md:mt-7">
        <div className="relative hidden h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-muted md:block">
          {data.media.thumbnailUrl ? (
            <Image src={data.media.thumbnailUrl} alt="" fill sizes="160px" className="object-cover" unoptimized />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-balance text-xl font-semibold tracking-tight md:text-2xl">
            {data.media.name}
          </h1>
          <p className="mt-1 text-sm text-muted-fg">
            {formatBytes(data.media.sizeBytes)}
            {data.media.durationSec ? ` · ${formatDuration(data.media.durationSec)}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.variants.map((v) => (
              <span
                key={v.savedVariantId}
                className="inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-fg"
              >
                {v.quality}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-5 flex flex-wrap items-center gap-2 md:mt-6">
        <DownloadDropdown variants={persistedVariants} mediaName={data.media.name} />
        <ShareMenu shareUrl={shareUrl} title={data.media.name} />
        <Button variant="ghost" size="md" onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden /> Remove
        </Button>
        <Button asChild variant="ghost" size="md" className="ml-auto">
          <Link href={`/m/${data.media.id}`}>
            <Bookmark className="h-4 w-4" aria-hidden /> Add another quality
          </Link>
        </Button>
      </section>

      {data.variants.some((v) => v.state !== 'PERSISTED') && (
        <section className="mt-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-fg">
            Save progress
          </h2>
          <SaveProgress variants={data.variants} />
        </section>
      )}
    </div>
  );
}

function NotReadyPlaceholder({ thumbnailUrl }: { thumbnailUrl: string | null }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted">
      {thumbnailUrl ? (
        <Image src={thumbnailUrl} alt="" fill sizes="100vw" className="object-cover opacity-40" unoptimized />
      ) : null}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
        <span className="text-sm font-medium">Saving in progress…</span>
        <span className="text-xs text-white/80">Playback will be available once at least one quality is ready.</span>
      </div>
    </div>
  );
}

function DownloadDropdown({
  variants,
  mediaName,
}: {
  variants: ApiLibraryVariant[];
  mediaName: string;
}) {
  if (variants.length === 0) {
    return (
      <Button variant="secondary" size="md" disabled>
        <Download className="h-4 w-4" aria-hidden /> Download
      </Button>
    );
  }
  if (variants.length === 1) {
    const v = variants[0]!;
    return (
      <Button asChild variant="secondary" size="md">
        <a href={v.downloadUrl ?? '#'} rel="noopener" download={`${mediaName} ${v.quality}.mp4`}>
          <Download className="h-4 w-4" aria-hidden /> Download {v.quality}
        </a>
      </Button>
    );
  }
  // Render as inline buttons to keep it simple — quality picker dialog
  // already exists for the preview page; library uses inline buttons since
  // the user already chose qualities at save time.
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {variants
        .slice()
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
        .map((v) => (
          <Button asChild key={v.savedVariantId} variant="secondary" size="sm">
            <a href={v.downloadUrl ?? '#'} rel="noopener" download={`${mediaName} ${v.quality}.mp4`}>
              <Download className="h-3.5 w-3.5" aria-hidden /> {v.quality}
            </a>
          </Button>
        ))}
    </div>
  );
}
