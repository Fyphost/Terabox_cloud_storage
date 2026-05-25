/**
 * workers/save.worker.ts
 *
 * Save pipeline for the canonical-archive architecture.
 *
 * What this worker does, in order:
 *   1. Persist `Media.sourceStorageKey = media/<mediaId>/source.mp4` if it
 *      doesn't exist yet. This is the canonical download artifact, exactly
 *      one per Media (deduplicated across users via the (userId, mediaId)
 *      unique on SavedMedia + the per-Media `Media.sourceHash`).
 *   2. Persist `MediaVariant.storageKey = media/<mediaId>/hls/<quality>` for
 *      the user's selectedQuality. Used by the player; never used by /download.
 *   3. Mark `SavedMedia.state = COMPLETE`. Clear `Media.sourcePendingDeleteAt`.
 *
 * Concurrency invariants:
 *   - Two locks: `lock:media:source:<mediaId>` (held while writing source.mp4)
 *     and `lock:variant:<variantId>` (held while writing HLS for one quality).
 *     Locks are independent so different qualities for the same media run in
 *     parallel after the source is staged.
 *   - Lua-checked release ensures we never delete a lock we no longer hold
 *     (TTL preempted us).
 *
 * Idempotency:
 *   - Re-running a job is safe; both phases short-circuit when the bytes are
 *     already on disk and the corresponding row is already PERSISTED.
 *   - Failures inside a phase set SavedMedia.state and surface a clear error.
 *
 * Why this layout (vs. per-variant download bytes)?
 *   The previous worker put `<storageKey>/playlist.m3u8` and segments into
 *   permanent storage and then routed `/download` at the same `<storageKey>`
 *   prefix expecting `file.bin` — which never existed for HLS variants. The
 *   browser ended up saving the m3u8 (~200 B) under the URL's last segment
 *   ("download"). The fix is structural: the *download* artifact is owned
 *   by the Media (one per Media), and HLS bytes are owned by the variant
 *   (one per quality). The two never share a path; you cannot accidentally
 *   serve one in place of the other.
 */

import { Worker, type Job } from 'bullmq';
import { Readable } from 'node:stream';
import { prisma } from '../config/prisma.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { upstreamRequest } from '../lib/http.js';
import { permanentStorage } from '../services/storage/index.js';
import {
  ensureFilenameExtension,
  mediaSourceKey,
  mediaVariantHlsKey,
  variantPlaylistKey,
  variantSegmentKey,
} from '../services/storage/keys.js';
import {
  rewriteMediaPlaylist,
  type SegmentRewrite,
} from '../modules/stream/hls.rewriter.js';
import {
  fetchTeraboxMetadata,
  type TeraboxResponse,
} from '../modules/ingest/terabox.client.js';
import { refreshVariantUpstream } from '../modules/ingest/ingest.service.js';
import { QUEUE_NAMES } from '../queues/types.js';
import type { SaveJobData } from '../queues/save.queue.js';
import type { Media, MediaVariant } from '@prisma/client';

const LOCK_TTL_MS = 30 * 60 * 1000;
const LOCK_RETRY_MS = 1_000;
const SEGMENT_PARALLELISM = 4;
const PROGRESS_DEBOUNCE_BYTES = 4 * 1024 * 1024;

// Progress weighting: source download is the heavy artifact. Reserve 60% of
// the progress bar for it and 40% for HLS segment fetches.
const PROGRESS_SOURCE_FRACTION = 0.6;
const PROGRESS_HLS_FRACTION = 0.4;

// ── Locking ─────────────────────────────────────────────────────────────────

async function withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  const start = Date.now();

  while (Date.now() - start < LOCK_TTL_MS) {
    const ok = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        // Lua-checked release.
        const lua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
        await redis.eval(lua, 1, lockKey, token).catch(() => undefined);
      }
    }
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
  throw new Error(`Failed to acquire lock: ${lockKey}`);
}

// ── Progress ────────────────────────────────────────────────────────────────

class ProgressTracker {
  private lastReported = 0;
  constructor(private readonly job: Job<SaveJobData>) {}

  async update(savedMediaId: string, value: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, value));
    if (clamped - this.lastReported < 0.005 && clamped < 1) return;
    this.lastReported = clamped;
    await Promise.all([
      prisma.savedMedia
        .update({ where: { id: savedMediaId }, data: { progress: clamped } })
        .catch(() => undefined),
      this.job.updateProgress(Math.round(clamped * 100)),
    ]);
  }
}

