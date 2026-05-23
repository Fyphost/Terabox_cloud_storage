import type { Media, MediaVariant } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { buildRelativeStreamUrl } from '../../services/signing/signed-url.js';

export interface PresentedVariant {
  id: string;
  quality: string;
  container: 'HLS' | 'MP4' | 'OTHER';
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  sizeBytes: number | null;
  state: MediaVariant['state'];
  playlistUrl: string;
  fileUrl: string;
  downloadUrl: string;
}

export interface PresentedMedia {
  id: string;
  name: string;
  kind: Media['kind'];
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  masterPlaylistUrl: string;
  variants: PresentedVariant[];
}

export async function presentMedia(
  media: Media,
  variants: MediaVariant[],
  userId: string | null,
): Promise<PresentedMedia> {
  const presentedVariants: PresentedVariant[] = variants
    .slice()
    .sort((a, b) => sortQuality(a.quality, b.quality))
    .map((v) => ({
      id: v.id,
      quality: v.quality,
      container: v.container,
      width: v.width,
      height: v.height,
      bitrateBps: v.bitrateBps,
      sizeBytes: v.sizeBytes !== null ? Number(v.sizeBytes) : null,
      state: v.state,
      playlistUrl: buildRelativeStreamUrl(v.id, 'playlist.m3u8', userId),
      fileUrl: buildRelativeStreamUrl(v.id, 'file', userId),
      downloadUrl: buildRelativeStreamUrl(v.id, 'download', userId),
    }));

  // Synthetic master endpoint aggregates all variants for hls.js. Relative.
  const masterPlaylistUrl = `/api/v1/media/${media.id}/master.m3u8`;

  return {
    id: media.id,
    name: media.name,
    kind: media.kind,
    sizeBytes: media.sizeBytes !== null ? Number(media.sizeBytes) : null,
    thumbnailUrl: media.thumbnailUrl,
    durationSec: media.durationSec,
    masterPlaylistUrl,
    variants: presentedVariants,
  };
}

const QUALITY_ORDER = ['240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'];

function sortQuality(a: string, b: string): number {
  const ai = QUALITY_ORDER.indexOf(a);
  const bi = QUALITY_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export async function getMediaById(id: string): Promise<{ media: Media; variants: MediaVariant[] }> {
  const media = await prisma.media.findUnique({
    where: { id },
    include: { variants: true },
  });
  if (!media) throw new AppError('NOT_FOUND', 'Media not found');
  return { media, variants: media.variants };
}
