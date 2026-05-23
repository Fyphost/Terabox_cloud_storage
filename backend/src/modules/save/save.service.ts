import { prisma } from '../../config/prisma.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { newSavedId } from '../../lib/ids.js';
import { saveQueue, type SaveJobData } from '../../queues/save.queue.js';

export interface SaveRequest {
  userId: string;
  mediaId: string;
  qualities: string[];
}

export interface SaveResponseEntry {
  savedMediaId: string;
  variantId: string;
  quality: string;
  jobId: string;
  state: 'PENDING' | 'DOWNLOADING' | 'COMPLETE' | 'FAILED';
  progress: number;
}

/**
 * Idempotent enqueue. Safe to call multiple times for the same (user, variant).
 *
 * - Verifies user exists (clear 401 instead of FK 500).
 * - Verifies media + variants exist.
 * - Upserts SavedMedia per variant (no race between find / create / update).
 * - Generates a fresh BullMQ job id every call so retries can't collide on
 *   `jobId` constraints in BullMQ.
 * - Returns COMPLETE immediately when the variant is already PERSISTED.
 */
export async function enqueueSave(req: SaveRequest): Promise<SaveResponseEntry[]> {
  if (req.qualities.length === 0) {
    throw new AppError('BAD_REQUEST', 'No qualities selected');
  }

  // Authn integrity: the JWT may carry a sub for a user row that no longer exists.
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to save media');
  if (user.kind !== 'REGISTERED') {
    throw new AppError('UNAUTHORIZED', 'Sign in to save media');
  }

  const media = await prisma.media.findUnique({ where: { id: req.mediaId } });
  if (!media) throw new AppError('NOT_FOUND', 'Media not found');

  const variants = await prisma.mediaVariant.findMany({
    where: { mediaId: req.mediaId, quality: { in: req.qualities } },
  });
  if (variants.length === 0) {
    throw new AppError('NOT_FOUND', 'No matching variants for selected qualities');
  }

  const out: SaveResponseEntry[] = [];

  for (const v of variants) {
    try {
      // Already persisted → upsert SavedMedia COMPLETE and skip the queue.
      if (v.state === 'PERSISTED') {
        const sm = await prisma.savedMedia.upsert({
          where: { userId_mediaVariantId: { userId: req.userId, mediaVariantId: v.id } },
          update: { state: 'COMPLETE', progress: 1, error: null, completedAt: new Date() },
          create: {
            id: newSavedId(),
            userId: req.userId,
            mediaVariantId: v.id,
            state: 'COMPLETE',
            progress: 1,
            completedAt: new Date(),
          },
        });
        out.push({
          savedMediaId: sm.id,
          variantId: v.id,
          quality: v.quality,
          jobId: sm.jobId ?? 'completed',
          state: 'COMPLETE',
          progress: 1,
        });
        continue;
      }

      // Reserve the SavedMedia row (or reset it) before enqueuing.
      const reserved = await prisma.savedMedia.upsert({
        where: { userId_mediaVariantId: { userId: req.userId, mediaVariantId: v.id } },
        update: { state: 'PENDING', progress: 0, error: null },
        create: {
          id: newSavedId(),
          userId: req.userId,
          mediaVariantId: v.id,
          state: 'PENDING',
          progress: 0,
        },
      });

      // BullMQ rejects duplicate `jobId`. Use a per-call id so retries are safe.
      const job = await saveQueue.add(
        'download-variant',
        { savedMediaId: reserved.id, variantId: v.id } satisfies SaveJobData,
        {
          // unique-per-attempt; keep `save:` prefix for easy console filtering.
          jobId: `save:${reserved.id}:${Date.now()}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400, count: 1000 },
        },
      );

      await prisma.savedMedia.update({
        where: { id: reserved.id },
        data: { jobId: job.id ?? null },
      });

      out.push({
        savedMediaId: reserved.id,
        variantId: v.id,
        quality: v.quality,
        jobId: job.id ?? reserved.id,
        state: 'PENDING',
        progress: 0,
      });
    } catch (err) {
      logger.error(
        { err, userId: req.userId, mediaId: req.mediaId, variantId: v.id, quality: v.quality },
        'enqueueSave: failed for variant',
      );
      throw err instanceof AppError ? err : new AppError('INTERNAL', 'Failed to enqueue save', err);
    }
  }

  return out;
}

export async function getSaveJobStatus(savedMediaId: string, userId: string) {
  const sm = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: { variant: true },
  });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Save job not found');
  return {
    savedMediaId: sm.id,
    variantId: sm.mediaVariantId,
    quality: sm.variant.quality,
    state: sm.state,
    progress: sm.progress,
    error: sm.error,
  };
}
