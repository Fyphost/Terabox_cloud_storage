import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { presentMedia, type PresentedMedia } from '../media/media.service.js';

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
  opts: { search?: string; cursor?: string; take?: number } = {},
): Promise<{ items: LibraryEntry[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(opts.take ?? 20, 1), 50);

  const saved = await prisma.savedMedia.findMany({
    where: {
      userId,
      ...(opts.search
        ? { variant: { media: { name: { contains: opts.search, mode: 'insensitive' } } } }
        : {}),
    },
    include: { variant: { include: { media: { include: { variants: true } } } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

export async function deleteLibraryEntry(savedMediaId: string, userId: string): Promise<void> {
  const sm = await prisma.savedMedia.findUnique({ where: { id: savedMediaId } });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Library entry not found');

  await prisma.savedMedia.delete({ where: { id: savedMediaId } });

  // If no other user references the variant, mark for deletion.
  const remaining = await prisma.savedMedia.count({
    where: { mediaVariantId: sm.mediaVariantId },
  });
  if (remaining === 0) {
    await prisma.mediaVariant.update({
      where: { id: sm.mediaVariantId },
      data: { state: 'PENDING_DELETE' },
    });
  }
}
