/**
 * Save worker — transactional persistence pipeline.
 *
 * Lifecycle (per variant):
 *
 *   PENDING
 *     │  worker picks job up; preflight: variant exists, media has storageKey
 *     ▼
 *   FETCHING
 *     │  fetch upstream playlist; refresh on 403/404 once
 *     ▼
 *   DOWNLOADING
 *     │  for each segment: fetch upstream → write into staging dir
 *     │  bytesDone / bytesTotal / speed / eta updated periodically
 *     ▼
 *   GENERATING_HLS
 *     │  write rewritten local playlist into staging
 *     ▼
 *   GENERATING_THUMBNAIL
 *     │  if Media has no persisted thumbnail, fetch upstream thumb to
 *     │  media root (thumb.jpg); idempotent.
 *     ▼
 *   FINALIZING
 *     │  verifyVariantBytes() against the staging tree
 *     │  atomic renameDir(staging → final)
 *     │  re-verify against final tree
 *     │  update DB inside one transaction
 *     ▼
 *   PERSISTED ✅
 *
 * On any failure:
 *   - state ← FAILED, errorMessage set
 *   - staging directory cleaned up (best-effort, never blocks)
 *   - DB row left in a known-good state; retry is safe (worker re-creates
 *     the staging dir from scratch on next attempt).
 *
 * Hard rules:
 *   - DB MUST never see PERSISTED unless verifyVariantBytes returned ok
 *     against the FINAL location.
 *   - Final destination is renamed in atomically; partial writes only
 *     happen inside the staging directory.
 *   - All Redis writes (locks, progress) are best-effort; the source of
 *     truth is the DB row.
 */

import { Worker, type Job } from 'bullmq';
import { Readable } from 'node:stream';
import { request as undiciRequest } from 'undici';
import { prisma } from '../config/prisma.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { upstreamRequest } from '../lib/http.js';
import { permanentStorage } from '../services/storage/index.js';
import {
  hlsRoot,
  mediaDir,
  metadataKey,
  stagingPlaylistKey,
  stagingSegmentKey,
  thumbnailKey,
  variantHlsDir,
  variantPlaylistKey,
  variantSegmentKey,
  variantStagingDir,
} from '../services/storage/paths.js';
import {
  joinKey,
  verifyVariantBytes,
} from '../services/storage/verify.js';
import { rewriteMediaPlaylist } from '../modules/stream/hls.rewriter.js';
import { refreshVariantUpstream } from '../modules/ingest/ingest.service.js';
import { recomputeSavedMediaState } from '../modules/save/save.state.js';
import { QUEUE_NAMES } from '../queues/types.js';
import type { SaveJobData } from '../queues/save.queue.js';
import type { Media, MediaVariant as PrismaMediaVariant, Prisma } from '@prisma/client';

type MediaVariant = PrismaMediaVariant;

const LOCK_TTL_MS = 30 * 60 * 1000;
const SEGMENT_PARALLELISM = 4;
const PROGRESS_UPDATE_INTERVAL_MS = 1000;

// ─── Locking ────────────────────────────────────────────────────────────────

