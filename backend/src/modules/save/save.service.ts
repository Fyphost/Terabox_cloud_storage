/**
 * Save service.
 *
 * Concept model:
 *
 *   - SavedMedia: one per (user, media). Aggregates user's claim across all
 *     qualities they've asked us to save. Created on first save call;
 *     reused for every subsequent quality the same user picks.
 *   - SavedVariant: join row tying a SavedMedia to a specific MediaVariant.
 *     Adding a quality later just adds another SavedVariant; we never
 *     duplicate Media or SavedMedia entries.
 *
 * The MediaVariant rows are the bytes-location source of truth, with their
 * own state machine driven by save.worker.
 */

import { prisma } from '../../config/prisma.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { newSavedId, newSavedVariantId } from '../../lib/ids.js';
import { saveQueue, type SaveJobData } from '../../queues/save.queue.js';
import { recomputeSavedMediaState } from './save.state.js';

export interface SaveRequest {
  userId: string;
  mediaId: string;
  qualities: string[];
}

export interface EnqueuedClaim {
  savedMediaId: string;
  savedVariantId: string;
  variantId: string;
  quality: string;
  state: 'IN_FLIGHT' | 'ALREADY_PERSISTED';
  jobId: string | null;
}

export interface EnqueueSaveResult {
  savedMediaId: string;
  claims: EnqueuedClaim[];
}

