/**
 * Library service — saved-media catalog + presentation.
 *
 * Two presentation shapes:
 *
 *   - LibraryListItem: compact, used by the list/grid view.
 *   - SavedMediaDetail: full, used by /watch/:savedMediaId. Includes
 *     signed local URLs for every PERSISTED variant + the master playlist.
 *
 * No saved-media URL ever points at upstream. All signed URLs route to
 * /api/v1/library/:savedMediaId/... handlers backed by permanent storage.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { buildLibrarySignedUrl } from '../../services/signing/signed-url.js';

export type LibrarySort = 'recent' | 'oldest' | 'name' | 'size';

export interface LibraryVariantPresented {
  variantId: string;
  savedVariantId: string;
  quality: string;
  state: string;
  pipelineStep: string | null;
  progress: number;
  bytesDone: number;
  bytesTotal: number | null;
  speedBytesPerSec: number | null;
  etaSec: number | null;
  errorMessage: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  /** Set only when state == PERSISTED. Null otherwise — UI must not render. */
  playlistUrl: string | null;
  downloadUrl: string | null;
}

export interface LibraryMediaPresented {
  id: string;
  name: string;
  durationSec: number | null;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
}

export interface LibraryListItem {
  savedMediaId: string;
  state: string;
  createdAt: string;
  completedAt: string | null;
  media: LibraryMediaPresented;
  /** Best-available quality summary for cards: highest PERSISTED, else highest claimed. */
  topQuality: string | null;
  variants: LibraryVariantPresented[];
}

export interface SavedMediaDetail extends LibraryListItem {
  /** Master playlist URL — only when at least one variant is PERSISTED. */
  masterPlaylistUrl: string | null;
}

const QUALITY_ORDER = ['240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'];

function rankQuality(q: string): number {
  const i = QUALITY_ORDER.indexOf(q);
  return i === -1 ? -1 : i;
}

function variantThumbUrl(savedMediaId: string, mediaId: string, hasThumb: boolean): string | null {
  if (!hasThumb) return null;
  return buildLibrarySignedUrl(savedMediaId, 'thumb.jpg');
}

function presentVariant(
  savedMediaId: string,
  variant: {
    id: string;
    quality: string;
    state: string;
    pipelineStep: string | null;
    progress: number;
    bytesDone: bigint;
    bytesTotal: bigint | null;
    speedBytesPerSec: number | null;
    etaSec: number | null;
    errorMessage: string | null;
    sizeBytes: bigint | null;
    width: number | null;
    height: number | null;
    bitrateBps: number | null;
  },
  savedVariantId: string,
): LibraryVariantPresented {
  const persisted = variant.state === 'PERSISTED';
  return {
    variantId: variant.id,
    savedVariantId,
    quality: variant.quality,
    state: variant.state,
    pipelineStep: variant.pipelineStep,
    progress: variant.progress,
    bytesDone: Number(variant.bytesDone),
    bytesTotal: variant.bytesTotal !== null ? Number(variant.bytesTotal) : null,
    speedBytesPerSec: variant.speedBytesPerSec,
    etaSec: variant.etaSec,
    errorMessage: variant.errorMessage,
    sizeBytes: variant.sizeBytes !== null ? Number(variant.sizeBytes) : null,
    width: variant.width,
    height: variant.height,
    bitrateBps: variant.bitrateBps,
    playlistUrl: persisted
      ? buildLibrarySignedUrl(savedMediaId, `variant/${variant.id}/playlist.m3u8`)
      : null,
    downloadUrl: persisted
      ? buildLibrarySignedUrl(savedMediaId, `variant/${variant.id}/download`)
      : null,
  };
}