// ── Source persistence (Phase 1) ────────────────────────────────────────────

async function getFreshDownloadUrl(media: Media): Promise<{ meta: TeraboxResponse; downloadUrl: string }> {
  const meta = await fetchTeraboxMetadata(media.sourceUrl);
  if (!meta.download) {
    throw new Error(
      'Upstream extractor did not return a download URL. ' +
        'Cannot persist canonical source for this media.',
    );
  }
  return { meta, downloadUrl: meta.download };
}

async function persistMediaSource(
  media: Media,
  progress: ProgressTracker,
  savedMediaId: string,
): Promise<void> {
  // Cheap optimistic short-circuit: source already on disk.
  if (media.sourceStorageKey && !media.sourcePendingDeleteAt) {
    const exists = await permanentStorage().exists(media.sourceStorageKey).catch(() => false);
    if (exists) {
      await progress.update(savedMediaId, PROGRESS_SOURCE_FRACTION);
      return;
    }
  }

  const lockKey = `lock:media:source:${media.id}`;
  await withLock(lockKey, async () => {
    // Re-check inside the lock — another worker may have just finished.
    const fresh = await prisma.media.findUnique({ where: { id: media.id } });
    if (!fresh) throw new Error(`Media disappeared: ${media.id}`);

    if (fresh.sourceStorageKey && !fresh.sourcePendingDeleteAt) {
      const exists = await permanentStorage().exists(fresh.sourceStorageKey).catch(() => false);
      if (exists) {
        await progress.update(savedMediaId, PROGRESS_SOURCE_FRACTION);
        return;
      }
    }

    const { meta, downloadUrl } = await getFreshDownloadUrl(fresh);

    // Stream upstream into permanent storage. LocalDiskBackend.write writes
    // to a `.partial-<pid>-<ts>` temp file and renames atomically on success,
    // and computes sha256 + byte count via an inline Transform. No buffering.
    let resp = await upstreamRequest(downloadUrl, { method: 'GET' });
    if (resp.statusCode === 403 || resp.statusCode === 404) {
      resp.body.resume();
      const refreshed = await getFreshDownloadUrl(fresh);
      resp = await upstreamRequest(refreshed.downloadUrl, { method: 'GET' });
    }
    if (resp.statusCode >= 400) {
      resp.body.resume();
      throw new Error(`Upstream source download failed: ${resp.statusCode}`);
    }

    const upstreamCt = (resp.headers['content-type'] as string | undefined) ?? null;
    const contentType = upstreamCt && upstreamCt !== 'application/octet-stream'
      ? upstreamCt
      : 'video/mp4';

    const storageKey = mediaSourceKey(fresh.id, contentType);
    const filename = ensureFilenameExtension(meta.name || fresh.name, contentType);

    // Inline progress meter — reads Content-Length when present.
    const total = Number(resp.headers['content-length'] ?? 0);
    let downloaded = 0;
    let lastReportedBytes = 0;

    const body = Readable.from(resp.body);
    body.on('data', (c: Buffer) => {
      downloaded += c.length;
      if (total > 0 && downloaded - lastReportedBytes >= PROGRESS_DEBOUNCE_BYTES) {
        lastReportedBytes = downloaded;
        const pct = (downloaded / total) * PROGRESS_SOURCE_FRACTION;
        void progress.update(savedMediaId, pct);
      }
    });

    const written = await permanentStorage().write(storageKey, body, { contentType });

    await prisma.media.update({
      where: { id: fresh.id },
      data: {
        sourceStorageKey: storageKey,
        sourceSizeBytes: BigInt(written.bytes),
        sourceSha256: written.sha256,
        sourceContentType: contentType,
        sourcePersistedAt: new Date(),
        sourcePendingDeleteAt: null,
        originalFilename: fresh.originalFilename ?? filename,
      },
    });
    await progress.update(savedMediaId, PROGRESS_SOURCE_FRACTION);
  });
}

// ── HLS persistence (Phase 2) ───────────────────────────────────────────────

