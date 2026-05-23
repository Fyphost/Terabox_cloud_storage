'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { Bookmark, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MediaInfo from '@/components/media/MediaInfo';
import SaveDialog from '@/components/media/SaveDialog';
import PlayerSkeleton from '@/components/player/PlayerSkeleton';
import { useMedia } from '@/hooks/use-media';

const HlsPlayer = dynamic(() => import('@/components/player/HlsPlayer'), {
  ssr: false,
  loading: () => <PlayerSkeleton />,
});

export default function MediaPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data: media, isLoading, error } = useMedia(id);

  if (isLoading) {
    return (
      <div className="container py-6">
        <PlayerSkeleton />
        <div className="mt-4 h-4 w-48 animate-pulse rounded bg-surface" />
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="container py-10 text-center">
        <p className="text-sm text-red-400">
          {error instanceof Error ? error.message : 'Media not found.'}
        </p>
      </div>
    );
  }

  const qualities = media.variants.map((v) => v.quality);

  return (
    <div className="container py-4 md:py-8">
      <HlsPlayer src={media.masterPlaylistUrl} poster={media.thumbnailUrl} />

      <div className="mt-4 md:mt-6">
        <MediaInfo
          name={media.name}
          sizeBytes={media.sizeBytes}
          thumbnailUrl={media.thumbnailUrl}
          qualities={qualities}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SaveDialog
          media={media}
          trigger={
            <Button size="md" variant="primary">
              <Bookmark className="h-4 w-4" aria-hidden /> Save
            </Button>
          }
        />
        {media.variants[0] && (
          <Button asChild size="md" variant="secondary">
            <a href={media.variants[media.variants.length - 1]!.downloadUrl} rel="noopener">
              <Download className="h-4 w-4" aria-hidden /> Download
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
