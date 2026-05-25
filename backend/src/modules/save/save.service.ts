/**
 * modules/save/save.service.ts
 *
 * Per-media save semantics.
 *
 * Invariants enforced here:
 *   1. ONE SavedMedia row per (userId, mediaId). Re-save with a different
 *      quality updates the existing row in place — no row duplication, no
 *      multi-quality storage explosion.
 *   2. ONE ShareToken per SavedMedia, minted atomically on save creation
 *      and reused on re-save.
 *   3. Quality changes mark the previously selected MediaVariant as
 *      PENDING_DELETE if no other user references it. The storage cleanup
 *      worker enforces the grace period.
 *   4. The save job payload still carries `variantId` for the worker, but
 *      the row of truth is `SavedMedia.selectedVariantId` and the job is
 *      keyed by `save:<savedMediaId>` so retries are deduped by row.
 */

import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { newSavedId, newShareToken } from '../../lib/ids.js';
import { saveQueue, type SaveJobData } from '../../queues/save.queue.js';

export interface SaveRequest {
  userId: string;
  mediaId: string;
  quality: string;
}

export interface SaveResponse {
  savedMediaId: string;
  variantId: string;
  quality: string;
  jobId: string;
  state: 'PENDING' | 'DOWNLOADING' | 'COMPLETE' | 'FAILED';
  shareToken: string;
}

export async function enqueueSave(req: SaveRequest): Promise<SaveResponse> {
  // Resolve the chosen variant for this (mediaId, quality).
  const variant = await prisma.mediaVariant.findUnique({
    where: { mediaId_quality: { mediaId: req.mediaId, quality: req.quality } },
  });
  if (!variant) {
    throw new AppError('NOT_FOUND', `Quality "${req.quality}" not available for this media`);
  }

  // Look up the user's existing SavedMedia for this media (per-media identity).
  const existing = await prisma.savedMedia.findUnique({
    where: { userId_mediaId: { userId: req.userId, mediaId: req.mediaId } },
    include: { shareToken: true, selectedVariant: true },
  });

  // The previously selected variant. May differ from the new chosen variant.
  const previousVariantId = existing?.selectedVariantId ?? null;
  const isQualityChange =
    previousVariantId !== null && previousVariantId !== variant.id;

  let savedMediaId = existing?.id ?? newSavedId();
  let shareTokenStr = existing?.shareToken?.token ?? newShareToken();

  // Decide whether we need to enqueue a worker job. We always enqueue if:
  //   - The row is new.
  //   - The quality changed (HLS bytes for the new quality may not exist).
  //   - The current row is not COMPLETE.
  //   - The Media has no canonical source persisted yet.
  const media = await prisma.media.findUnique({ where: { id: req.mediaId } });
  if (!media) throw new AppError('NOT_FOUND', 'Media not found');
  const sourceMissing = !media.sourceStorageKey || !!media.sourcePendingDeleteAt;

  const variantPersisted = variant.state === 'PERSISTED' && !!variant.storageKey;
  const isAlreadyComplete =
    !!existing &&
    existing.state === 'COMPLETE' &&
    !isQualityChange &&
    !sourceMissing &&
    variantPersisted;

  // Atomic upsert: SavedMedia row + ShareToken in one transaction so we
  // never have a SavedMedia without a token (or vice versa).
  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.savedMedia.update({
        where: { id: existing.id },
        data: {
          selectedQuality: req.quality,
          selectedVariantId: variant.id,
          state: isAlreadyComplete ? 'COMPLETE' : 'PENDING',
          progress: isAlreadyComplete ? 1 : 0,
          error: null,
          // Don't clear jobId here — the save worker manages it.
        },
      });
    } else {
      await tx.savedMedia.create({
        data: {
          id: savedMediaId,
          userId: req.userId,
          mediaId: req.mediaId,
          selectedQuality: req.quality,
          selectedVariantId: variant.id,
          state: 'PENDING',
          progress: 0,
        },
      });
    }

    // Ensure a share token exists. Idempotent.
    if (!existing?.shareToken) {
      await tx.shareToken.upsert({
        where: { savedMediaId },
        create: { token: shareTokenStr, savedMediaId },
        update: {}, // keep existing token if any
      });
      // If the upsert kept an older token (somehow created out-of-band),
      // fetch and use it.
      const fresh = await tx.shareToken.findUnique({ where: { savedMediaId } });
      if (fresh) shareTokenStr = fresh.token;
    }

    // Quality change: orphan the previous variant if no one else references it.
    if (isQualityChange && previousVariantId) {
      const refs = await tx.savedMedia.count({
        where: {
          selectedVariantId: previousVariantId,
          NOT: { id: savedMediaId },
        },
      });
      if (refs === 0) {
        await tx.mediaVariant.update({
          where: { id: previousVariantId },
          data: { state: 'PENDING_DELETE' },
        });
      }
    }

    // Clear sourcePendingDeleteAt — this user just claimed the media.
    if (media.sourcePendingDeleteAt) {
      await tx.media.update({
        where: { id: req.mediaId },
        data: { sourcePendingDeleteAt: null },
      });
    }
  });

  // Skip enqueueing if the row is already in a terminal-good state.
  if (isAlreadyComplete) {
    return {
      savedMediaId,
      variantId: variant.id,
      quality: variant.quality,
      jobId: existing!.jobId ?? `save:${savedMediaId}`,
      state: 'COMPLETE',
      shareToken: shareTokenStr,
    };
  }

  const data: SaveJobData = { savedMediaId, variantId: variant.id };
  const job = await saveQueue.add('download-variant', data, {
    jobId: `save:${savedMediaId}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 1000 },
  });

  await prisma.savedMedia.update({
    where: { id: savedMediaId },
    data: { jobId: job.id ?? `save:${savedMediaId}` },
  });

  return {
    savedMediaId,
    variantId: variant.id,
    quality: variant.quality,
    jobId: job.id ?? `save:${savedMediaId}`,
    state: 'PENDING',
    shareToken: shareTokenStr,
  };
}

export async function getSaveJobStatus(savedMediaId: string, userId: string) {
  const sm = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: { selectedVariant: true, shareToken: true, media: true },
  });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Save job not found');
  return {
    savedMediaId: sm.id,
    mediaId: sm.mediaId,
    variantId: sm.selectedVariantId,
    quality: sm.selectedQuality,
    state: sm.state,
    progress: sm.progress,
    error: sm.error,
    sourcePersisted: !!sm.media.sourceStorageKey && !sm.media.sourcePendingDeleteAt,
    shareToken: sm.shareToken?.token ?? null,
  };
}