async function persistVariantHls(
  variant: MediaVariant,
  progress: ProgressTracker,
  savedMediaId: string,
): Promise<void> {
  const targetKey = mediaVariantHlsKey(variant.mediaId, variant.quality);

  // Cheap short-circuit.
  if (
    variant.state === 'PERSISTED' &&
    variant.storageKey === targetKey &&
    (await permanentStorage().exists(variantPlaylistKey(targetKey)).catch(() => false))
  ) {
    await progress.update(savedMediaId, 1);
    return;
  }

  const lockKey = `lock:variant:${variant.id}`;
  await withLock(lockKey, async () => {
    const fresh = await prisma.mediaVariant.findUnique({ where: { id: variant.id } });
    if (!fresh) throw new Error(`Variant disappeared: ${variant.id}`);

    if (
      fresh.state === 'PERSISTED' &&
      fresh.storageKey === targetKey &&
      (await permanentStorage().exists(variantPlaylistKey(targetKey)).catch(() => false))
    ) {
      await progress.update(savedMediaId, 1);
      return;
    }

    if (!fresh.upstreamPlaylistUrl) {
      // No HLS available. The save still succeeds: source.mp4 is persisted,
      // playback can fall back to the source MP4 directly. Mark the variant
      // EPHEMERAL with no storageKey so the player doesn't expect HLS bytes.
      await prisma.mediaVariant.update({
        where: { id: fresh.id },
        data: { state: 'EPHEMERAL', storageKey: null },
      });
      await progress.update(savedMediaId, 1);
      return;
    }

    const segments = await downloadHlsTo(fresh, fresh.upstreamPlaylistUrl, targetKey, async (done, total) => {
      const hls = total > 0 ? done / total : 0;
      const overall = PROGRESS_SOURCE_FRACTION + hls * PROGRESS_HLS_FRACTION;
      await progress.update(savedMediaId, overall);
    });

    await prisma.mediaVariant.update({
      where: { id: fresh.id },
      data: {
        state: 'PERSISTED',
        storageKey: targetKey,
        // We don't sum segment bytes for `sizeBytes` — the canonical size for
        // download UX is `Media.sourceSizeBytes`. HLS segment bytes are an
        // internal metric.
      },
    });
    logger.info(
      { variantId: fresh.id, mediaId: fresh.mediaId, quality: fresh.quality, segments },
      'save: variant HLS persisted',
    );
  });
}

