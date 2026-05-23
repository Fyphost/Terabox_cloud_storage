'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { notFound, useParams } from 'next/navigation';
import { Bookmark, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import DownloadModal from '@/components/media/DownloadModal';
import SaveDialog from '@/components/media/SaveDialog';
import ShareMenu from '@/components/media/ShareMenu';
import PlayerSkeleton from '@/components/player/PlayerSkeleton';
import { useMedia } from '@/hooks/use-media';
import { formatBytes, formatDuration } from '@/lib/utils/format';

const HlsPlayer = dynamic(() => import('@/components/player/HlsPlayer'), {
  ssr: false,
  loading: () => <PlayerSkeleton />,
});

// IDs are app-generated short strings prefixed by `med_`.
const VALID_ID = /^[A-Za-z0-9_-]{4,40}$/;

export default function MediaPage() {
  const params = useParams<{ id: string | string[] }>();
  // Defensive: Next can hand back string[] for catch-all params; we only have a single segment.
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const id = typeof raw === 'string' ? raw.trim() : '';

  if (!id || !VALID_ID.test(id)) {
    notFound();
  }

  const { data: media, isLoading, error } = useMedia(id);

  if (isLoading) {
    return (
      <div className="container py-4 md:py-8">
        <PlayerSkeleton />
        <div className="mt-5 flex gap-4">
          <Skeleton className="h-20 w-32 md:h-24 md:w-40" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="container py-10 text-center">
        <p className="text-sm text-danger">
          {error instanceof Error ? error.message : 'Media not found.'}
        </p>
      </div>
    );
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/m/${media.id}` : `/m/${media.id}`;

  return (
    <div className="container max-w-5xl py-4 md:py-8">
      <HlsPlayer src={media.masterPlaylistUrl} poster={media.thumbnailUrl} />

      <section className="mt-5 flex gap-4 md:mt-7">
        <div className="relative hidden h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-muted md:block">
          {media.thumbnailUrl ? (
            <Image src={media.thumbnailUrl} alt="" fill sizes="160px" className="object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-balance text-xl font-semibold tracking-tight md:text-2xl">
            {media.name}
          </h1>
          <p className="mt-1 text-sm text-muted-fg">
            {formatBytes(media.sizeBytes)}
            {media.durationSec ? ` · ${formatDuration(media.durationSec)}` : ''}
            {' · '}
            {media.variants.length} qualit{media.variants.length === 1 ? 'y' : 'ies'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {media.variants.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-fg"
              >
                {v.quality}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-5 flex flex-wrap items-center gap-2 md:mt-6">
        <SaveDialog
          media={media}
          trigger={
            <Button size="md" variant="primary">
              <Bookmark className="h-4 w-4" aria-hidden /> Save
            </Button>
          }
        />
        <DownloadModal
          media={media}
          trigger={
            <Button size="md" variant="secondary" asChild={false}>
              <Download className="h-4 w-4" aria-hidden /> Download
            </Button>
          }
        />
        <ShareMenu shareUrl={shareUrl} title={media.name} />
      </section>
    </div>
  );
}