export async function listSavedMedia(
  userId: string,
  opts: { search?: string; cursor?: string; take?: number; sort?: LibrarySort } = {},
): Promise<{ items: LibraryListItem[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(opts.take ?? 20, 1), 50);
  const sort = opts.sort ?? 'recent';

  const where: Prisma.SavedMediaWhereInput = {
    userId,
    ...(opts.search
      ? { media: { name: { contains: opts.search, mode: 'insensitive' } } }
      : {}),
  };

  const orderBy: Prisma.SavedMediaOrderByWithRelationInput[] = (() => {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'name':
        return [{ media: { name: 'asc' } }, { id: 'asc' }];
      case 'size':
        return [{ media: { sizeBytes: 'desc' } }, { id: 'desc' }];
      case 'recent':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  })();

  const rows = await prisma.savedMedia.findMany({
    where,
    include: {
      media: { select: { id: true, name: true, durationSec: true, sizeBytes: true, thumbnailKey: true, thumbnailUrl: true } },
      variants: {
        include: {
          variant: {
            select: {
              id: true,
              quality: true,
              state: true,
              pipelineStep: true,
              progress: true,
              bytesDone: true,
              bytesTotal: true,
              speedBytesPerSec: true,
              etaSec: true,
              errorMessage: true,
              sizeBytes: true,
              width: true,
              height: true,
              bitrateBps: true,
            },
          },
        },
      },
    },
    orderBy,
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const trimmed = rows.slice(0, take);
  const nextCursor = rows.length > take ? rows[rows.length - 1]!.id : null;

  const items: LibraryListItem[] = trimmed.map((row) => {
    const variants = row.variants.map((sv) => presentVariant(row.id, sv.variant, sv.id));
    const topPersisted = variants
      .filter((v) => v.state === 'PERSISTED')
      .sort((a, b) => rankQuality(b.quality) - rankQuality(a.quality))[0];
    const topAny = variants.sort((a, b) => rankQuality(b.quality) - rankQuality(a.quality))[0];
    const topQuality = topPersisted?.quality ?? topAny?.quality ?? null;
    return {
      savedMediaId: row.id,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      media: {
        id: row.media.id,
        name: row.media.name,
        durationSec: row.media.durationSec,
        sizeBytes: row.media.sizeBytes !== null ? Number(row.media.sizeBytes) : null,
        thumbnailUrl:
          variantThumbUrl(row.id, row.media.id, !!row.media.thumbnailKey) ?? row.media.thumbnailUrl ?? null,
      },
      topQuality,
      variants,
    };
  });

  return { items, nextCursor };
}

export async function getSavedMediaDetail(
  savedMediaId: string,
  userId: string,
): Promise<SavedMediaDetail> {
  const row = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: {
      media: true,
      variants: {
        include: { variant: true },
      },
    },
  });
  if (!row || row.userId !== userId) throw new AppError('NOT_FOUND', 'Saved media not found');

  const variants = row.variants.map((sv) =>
    presentVariant(row.id, sv.variant, sv.id),
  );
  const anyPersisted = variants.some((v) => v.state === 'PERSISTED');
  const masterPlaylistUrl = anyPersisted
    ? buildLibrarySignedUrl(row.id, 'master.m3u8')
    : null;

  const topPersisted = variants
    .filter((v) => v.state === 'PERSISTED')
    .sort((a, b) => rankQuality(b.quality) - rankQuality(a.quality))[0];

  return {
    savedMediaId: row.id,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    media: {
      id: row.media.id,
      name: row.media.name,
      durationSec: row.media.durationSec,
      sizeBytes: row.media.sizeBytes !== null ? Number(row.media.sizeBytes) : null,
      thumbnailUrl:
        variantThumbUrl(row.id, row.media.id, !!row.media.thumbnailKey) ?? row.media.thumbnailUrl ?? null,
    },
    topQuality: topPersisted?.quality ?? variants[0]?.quality ?? null,
    variants,
    masterPlaylistUrl,
  };
}

export async function deleteSavedMedia(savedMediaId: string, userId: string): Promise<void> {
  const sm = await prisma.savedMedia.findUnique({ where: { id: savedMediaId } });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Saved media not found');

  // Cascade deletes the SavedVariant rows.
  await prisma.savedMedia.delete({ where: { id: savedMediaId } });

  // Find variants that no longer have any saved claim → mark for cleanup.
  const orphanedVariants = await prisma.mediaVariant.findMany({
    where: {
      mediaId: sm.mediaId,
      savedVariants: { none: {} },
      state: 'PERSISTED',
    },
    select: { id: true },
  });
  if (orphanedVariants.length > 0) {
    await prisma.mediaVariant.updateMany({
      where: { id: { in: orphanedVariants.map((v) => v.id) } },
      data: { state: 'PENDING_DELETE' },
    });
  }
}

export async function bulkDeleteSavedMedia(
  ids: string[],
  userId: string,
): Promise<number> {
  const owned = await prisma.savedMedia.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, mediaId: true },
  });
  if (owned.length === 0) throw new AppError('NOT_FOUND', 'No matching library entries');

  await prisma.savedMedia.deleteMany({ where: { id: { in: owned.map((o) => o.id) } } });

  const mediaIds = Array.from(new Set(owned.map((o) => o.mediaId)));
  for (const mediaId of mediaIds) {
    const orphans = await prisma.mediaVariant.findMany({
      where: { mediaId, savedVariants: { none: {} }, state: 'PERSISTED' },
      select: { id: true },
    });
    if (orphans.length > 0) {
      await prisma.mediaVariant.updateMany({
        where: { id: { in: orphans.map((v) => v.id) } },
        data: { state: 'PENDING_DELETE' },
      });
    }
  }
  return owned.length;
}
