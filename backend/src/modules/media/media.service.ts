/**
 * modules/media/media.service.ts
 *
 * Presents Media + variants for the API. The shape encodes the
 * "download is media-scoped, not variant-scoped" architectural rule.
 *
 * What changed
 * ─────────────────────────────────────────────────────────────────────────────
 *   • Removed the per-variant `downloadUrl`. Downloads are no longer per
 *     quality — there is exactly one canonical download per Media (the
 *     `Media.sourceStorageKey`).
 *   • Added top-level `sourceDownloadUrl`, `sourceFileUrl`, `sourceState`,
 *     `sourceSizeBytes`, and `originalFilename`.
 *   • The signing subject for the download URL is still a variantId (so the
 *     existing HMAC signing scheme is unchanged), chosen as the first
 *     available variant. The route resolves the actual bytes from the
 *     variant's Media, so picking any variant is correct.
 */

import type { Media, MediaVariant } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { buildSignedPath, sign } from '../../services/signing/signed-url.js';

export type MediaSourceState = 'EPHEMERAL' | 'PERSISTED' | 'PENDING_DELETE';

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
}

export interface PresentedMedia {
  id: string;
  name: string;
  originalFilename: string | null;
  kind: Media['kind'];
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  durationSec: number | null;

  /** Synthetic master playlist (HLS) — for streaming. */
  masterPlaylistUrl: string;

  /** Canonical download — signed URL serving Media.sourceStorageKey. */
  sourceDownloadUrl: string;
  /** Same byte source as sourceDownloadUrl, no Content-Disposition. */
  sourceFileUrl: string;
  /** Lifecycle state of the canonical source artifact. */
  sourceState: MediaSourceState;
  sourceSizeBytes: number | null;
  sourceContentType: string | null;

  variants: PresentedVariant[];
}

function signedUrl(variantId: string, resource: string, userId: string | null): string {
  const q = sign({ variantId, resource, userId });
  return buildSignedPath(`${env.PUBLIC_BASE_URL}/api/v1/stream/${variantId}/${resource}`, q);
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

function pickSigningVariant(variants: MediaVariant[]): MediaVariant | null {
  if (variants.length === 0) return null;
  // Prefer a PERSISTED variant for stability (its bytes are guaranteed),
  // otherwise the highest quality available.
  const persisted = variants.find((v) => v.state === 'PERSISTED');
  if (persisted) return persisted;
  const sorted = [...variants].sort((a, b) => sortQuality(b.quality, a.quality));
  return sorted[0] ?? null;
}

function deriveSourceState(media: Media): MediaSourceState {
  if (!media.sourceStorageKey) return 'EPHEMERAL';
  if (media.sourcePendingDeleteAt) return 'PENDING_DELETE';
  return 'PERSISTED';
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
      playlistUrl: signedUrl(v.id, 'playlist.m3u8', userId),
      fileUrl: signedUrl(v.id, 'file', userId),
    }));

  const masterPlaylistUrl = `${env.PUBLIC_BASE_URL}/api/v1/media/${media.id}/master.m3u8`;

  const signingVariant = pickSigningVariant(variants);
  const sourceDownloadUrl = signingVariant
    ? signedUrl(signingVariant.id, 'download', userId)
    : '';
  const sourceFileUrl = signingVariant
    ? signedUrl(signingVariant.id, 'file', userId)
    : '';

  return {
    id: media.id,
    name: media.name,
    originalFilename: media.originalFilename,
    kind: media.kind,
    sizeBytes: media.sizeBytes !== null ? Number(media.sizeBytes) : null,
    thumbnailUrl: media.thumbnailUrl,
    durationSec: media.durationSec,
    masterPlaylistUrl,
    sourceDownloadUrl,
    sourceFileUrl,
    sourceState: deriveSourceState(media),
    sourceSizeBytes: media.sourceSizeBytes !== null ? Number(media.sourceSizeBytes) : null,
    sourceContentType: media.sourceContentType,
    variants: presentedVariants,
  };
}

export async function getMediaById(
  id: string,
): Promise<{ media: Media; variants: MediaVariant[] }> {
  const media = await prisma.media.findUnique({
    where: { id },
    include: { variants: true },
  });
  if (!media) throw new AppError('NOT_FOUND', 'Media not found');
  return { media, variants: media.variants };
}
