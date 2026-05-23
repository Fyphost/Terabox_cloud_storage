import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { presentMedia, type PresentedMedia } from '../media/media.service.js';

export type LibrarySort = 'recent' | 'oldest' | 'name' | 'size';

export interface LibraryEntry {
  savedMediaId: string;
  state: string;
  progress: number;
  createdAt: string;
  media: PresentedMedia;
  variantId: string;
  quality: string;
}

export async function listLibrary(
  userId: string,
  opts: { search?: string; cursor?: string; take?: number; sort?: LibrarySort } = {},
): Promise<{ items: LibraryEntry[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(opts.take ?? 20, 1), 50);
  const sort: LibrarySort = opts.sort ?? 'recent';

  const where: Prisma.SavedMediaWhereInput = {
    userId,
    ...(opts.search
      ? { variant: { media: { name: { contains: opts.search, mode: 'insensitive' } } } }
      : {}),
  };

  // Cursor pagination requires a deterministic ordering. We always include id
  // as a tiebreaker so the cursor uniquely picks up where the page left off.
  const orderBy: Prisma.SavedMediaOrderByWithRelationInput[] = (() => {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'name':
        return [{ variant: { media: { name: 'asc' } } }, { id: 'asc' }];
      case 'size':
        return [{ variant: { sizeBytes: 'desc' } }, { id: 'desc' }];
      case 'recent':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  })();

  const saved = await prisma.savedMedia.findMany({
    where,
    include: { variant: { include: { media: { include: { variants: true } } } } },
    orderBy,
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const trimmed = saved.slice(0, take);
  const nextCursor = saved.length > take ? saved[saved.length - 1]!.id : null;

  const items: LibraryEntry[] = await Promise.all(
    trimmed.map(async (s) => ({
      savedMediaId: s.id,
      state: s.state,
      progress: s.progress,
      createdAt: s.createdAt.toISOString(),
      media: await presentMedia(s.variant.media, s.variant.media.variants, userId),
      variantId: s.variant.id,
      quality: s.variant.quality,
    })),
  );

  return { items, nextCursor };
}

export async function deleteLibraryEntries(savedMediaIds: string[], userId: string): Promise<number> {
  const owned = await prisma.savedMedia.findMany({
    where: { id: { in: savedMediaIds }, userId },
    select: { id: true, mediaVariantId: true },
  });
  if (owned.length === 0) {
    throw new AppError('NOT_FOUND', 'No matching library entries');
  }

  await prisma.savedMedia.deleteMany({ where: { id: { in: owned.map((o) => o.id) } } });

  const variantIds = Array.from(new Set(owned.map((o) => o.mediaVariantId)));
  for (const variantId of variantIds) {
    const remaining = await prisma.savedMedia.count({ where: { mediaVariantId: variantId } });
    if (remaining === 0) {
      await prisma.mediaVariant
        .update({ where: { id: variantId }, data: { state: 'PENDING_DELETE' } })
        .catch(() => undefined);
    }
  }

  return owned.length;
}
