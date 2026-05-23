import { prisma } from '../../config/prisma.js';
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
  state: 'PENDING' | 'COMPLETE';
}

export async function enqueueSave(req: SaveRequest): Promise<SaveResponseEntry[]> {
  if (req.qualities.length === 0) {
    throw new AppError('BAD_REQUEST', 'No qualities selected');
  }

  const variants = await prisma.mediaVariant.findMany({
    where: { mediaId: req.mediaId, quality: { in: req.qualities } },
  });
  if (variants.length === 0) {
    throw new AppError('NOT_FOUND', 'No matching variants');
  }

  const out: SaveResponseEntry[] = [];

  for (const v of variants) {
    // Idempotent: reuse SavedMedia row if it exists.
    const existing = await prisma.savedMedia.findUnique({
      where: { userId_mediaVariantId: { userId: req.userId, mediaVariantId: v.id } },
    });

    if (existing && existing.state === 'COMPLETE' && v.state === 'PERSISTED') {
      out.push({
        savedMediaId: existing.id,
        variantId: v.id,
        quality: v.quality,
        jobId: existing.jobId ?? 'completed',
        state: 'COMPLETE',
      });
      continue;
    }

    const savedId = existing?.id ?? newSavedId();
    const data: SaveJobData = { savedMediaId: savedId, variantId: v.id };

    const job = await saveQueue.add('download-variant', data, {
      jobId: `save:${savedId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 1000 },
    });

    if (existing) {
      await prisma.savedMedia.update({
        where: { id: existing.id },
        data: { state: 'PENDING', jobId: job.id ?? null, error: null, progress: 0 },
      });
    } else {
      await prisma.savedMedia.create({
        data: {
          id: savedId,
          userId: req.userId,
          mediaVariantId: v.id,
          state: 'PENDING',
          jobId: job.id ?? null,
        },
      });
    }

    out.push({
      savedMediaId: savedId,
      variantId: v.id,
      quality: v.quality,
      jobId: job.id ?? savedId,
      state: 'PENDING',
    });
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