async function withVariantLock<T>(variantId: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const key = `lock:variant:${variantId}`;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;

  const start = Date.now();
  while (Date.now() - start < LOCK_TTL_MS) {
    const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        const lua =
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
        await redis.eval(lua, 1, key, token).catch(() => undefined);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Failed to acquire variant lock: ${variantId}`);
}

// ─── State helpers ──────────────────────────────────────────────────────────

interface ProgressState {
  step: string;
  bytesDone: bigint;
  bytesTotal: bigint | null;
  progress: number;
  speedBytesPerSec: number | null;
  etaSec: number | null;
  errorMessage?: string | null;
}

async function setVariantState(
  variantId: string,
  state: MediaVariant['state'],
  progress: ProgressState,
): Promise<void> {
  const data: Prisma.MediaVariantUpdateInput = {
    state,
    pipelineStep: progress.step,
    progress: progress.progress,
    bytesDone: progress.bytesDone,
    bytesTotal: progress.bytesTotal,
    speedBytesPerSec: progress.speedBytesPerSec,
    etaSec: progress.etaSec,
  };
  if (progress.errorMessage !== undefined) data.errorMessage = progress.errorMessage;
  await prisma.mediaVariant.update({ where: { id: variantId }, data }).catch((err) => {
    logger.warn({ err, variantId }, 'setVariantState: DB update failed');
  });
}

async function markFailed(variant: MediaVariant, message: string): Promise<void> {
  await prisma.mediaVariant
    .update({
      where: { id: variant.id },
      data: {
        state: 'FAILED',
        pipelineStep: null,
        speedBytesPerSec: null,
        etaSec: null,
        errorMessage: message.slice(0, 1024),
        attemptCount: { increment: 1 },
      },
    })
    .catch(() => undefined);

  // Recompute parent SavedMedia aggregate state.
  const savedRows = await prisma.savedVariant.findMany({
    where: { mediaVariantId: variant.id },
    select: { savedMediaId: true },
  });
  for (const r of savedRows) {
    await recomputeSavedMediaState(r.savedMediaId).catch(() => undefined);
  }
}

// ─── Per-segment download ───────────────────────────────────────────────────

interface DownloadProgress {
  total: number;
  done: number;
  bytesDone: bigint;
  bytesEstimatedTotal: bigint | null;
  startedAt: number;
}

function tickProgress(p: DownloadProgress): { speed: number; etaSec: number | null; pct: number } {
  const elapsedSec = Math.max(0.5, (Date.now() - p.startedAt) / 1000);
  const speed = Math.round(Number(p.bytesDone) / elapsedSec);
  const total =
    p.bytesEstimatedTotal && p.bytesEstimatedTotal > 0n
      ? Number(p.bytesEstimatedTotal)
      : null;
  const etaSec =
    total !== null && speed > 0 ? Math.max(1, Math.round((total - Number(p.bytesDone)) / speed)) : null;
  const pct = total ? Math.min(0.99, Number(p.bytesDone) / total) : p.done / p.total;
  return { speed, etaSec, pct };
}

async function downloadSegment(
  upstreamUrl: string,
  storageKeyForStaging: string,
  variantId: string,
): Promise<{ bytes: number }> {
  let resp = await upstreamRequest(upstreamUrl, { method: 'GET' });
  if (resp.statusCode === 403 || resp.statusCode === 404) {
    resp.body.resume();
    const refreshed = await refreshVariantUpstream(variantId);
    if (!refreshed) throw new Error(`segment 403/404 and refresh failed: ${upstreamUrl}`);
    // Caller is responsible for re-resolving the segment URL after refresh.
    throw new SegmentRefreshError();
  }
  if (resp.statusCode >= 400) {
    resp.body.resume();
    throw new Error(`segment fetch failed (${resp.statusCode})`);
  }
  const result = await permanentStorage().write(storageKeyForStaging, Readable.from(resp.body), {
    contentType: 'video/mp2t',
  });
  return { bytes: result.bytes };
}

class SegmentRefreshError extends Error {
  constructor() {
    super('segment-refresh-required');
    this.name = 'SegmentRefreshError';
  }
}

// ─── HLS pipeline ───────────────────────────────────────────────────────────

interface ResolvedPlaylist {
  text: string;
  segmentUrls: string[];
}

async function fetchUpstreamPlaylist(
  variantId: string,
  initialUrl: string,
): Promise<{ url: string; resolved: ResolvedPlaylist }> {
  let url = initialUrl;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await upstreamRequest(url, { method: 'GET' });
    if (resp.statusCode === 403 || resp.statusCode === 404) {
      resp.body.resume();
      const refreshed = await refreshVariantUpstream(variantId);
      if (!refreshed) throw new Error(`upstream playlist gone: ${resp.statusCode}`);
      url = refreshed;
      continue;
    }
    if (resp.statusCode >= 400) {
      resp.body.resume();
      throw new Error(`upstream playlist fetch failed (${resp.statusCode})`);
    }
    const text = await resp.body.text();
    const rewritten = rewriteMediaPlaylist(text, url, () => 'placeholder');
    return {
      url,
      resolved: { text, segmentUrls: rewritten.segments.map((s) => s.originalUri) },
    };
  }
  throw new Error('upstream playlist unrecoverable');
}

async function processHlsVariant(
  job: Job<SaveJobData>,
  media: Media,
  variant: MediaVariant,
): Promise<{ bytes: number; segmentCount: number }> {
  if (!variant.upstreamPlaylistUrl) {
    throw new Error('variant has no upstream playlist URL');
  }

  // 1. FETCHING — fetch upstream playlist + segment URLs.
  await setVariantState(variant.id, 'FETCHING', {
    step: 'fetching upstream playlist',
    bytesDone: 0n,
    bytesTotal: null,
    progress: 0,
    speedBytesPerSec: null,
    etaSec: null,
    errorMessage: null,
  });
  let { url: playlistUrl, resolved } = await fetchUpstreamPlaylist(
    variant.id,
    variant.upstreamPlaylistUrl,
  );
  let segmentUrls = resolved.segmentUrls;
  const total = segmentUrls.length;
  if (total === 0) throw new Error('upstream playlist has no segments');

  // Clear any leftover staging from a prior attempt before downloading.
  await permanentStorage().deletePrefix(variantStagingDir(media.id, variant.id)).catch(() => undefined);

  // 2. DOWNLOADING — segments → staging dir.
  await setVariantState(variant.id, 'DOWNLOADING', {
    step: `downloading 0/${total} segments`,
    bytesDone: 0n,
    bytesTotal: null,
    progress: 0,
    speedBytesPerSec: null,
    etaSec: null,
  });

  const progressTracker: DownloadProgress = {
    total,
    done: 0,
    bytesDone: 0n,
    bytesEstimatedTotal: null,
    startedAt: Date.now(),
  };

  // Throttled DB writes for progress.
  let lastFlush = 0;
  const flushProgress = async (force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastFlush < PROGRESS_UPDATE_INTERVAL_MS) return;
    lastFlush = now;
    const t = tickProgress(progressTracker);
    await prisma.mediaVariant
      .update({
        where: { id: variant.id },
        data: {
          pipelineStep: `downloading ${progressTracker.done}/${total} segments`,
          progress: t.pct,
          bytesDone: progressTracker.bytesDone,
          bytesTotal: progressTracker.bytesEstimatedTotal,
          speedBytesPerSec: t.speed,
          etaSec: t.etaSec,
        },
      })
      .catch(() => undefined);
    await job.updateProgress(Math.round(t.pct * 100)).catch(() => undefined);
  };

  const queue: number[] = Array.from({ length: total }, (_, i) => i);
  let cursor = 0;
  const pickIndex = (): number | null => {
    if (cursor >= queue.length) return null;
    return queue[cursor++]!;
  };

  const downloadOne = async (index: number): Promise<void> => {
    const stagingKey = stagingSegmentKey(media.id, variant.id, index);
    let segUrl = segmentUrls[index]!;
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        const { bytes } = await downloadSegment(segUrl, stagingKey, variant.id);
        progressTracker.bytesDone += BigInt(bytes);
        // Estimate total bytes from per-segment average after a few segments.
        if (progressTracker.done === 0) {
          progressTracker.bytesEstimatedTotal = BigInt(bytes) * BigInt(total);
        } else if (progressTracker.done % 5 === 0 && progressTracker.done > 0) {
          const avg = progressTracker.bytesDone / BigInt(progressTracker.done + 1);
          progressTracker.bytesEstimatedTotal = avg * BigInt(total);
        }
        progressTracker.done += 1;
        await flushProgress();
        return;
      } catch (err) {
        if (err instanceof SegmentRefreshError && attempts < 2) {
          // Refresh the entire playlist to get new segment URLs.
          const refreshedUpstream = await refreshVariantUpstream(variant.id);
          if (!refreshedUpstream) throw new Error('refresh after segment 403 failed');
          const re = await fetchUpstreamPlaylist(variant.id, refreshedUpstream);
          if (re.resolved.segmentUrls.length !== total) {
            throw new Error('segment count changed after refresh; aborting');
          }
          segmentUrls = re.resolved.segmentUrls;
          playlistUrl = re.url;
          segUrl = segmentUrls[index]!;
          continue;
        }
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, 500 * attempts));
          continue;
        }
        throw err;
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < SEGMENT_PARALLELISM; w++) {
    workers.push(
      (async () => {
        let i: number | null;
        while ((i = pickIndex()) !== null) {
          await downloadOne(i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  await flushProgress(true);

  // 3. GENERATING_HLS — write the local rewritten playlist into staging.
  await setVariantState(variant.id, 'GENERATING_HLS', {
    step: 'writing local playlist',
    bytesDone: progressTracker.bytesDone,
    bytesTotal: progressTracker.bytesEstimatedTotal,
    progress: 0.9,
    speedBytesPerSec: null,
    etaSec: null,
  });
  const localPlaylist = rewriteMediaPlaylist(
    resolved.text,
    playlistUrl,
    (seg) => `seg-${seg.index}.ts`,
  );
  await permanentStorage().writeBuffer(
    stagingPlaylistKey(media.id, variant.id),
    Buffer.from(localPlaylist.body, 'utf8'),
    { contentType: 'application/vnd.apple.mpegurl' },
  );

  return { bytes: Number(progressTracker.bytesDone), segmentCount: total };
}

// ─── Thumbnail ──────────────────────────────────────────────────────────────

async function ensureThumbnail(media: Media): Promise<{ written: boolean }> {
  if (media.thumbnailKey) return { written: false };
  if (!media.thumbnailUrl) return { written: false };
  try {
    const resp = await undiciRequest(media.thumbnailUrl, { method: 'GET' });
    if (resp.statusCode >= 400) {
      resp.body.resume();
      return { written: false };
    }
    await permanentStorage().write(thumbnailKey(media.id), Readable.from(resp.body), {
      contentType: 'image/jpeg',
    });
    return { written: true };
  } catch (err) {
    logger.warn({ err, mediaId: media.id }, 'thumbnail capture failed (non-fatal)');
    return { written: false };
  }
}

// ─── Master playlist regeneration ───────────────────────────────────────────

async function regenerateMasterPlaylist(media: Media): Promise<string | null> {
  const variants = await prisma.mediaVariant.findMany({
    where: { mediaId: media.id, state: 'PERSISTED', container: 'HLS' },
    orderBy: { bitrateBps: 'asc' },
  });
  if (variants.length === 0) return null;

  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const v of variants) {
    const attrs: string[] = [];
    attrs.push(`BANDWIDTH=${v.bitrateBps ?? 800_000}`);
    if (v.width && v.height) attrs.push(`RESOLUTION=${v.width}x${v.height}`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`);
    // Relative path to the variant's local playlist within the media root.
    lines.push(`${v.quality}/playlist.m3u8`);
  }
  lines.push('');
  const body = lines.join('\n');

  const masterRel = `hls/master.m3u8`;
  await permanentStorage().writeBuffer(
    joinKey(media.storageKey, masterRel),
    Buffer.from(body, 'utf8'),
    { contentType: 'application/vnd.apple.mpegurl' },
  );
  return masterRel;
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function startSaveWorker(): Worker<SaveJobData> {
  const worker = new Worker<SaveJobData>(
    QUEUE_NAMES.save,
    async (job) => {
      const { variantId, savedMediaId } = job.data;
      const variant = await prisma.mediaVariant.findUnique({
        where: { id: variantId },
        include: { media: true },
      });
      if (!variant) throw new Error(`variant ${variantId} missing`);

      // Already done? Mark caller's claim complete and exit.
      if (variant.state === 'PERSISTED') {
        await prisma.savedVariant
          .updateMany({
            where: { savedMediaId, mediaVariantId: variantId },
            data: { lastJobId: job.id ?? null },
          })
          .catch(() => undefined);
        await recomputeSavedMediaState(savedMediaId).catch(() => undefined);
        return { skipped: true };
      }

      return withVariantLock(variantId, async () => {
        // Re-read inside the lock; another worker may have just finished.
        const v = await prisma.mediaVariant.findUnique({
          where: { id: variantId },
          include: { media: true },
        });
        if (!v) throw new Error(`variant ${variantId} missing`);
        const media = v.media;

        if (v.state === 'PERSISTED') {
          await recomputeSavedMediaState(savedMediaId).catch(() => undefined);
          return { skipped: true };
        }

        // Ensure media has a storageKey (root). Set on first save attempt for
        // this media. Idempotent — same value every time.
        const desiredStorageKey = mediaDir(media.id);
        let mediaForRun: Media = media;
        if (!media.storageKey) {
          mediaForRun = await prisma.media.update({
            where: { id: media.id },
            data: { storageKey: desiredStorageKey },
          });
        } else if (media.storageKey !== desiredStorageKey) {
          // Should never happen (we always derive from id) but log loudly.
          logger.warn(
            { mediaId: media.id, dbKey: media.storageKey, expected: desiredStorageKey },
            'media storageKey drifted',
          );
        }

        try {
          let pipelineResult: { bytes: number; segmentCount: number } | null = null;
          if (v.container === 'HLS') {
            pipelineResult = await processHlsVariant(job, mediaForRun, v);
          } else {
            // MP4 path is not yet supported in this rebuild; the extractor
            // currently surfaces HLS variants. Mark as failed loudly.
            throw new Error(`container ${v.container} not supported in save pipeline`);
          }

          // 4. GENERATING_THUMBNAIL — best-effort, non-fatal.
          await setVariantState(v.id, 'GENERATING_THUMBNAIL', {
            step: 'capturing thumbnail',
            bytesDone: BigInt(pipelineResult.bytes),
            bytesTotal: BigInt(pipelineResult.bytes),
            progress: 0.95,
            speedBytesPerSec: null,
            etaSec: null,
          });
          const thumbResult = await ensureThumbnail(mediaForRun);

          // 5. FINALIZING — verify staging, atomic rename, re-verify final.
          await setVariantState(v.id, 'FINALIZING', {
            step: 'verifying & promoting',
            bytesDone: BigInt(pipelineResult.bytes),
            bytesTotal: BigInt(pipelineResult.bytes),
            progress: 0.97,
            speedBytesPerSec: null,
            etaSec: null,
          });

          // First verify against the staging tree so we don't promote junk.
          const stagingDir = variantStagingDir(mediaForRun.id, v.id);
          const stagingPlaylistRel = stagingPlaylistKey(mediaForRun.id, v.id).slice(
            (mediaForRun.storageKey ?? '').length + 1,
          );
          const stagingSegmentDirRel = stagingDir.slice((mediaForRun.storageKey ?? '').length + 1);
          // Build a verification-shape object structurally — verify only reads
          // the few fields it cares about (container, hlsPlaylistKey,
          // hlsSegmentDir, fileKey).
          const stagingShape = {
            ...v,
            hlsPlaylistKey: stagingPlaylistRel,
            hlsSegmentDir: stagingSegmentDirRel,
            container: 'HLS' as const,
          };
          const preCheck = await verifyVariantBytes(mediaForRun, stagingShape);
          if (!preCheck.ok) {
            throw new Error(`staging verification failed: ${preCheck.errors.join('; ')}`);
          }

          // Atomic promotion: staging dir → final dir. Final must not exist.
          const finalDir = variantHlsDir(mediaForRun.id, v.quality);
          await permanentStorage().deletePrefix(finalDir).catch(() => undefined);
          await permanentStorage().renameDir(stagingDir, finalDir);

          // Final verification against the promoted tree.
          const finalPlaylistRel = `hls/${v.quality}/playlist.m3u8`;
          const finalSegmentDirRel = `hls/${v.quality}`;
          const finalShape = {
            ...v,
            hlsPlaylistKey: finalPlaylistRel,
            hlsSegmentDir: finalSegmentDirRel,
            container: 'HLS' as const,
          };
          const postCheck = await verifyVariantBytes(mediaForRun, finalShape);
          if (!postCheck.ok) {
            throw new Error(`post-promote verification failed: ${postCheck.errors.join('; ')}`);
          }

          // Persist verified state in one DB transaction.
          await prisma.$transaction(async (tx) => {
            await tx.mediaVariant.update({
              where: { id: v.id },
              data: {
                state: 'PERSISTED',
                pipelineStep: null,
                progress: 1,
                bytesDone: BigInt(postCheck.bytes),
                bytesTotal: BigInt(postCheck.bytes),
                speedBytesPerSec: null,
                etaSec: null,
                errorMessage: null,
                hlsPlaylistKey: finalPlaylistRel,
                hlsSegmentDir: finalSegmentDirRel,
                segmentCount: postCheck.segmentCount,
                sizeBytes: BigInt(postCheck.bytes),
              },
            });
            if (thumbResult.written && !mediaForRun.thumbnailKey) {
              await tx.media.update({
                where: { id: mediaForRun.id },
                data: { thumbnailKey: thumbnailKey(mediaForRun.id).split('/').slice(1).join('/') },
              });
            }
          });

          // Best-effort: regenerate master playlist now that one more variant is live.
          const masterKey = await regenerateMasterPlaylist(mediaForRun).catch((err) => {
            logger.warn({ err, mediaId: mediaForRun.id }, 'master regen failed');
            return null;
          });
          if (masterKey) {
            await prisma.media
              .update({
                where: { id: mediaForRun.id },
                data: { masterPlaylistKey: masterKey },
              })
              .catch(() => undefined);
          }

          // Roll up SavedMedia state for every user that claimed this variant.
          const claims = await prisma.savedVariant.findMany({
            where: { mediaVariantId: v.id },
            select: { savedMediaId: true },
          });
          for (const c of claims) {
            await recomputeSavedMediaState(c.savedMediaId).catch(() => undefined);
          }
          return { ok: true, bytes: postCheck.bytes };
        } catch (err) {
          logger.error({ err, variantId: v.id, mediaId: mediaForRun.id }, 'save pipeline failed');
          // Rollback: blow away staging; leave any prior PERSISTED final dir untouched.
          await permanentStorage()
            .deletePrefix(variantStagingDir(mediaForRun.id, v.id))
            .catch(() => undefined);
          await markFailed(v, err instanceof Error ? err.message : String(err));
          throw err;
        }
      });
    },
    {
      connection: getRedis(),
      concurrency: 4,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'save job failed');
  });
  worker.on('completed', (job) => {
    logger.info({ jobId: job?.id }, 'save job complete');
  });

  return worker;
}
