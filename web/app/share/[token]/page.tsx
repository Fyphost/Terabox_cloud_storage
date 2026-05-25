'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MediaInfo from '@/components/media/MediaInfo';
import PlayerSkeleton from '@/components/player/PlayerSkeleton';
import { useSharedMedia } from '@/hooks/use-share';

const HlsPlayer = dynamic(() => import('@/components/player/HlsPlayer'), {
  ssr: false,
  loading: () => <PlayerSkeleton />,
});

/**
 * Public share page.
 *
 * Anyone holding the URL `/share/<token>` lands here. No auth required —
 * the token IS the capability. The page hits `/api/v1/share/<token>` to
 * get a presented Media with freshly-signed playback + download URLs, then
 * mounts the HLS player. Inner signed URLs are short-lived (6h default);
 * the hook refetches every 5 minutes to keep them fresh.
 */
export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const { data, isLoading, error } = useSharedMedia(token);

  if (isLoading) {
    return (
      <div className="container py-6">
        <PlayerSkeleton />
        <div className="mt-4 h-4 w-48 animate-pulse rounded bg-surface" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container py-10 text-center">
        <p className="text-sm text-red-400">
          {error instanceof Error
            ? error.message
            : 'This share link is invalid or has been revoked.'}
        </p>
      </div>
    );
  }

  const { media, selectedQuality } = data;
  const downloadName = media.originalFilename ?? media.name;

  return (
    <div className="container py-4 md:py-8">
      <HlsPlayer src={media.masterPlaylistUrl} poster={media.thumbnailUrl} />

      <div className="mt-4 md:mt-6">
        <MediaInfo
          name={media.name}
          sizeBytes={media.sourceSizeBytes ?? media.sizeBytes}
          thumbnailUrl={media.thumbnailUrl}
          qualities={[selectedQuality]}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {media.sourceDownloadUrl && (
          <Button asChild size="md" variant="primary">
            <a href={media.sourceDownloadUrl} download={downloadName} rel="noopener">
              <Download className="h-4 w-4" aria-hidden /> Download
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