export async function enqueueSave(req: SaveRequest): Promise<EnqueueSaveResult> {
  if (req.qualities.length === 0) {
    throw new AppError('BAD_REQUEST', 'No qualities selected');
  }

  // ARCHITECTURAL FIX: Enforce ONE canonical download quality per saved media.
  // The user picks their preferred quality. Only this quality gets the source
  // MP4 download. HLS streaming still works for all qualities, but the
  // download endpoint serves only the canonical one.
  //
  // If the user already saved 720p and now picks 1080p, we update the
  // canonical quality. The old variant stays for HLS streaming but downloads
  // now serve the new quality.
  const canonicalQuality = req.qualities[req.qualities.length - 1]!;

  // Authn integrity: JWT may carry a sub for a row that no longer exists.
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

  // 1. Upsert one SavedMedia per (user, media). Set canonical quality.
  const savedMedia = await prisma.savedMedia.upsert({
    where: { userId_mediaId: { userId: req.userId, mediaId: req.mediaId } },
    update: { canonicalQuality },
    create: {
      id: newSavedId(),
      userId: req.userId,
      mediaId: req.mediaId,
      state: 'PENDING',
      canonicalQuality,
    },
  });

  const claims: EnqueuedClaim[] = [];
  for (const v of variants) {
    try {
      // 2. Upsert SavedVariant for this user-variant pair.
      const sv = await prisma.savedVariant.upsert({
        where: {
          savedMediaId_mediaVariantId: {
            savedMediaId: savedMedia.id,
            mediaVariantId: v.id,
          },
        },
        update: {},
        create: {
          id: newSavedVariantId(),
          savedMediaId: savedMedia.id,
          mediaVariantId: v.id,
        },
      });

      // 3a. Already PERSISTED → no work for this quality.
      if (v.state === 'PERSISTED') {
        claims.push({
          savedMediaId: savedMedia.id,
          savedVariantId: sv.id,
          variantId: v.id,
          quality: v.quality,
          state: 'ALREADY_PERSISTED',
          jobId: null,
        });
        continue;
      }

      // 3b. If a job is already in flight for this variant, we don't
      // enqueue a duplicate — the existing job will roll up our claim too.
      const inFlight =
        v.state === 'PENDING' ||
        v.state === 'FETCHING' ||
        v.state === 'DOWNLOADING' ||
        v.state === 'GENERATING_HLS' ||
        v.state === 'GENERATING_THUMBNAIL' ||
        v.state === 'FINALIZING';

      if (inFlight) {
        claims.push({
          savedMediaId: savedMedia.id,
          savedVariantId: sv.id,
          variantId: v.id,
          quality: v.quality,
          state: 'IN_FLIGHT',
          jobId: null,
        });
        continue;
      }

      // 3c. Reset variant to PENDING and enqueue a fresh attempt.
      await prisma.mediaVariant.update({
        where: { id: v.id },
        data: {
          state: 'PENDING',
          pipelineStep: 'queued',
          progress: 0,
          bytesDone: 0n,
          bytesTotal: null,
          speedBytesPerSec: null,
          etaSec: null,
          errorMessage: null,
        },
      });

      const job = await saveQueue.add(
        'download-variant',
        { savedMediaId: savedMedia.id, variantId: v.id } satisfies SaveJobData,
        {
          jobId: `save:${sv.id}:${Date.now()}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400, count: 1000 },
        },
      );

      await prisma.savedVariant
        .update({ where: { id: sv.id }, data: { lastJobId: job.id ?? null } })
        .catch(() => undefined);

      claims.push({
        savedMediaId: savedMedia.id,
        savedVariantId: sv.id,
        variantId: v.id,
        quality: v.quality,
        state: 'IN_FLIGHT',
        jobId: job.id ?? null,
      });
    } catch (err) {
      logger.error(
        { err, userId: req.userId, mediaId: req.mediaId, variantId: v.id },
        'enqueueSave: failed for variant',
      );
      throw err instanceof AppError ? err : new AppError('INTERNAL', 'Failed to enqueue save', err);
    }
  }

  // Aggregate state once after all claims resolved.
  await recomputeSavedMediaState(savedMedia.id).catch(() => undefined);

  return { savedMediaId: savedMedia.id, claims };
}

/**
 * Per-savedMedia progress, suitable for the library detail card.
 * Returns one entry per claimed variant with full pipeline state.
 */
export async function getSavedMediaProgress(savedMediaId: string, userId: string) {
  const sm = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: {
      media: { select: { id: true, name: true } },
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
            },
          },
        },
      },
    },
  });
  if (!sm || sm.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Save not found');
  }

  return {
    savedMediaId: sm.id,
    mediaId: sm.media.id,
    state: sm.state,
    completedAt: sm.completedAt?.toISOString() ?? null,
    variants: sm.variants.map((sv) => ({
      savedVariantId: sv.id,
      variantId: sv.variant.id,
      quality: sv.variant.quality,
      state: sv.variant.state,
      pipelineStep: sv.variant.pipelineStep,
      progress: sv.variant.progress,
      bytesDone: sv.variant.bytesDone ? Number(sv.variant.bytesDone) : 0,
      bytesTotal: sv.variant.bytesTotal !== null ? Number(sv.variant.bytesTotal) : null,
      speedBytesPerSec: sv.variant.speedBytesPerSec,
      etaSec: sv.variant.etaSec,
      errorMessage: sv.variant.errorMessage,
      sizeBytes: sv.variant.sizeBytes !== null ? Number(sv.variant.sizeBytes) : null,
    })),
  };
}

/**
 * Re-queue a FAILED variant within an existing claim. Idempotent.
 */
export async function retrySavedVariant(
  savedVariantId: string,
  userId: string,
): Promise<EnqueuedClaim> {
  const sv = await prisma.savedVariant.findUnique({
    where: { id: savedVariantId },
    include: { saved: true, variant: true },
  });
  if (!sv || sv.saved.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Save claim not found');
  }
  if (sv.variant.state !== 'FAILED') {
    return {
      savedMediaId: sv.savedMediaId,
      savedVariantId: sv.id,
      variantId: sv.variant.id,
      quality: sv.variant.quality,
      state: sv.variant.state === 'PERSISTED' ? 'ALREADY_PERSISTED' : 'IN_FLIGHT',
      jobId: null,
    };
  }
  await prisma.mediaVariant.update({
    where: { id: sv.variant.id },
    data: {
      state: 'PENDING',
      pipelineStep: 'queued',
      progress: 0,
      bytesDone: 0n,
      bytesTotal: null,
      speedBytesPerSec: null,
      etaSec: null,
      errorMessage: null,
    },
  });
  const job = await saveQueue.add(
    'download-variant',
    { savedMediaId: sv.savedMediaId, variantId: sv.variant.id } satisfies SaveJobData,
    {
      jobId: `save:${sv.id}:retry:${Date.now()}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 1000 },
    },
  );
  await prisma.savedVariant
    .update({ where: { id: sv.id }, data: { lastJobId: job.id ?? null } })
    .catch(() => undefined);
  await recomputeSavedMediaState(sv.savedMediaId).catch(() => undefined);

  return {
    savedMediaId: sv.savedMediaId,
    savedVariantId: sv.id,
    variantId: sv.variant.id,
    quality: sv.variant.quality,
    state: 'IN_FLIGHT',
    jobId: job.id ?? null,
  };
}