async function downloadHlsTo(
  variant: MediaVariant,
  upstreamPlaylistUrl: string,
  targetKey: string,
  onProgress: (done: number, total: number) => Promise<void>,
): Promise<number> {
  const storage = permanentStorage();

  // 1. Fetch playlist (with refresh-on-expiry).
  let resp = await upstreamRequest(upstreamPlaylistUrl, { method: 'GET' });
  if (resp.statusCode === 403 || resp.statusCode === 404) {
    resp.body.resume();
    const refreshed = await refreshVariantUpstream(variant.id);
    if (!refreshed) throw new Error('HLS playlist expired and refresh failed');
    upstreamPlaylistUrl = refreshed;
    resp = await upstreamRequest(upstreamPlaylistUrl, { method: 'GET' });
  }
  if (resp.statusCode >= 400) {
    resp.body.resume();
    throw new Error(`HLS playlist fetch failed: ${resp.statusCode}`);
  }
  const playlistText = await resp.body.text();

  // 2. Rewrite to local relative segment paths. Stored playlist references
  //    its segments by relative path (`seg-N.ts`) so it remains valid no
  //    matter what `storageKey` we chose.
  const rewritten = rewriteMediaPlaylist(
    playlistText,
    upstreamPlaylistUrl,
    (seg) => `seg-${seg.index}.ts`,
  );
  if (rewritten.segments.length === 0) {
    throw new Error('Empty HLS playlist (no segments)');
  }

  // 3. Persist rewritten playlist.
  await storage.write(
    variantPlaylistKey(targetKey),
    Readable.from(Buffer.from(rewritten.body, 'utf8')),
    { contentType: 'application/vnd.apple.mpegurl' },
  );

  // 4. Download segments in parallel with bounded concurrency. Per-segment
  //    resume: skip if the segment is already on disk.
  const queue = [...rewritten.segments];
  const total = rewritten.segments.length;
  let completed = 0;

  async function downloadOne(seg: SegmentRewrite): Promise<void> {
    const segKey = variantSegmentKey(targetKey, seg.index);
    if (await storage.exists(segKey).catch(() => false)) return;

    let r = await upstreamRequest(seg.originalUri, { method: 'GET' });
    if (r.statusCode === 403 || r.statusCode === 404) {
      r.body.resume();
      const refreshedUrl = await refreshVariantUpstream(variant.id);
      if (!refreshedUrl) throw new Error(`Segment ${seg.index} expired`);
      // Refresh remaps every segment — fetch the new playlist and use the
      // index-aligned upstream URL.
      const newPl = await upstreamRequest(refreshedUrl, { method: 'GET' });
      if (newPl.statusCode >= 400) {
        newPl.body.resume();
        throw new Error(`Refresh playlist failed: ${newPl.statusCode}`);
      }
      const newText = await newPl.body.text();
      const remapped = rewriteMediaPlaylist(newText, refreshedUrl, (s) => `seg-${s.index}.ts`);
      const replacement = remapped.segments[seg.index];
      if (!replacement) throw new Error(`Segment ${seg.index} missing post-refresh`);
      r = await upstreamRequest(replacement.originalUri, { method: 'GET' });
    }
    if (r.statusCode >= 400) {
      r.body.resume();
      throw new Error(`Segment ${seg.index} fetch failed: ${r.statusCode}`);
    }
    await storage.write(segKey, Readable.from(r.body), { contentType: 'video/mp2t' });
  }

  async function consume(): Promise<void> {
    for (;;) {
      const seg = queue.shift();
      if (!seg) return;
      await downloadOne(seg);
      completed++;
      if (completed === total || completed % 4 === 0) {
        await onProgress(completed, total);
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < SEGMENT_PARALLELISM; i++) workers.push(consume());
  await Promise.all(workers);

  return total;
}

// ── Top-level job handler ───────────────────────────────────────────────────

async function processSaveJob(job: Job<SaveJobData>): Promise<{ skipped?: boolean }> {
  const { savedMediaId, variantId } = job.data;

  const saved = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: {
      media: true,
      selectedVariant: true,
    },
  });
  if (!saved) throw new Error(`SavedMedia missing: ${savedMediaId}`);
  if (!saved.media) throw new Error(`Media link missing on SavedMedia: ${savedMediaId}`);

  // Variant is sourced via `selectedVariant` going forward, but for the
  // transitional period we honor the legacy `variantId` job payload too.
  const variant =
    saved.selectedVariant ??
    (await prisma.mediaVariant.findUnique({ where: { id: variantId } }));
  if (!variant) throw new Error(`Variant missing: ${variantId}`);

  await prisma.savedMedia.update({
    where: { id: savedMediaId },
    data: { state: 'DOWNLOADING', error: null },
  });

  const progress = new ProgressTracker(job);

  // Phase 1: canonical source.
  await persistMediaSource(saved.media, progress, savedMediaId);

  // Phase 2: HLS for the chosen quality (best-effort — failure here does NOT
  // prevent the saved entry from being usable, since source.mp4 covers the
  // download path. But we surface the error.).
  try {
    await persistVariantHls(variant, progress, savedMediaId);
  } catch (err) {
    logger.warn(
      { err, variantId: variant.id, mediaId: variant.mediaId },
      'save: HLS persistence failed; continuing with source-only save',
    );
    // Demote the variant cleanly so the player falls back to MP4 source.
    await prisma.mediaVariant
      .update({
        where: { id: variant.id },
        data: { state: 'EPHEMERAL', storageKey: null },
      })
      .catch(() => undefined);
  }

  await prisma.savedMedia.update({
    where: { id: savedMediaId },
    data: { state: 'COMPLETE', progress: 1, completedAt: new Date(), error: null },
  });

  return {};
}

// ── Worker bootstrap ────────────────────────────────────────────────────────

export function startSaveWorker(): Worker<SaveJobData> {
  const worker = new Worker<SaveJobData>(
    QUEUE_NAMES.save,
    processSaveJob,
    {
      connection: getRedis(),
      concurrency: 4,
    },
  );

  worker.on('failed', async (job, err) => {
    logger.error({ err, jobId: job?.id, savedMediaId: job?.data?.savedMediaId }, 'save job failed');
    if (!job) return;
    const isFinal = job.attemptsMade >= (job.opts.attempts ?? 1);
    await prisma.savedMedia
      .update({
        where: { id: job.data.savedMediaId },
        data: {
          state: isFinal ? 'FAILED' : 'PENDING',
          error: err.message.slice(0, 500),
        },
      })
      .catch(() => undefined);
  });

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, savedMediaId: job.data.savedMediaId, variantId: job.data.variantId },
      'save job complete',
    );
  });

  return worker;
}
