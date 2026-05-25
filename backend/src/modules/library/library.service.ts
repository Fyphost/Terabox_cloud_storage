/**
 * modules/library/library.service.ts
 *
 * Per-user library: ONE entry per Media (not per quality), each carrying
 * its share token, the user's chosen quality, and a presented Media with a
 * fresh canonical download URL.
 *
 * Delete semantics
 * ─────────────────────────────────────────────────────────────────────────────
 * When a SavedMedia is deleted:
 *   1. The row is removed.
 *   2. If no other user references the same selectedVariant, that variant
 *      is marked PENDING_DELETE; storage-cleanup will purge HLS bytes after
 *      the grace period.
 *   3. If no other user has any SavedMedia for the same Media, the Media's
 *      canonical source artifact (`source.mp4`) is marked
 *      sourcePendingDeleteAt; storage-cleanup will purge bytes after the
 *      grace period and clear the source columns.
 *   4. ShareToken is deleted by ON DELETE CASCADE on the FK; the
 *      previously-shared link returns 404.
 */

import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { presentMedia, type PresentedMedia } from '../media/media.service.js';

export interface LibraryEntry {
  savedMediaId: string;
  mediaId: string;
  state: string;
  progress: number;
  selectedQuality: string;
  selectedVariantId: string | null;
  createdAt: string;
  updatedAt: string | null;
  shareToken: string | null;
  shareUrl: string | null;
  media: PresentedMedia;
}

export async function listLibrary(
  userId: string,
  opts: { search?: string; cursor?: string; take?: number } = {},
): Promise<{ items: LibraryEntry[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(opts.take ?? 20, 1), 50);

  const saved = await prisma.savedMedia.findMany({
    where: {
      userId,
      ...(opts.search
        ? { media: { name: { contains: opts.search, mode: 'insensitive' } } }
        : {}),
    },
    include: {
      media: { include: { variants: true } },
      selectedVariant: true,
      shareToken: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const trimmed = saved.slice(0, take);
  const nextCursor = saved.length > take ? saved[saved.length - 1]!.id : null;

  const items: LibraryEntry[] = await Promise.all(
    trimmed.map(async (s) => {
      const presented = await presentMedia(s.media, s.media.variants, userId);
      const shareToken = s.shareToken?.token ?? null;
      const shareUrl = shareToken ? buildShareUrl(shareToken) : null;
      return {
        savedMediaId: s.id,
        mediaId: s.mediaId,
        state: s.state,
        progress: s.progress,
        selectedQuality: s.selectedQuality,
        selectedVariantId: s.selectedVariantId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
        shareToken,
        shareUrl,
        media: presented,
      };
    }),
  );

  return { items, nextCursor };
}

function buildShareUrl(token: string): string {
  // Inlined here to avoid importing the share service in the library service
  // (a circular import would result). Both functions read from env.PUBLIC_BASE_URL.
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/api\/v1\/?$/, '');
  return `${base}/share/${token}`;
}

export async function deleteLibraryEntry(savedMediaId: string, userId: string): Promise<void> {
  const sm = await prisma.savedMedia.findUnique({ where: { id: savedMediaId } });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Library entry not found');

  await prisma.$transaction(async (tx) => {
    // 1. Remove the SavedMedia (cascades the ShareToken).
    await tx.savedMedia.delete({ where: { id: savedMediaId } });

    // 2. Variant orphan check.
    if (sm.selectedVariantId) {
      const variantRefs = await tx.savedMedia.count({
        where: { selectedVariantId: sm.selectedVariantId },
      });
      if (variantRefs === 0) {
        await tx.mediaVariant.update({
          where: { id: sm.selectedVariantId },
          data: { state: 'PENDING_DELETE' },
        });
      }
    }

    // 3. Media orphan check (no remaining saves for this media).
    const mediaRefs = await tx.savedMedia.count({ where: { mediaId: sm.mediaId } });
    if (mediaRefs === 0) {
      await tx.media.update({
        where: { id: sm.mediaId },
        data: { sourcePendingDeleteAt: new Date() },
      });
    }
  });
}
