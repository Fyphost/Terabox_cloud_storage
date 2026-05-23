import { Worker, type Job } from 'bullmq';
import { Readable } from 'node:stream';
import { prisma } from '../config/prisma.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { upstreamRequest } from '../lib/http.js';
import { permanentStorage } from '../services/storage/index.js';
import {
  rewriteMediaPlaylist,
  type SegmentRewrite,
} from '../modules/stream/hls.rewriter.js';
import { refreshVariantUpstream } from '../modules/ingest/ingest.service.js';
import { QUEUE_NAMES } from '../queues/types.js';
import type { SaveJobData } from '../queues/save.queue.js';

const LOCK_TTL_MS = 30 * 60 * 1000; // 30 min
const SEGMENT_PARALLELISM = 4;

function variantStorageKey(variantId: string): string {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${variantId}`;
}

async function withVariantLock<T>(variantId: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const key = `lock:variant:${variantId}`;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;

  // SET NX EX — single-instance lock; BullMQ handles fairness across workers.
  const start = Date.now();
  while (Date.now() - start < LOCK_TTL_MS) {
    const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        // Release only if still ours.
        const lua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
        await redis.eval(lua, 1, key, token).catch(() => undefined);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Failed to acquire variant lock: ${variantId}`);
}

async function updateProgress(savedMediaId: string, progress: number): Promise<void> {
  await prisma.savedMedia.update({
    where: { id: savedMediaId },
    data: { progress: Math.max(0, Math.min(1, progress)) },
  });
}

async function downloadHls(
  job: Job<SaveJobData>,
  variantId: string,
  upstreamPlaylistUrl: string,
  storageKeyPrefix: string,
): Promise<{ bytes: number }> {
  const storage = permanentStorage();

  // 1. Fetch playlist.
  let playlistResp = await upstreamRequest(upstreamPlaylistUrl, { method: 'GET' });
  if (playlistResp.statusCode === 403 || playlistResp.statusCode === 404) {
    playlistResp.body.resume();
    const refreshed = await refreshVariantUpstream(variantId);
    if (!refreshed) throw new Error('Upstream playlist expired and refresh failed');
    upstreamPlaylistUrl = refreshed;
    playlistResp = await upstreamRequest(upstreamPlaylistUrl, { method: 'GET' });
  }
  if (playlistResp.statusCode >= 400) {
    playlistResp.body.resume();
    throw new Error(`Playlist fetch failed: ${playlistResp.statusCode}`);
  }
  const playlistText = await playlistResp.body.text();

  // 2. Rewrite to local segment paths.
  const rewritten = rewriteMediaPlaylist(
    playlistText,
    upstreamPlaylistUrl,
    (seg) => `seg-${seg.index}.ts`,
  );

  // 3. Persist rewritten playlist.
  await storage.write(
    `${storageKeyPrefix}/playlist.m3u8`,
    Readable.from(Buffer.from(rewritten.body, 'utf8')),
    { contentType: 'application/vnd.apple.mpegurl' },
  );

  // 4. Download segments with bounded parallelism + per-segment progress.
  const total = rewritten.segments.length;
  if (total === 0) throw new Error('Empty playlist');

  let completed = 0;
  let totalBytes = 0;

  const queue = [...rewritten.segments];
  const workers: Promise<void>[] = [];

  const downloadOne = async (seg: SegmentRewrite) => {
    const targetKey = `${storageKeyPrefix}/seg-${seg.index}.ts`;
    if (await permanentStorage().exists(targetKey)) {
      // resumed — already on disk
      return;
    }
    let resp = await upstreamRequest(seg.originalUri, { method: 'GET' });
    if (resp.statusCode === 403 || resp.statusCode === 404) {
      resp.body.resume();
      const refreshed = await refreshVariantUpstream(variantId);
      if (!refreshed) throw new Error(`Segment ${seg.index} expired`);
      // After refresh, re-fetch playlist and remap segment URLs.
      const newPl = await upstreamRequest(refreshed, { method: 'GET' });
      if (newPl.statusCode >= 400) {
        newPl.body.resume();
        throw new Error(`Refresh playlist failed: ${newPl.statusCode}`);
      }
      const newText = await newPl.body.text();
      const remapped = rewriteMediaPlaylist(newText, refreshed, (s) => `seg-${s.index}.ts`);
      const replacement = remapped.segments[seg.index];
      if (!replacement) throw new Error(`Segment ${seg.index} missing post-refresh`);
      resp = await upstreamRequest(replacement.originalUri, { method: 'GET' });
    }
    if (resp.statusCode >= 400) {
      resp.body.resume();
      throw new Error(`Segment ${seg.index} fetch failed: ${resp.statusCode}`);
    }
    const result = await storage.write(targetKey, Readable.from(resp.body), {
      contentType: 'video/mp2t',
    });
    totalBytes += result.bytes;
  };

  const consume = async () => {
    for (;;) {
      const seg = queue.shift();
      if (!seg) return;
      await downloadOne(seg);
      completed++;
      // Update progress every few segments to avoid DB write storms.
      if (completed % 4 === 0 || completed === total) {
        await updateProgress(job.data.savedMediaId, completed / total);
        await job.updateProgress(Math.round((completed / total) * 100));
      }
    }
  };

  for (let i = 0; i < SEGMENT_PARALLELISM; i++) workers.push(consume());
  await Promise.all(workers);

  return { bytes: totalBytes };
}

async function downloadFile(
  job: Job<SaveJobData>,
  variantId: string,
  upstreamFileUrl: string,
  storageKeyPrefix: string,
): Promise<{ bytes: number; sha256: string }> {
  const storage = permanentStorage();
  const targetKey = `${storageKeyPrefix}/file.bin`;

  let resp = await upstreamRequest(upstreamFileUrl, { method: 'GET' });
  if (resp.statusCode === 403 || resp.statusCode === 404) {
    resp.body.resume();
    const refreshed = await refreshVariantUpstream(variantId);
    if (!refreshed) throw new Error('Upstream file expired and refresh failed');
    resp = await upstreamRequest(refreshed, { method: 'GET' });
  }
  if (resp.statusCode >= 400) {
    resp.body.resume();
    throw new Error(`File fetch failed: ${resp.statusCode}`);
  }

  const total = Number(resp.headers['content-length'] ?? 0);
  let downloaded = 0;
  const body = Readable.from(resp.body);
  if (total > 0) {
    body.on('data', (c: Buffer) => {
      downloaded += c.length;
      const p = downloaded / total;
      // Throttle progress updates.
      if (downloaded % (4 * 1024 * 1024) < c.length) {
        void updateProgress(job.data.savedMediaId, p);
        void job.updateProgress(Math.round(p * 100));
      }
    });
  }

  const result = await storage.write(targetKey, body, {
    contentType: resp.headers['content-type'] as string | undefined,
  });
  return result;
}

export function startSaveWorker(): Worker<SaveJobData> {
  const worker = new Worker<SaveJobData>(
    QUEUE_NAMES.save,
    async (job) => {
      const { savedMediaId, variantId } = job.data;

      const variant = await prisma.mediaVariant.findUnique({
        where: { id: variantId },
        include: { media: true },
      });
      if (!variant) throw new Error(`Variant ${variantId} missing`);

      // Already persisted — fast-complete.
      if (variant.state === 'PERSISTED' && variant.storageKey) {
        await prisma.savedMedia.update({
          where: { id: savedMediaId },
          data: { state: 'COMPLETE', progress: 1, completedAt: new Date() },
        });
        return { skipped: true };
      }

      await prisma.savedMedia.update({
        where: { id: savedMediaId },
        data: { state: 'DOWNLOADING' },
      });

      return withVariantLock(variantId, async () => {
        // Re-check after acquiring the lock.
        const v = await prisma.mediaVariant.findUnique({ where: { id: variantId } });
        if (!v) throw new Error(`Variant ${variantId} missing`);
        if (v.state === 'PERSISTED' && v.storageKey) {
          await prisma.savedMedia.update({
            where: { id: savedMediaId },
            data: { state: 'COMPLETE', progress: 1, completedAt: new Date() },
          });
          return { skipped: true };
        }

        const storageKey = v.storageKey ?? variantStorageKey(variantId);

        let bytes = 0;
        let sha256: string | undefined;

        if (v.container === 'HLS' && v.upstreamPlaylistUrl) {
          const r = await downloadHls(job, variantId, v.upstreamPlaylistUrl, storageKey);
          bytes = r.bytes;
        } else if (v.upstreamFileUrl) {
          const r = await downloadFile(job, variantId, v.upstreamFileUrl, storageKey);
          bytes = r.bytes;
          sha256 = r.sha256;
        } else {
          throw new Error('Variant has no usable upstream URL');
        }

        await prisma.mediaVariant.update({
          where: { id: variantId },
          data: {
            state: 'PERSISTED',
            storageKey,
            sizeBytes: BigInt(bytes),
            sha256: sha256 ?? null,
          },
        });
        await prisma.savedMedia.update({
          where: { id: savedMediaId },
          data: { state: 'COMPLETE', progress: 1, completedAt: new Date() },
        });

        return { bytes };
      });
    },
    {
      connection: getRedis(),
      concurrency: 4,
    },
  );

  worker.on('failed', async (job, err) => {
    logger.error({ err, jobId: job?.id }, 'save job failed');
    if (job) {
      await prisma.savedMedia
        .update({
          where: { id: job.data.savedMediaId },
          data: {
            state: job.attemptsMade >= (job.opts.attempts ?? 1) ? 'FAILED' : 'PENDING',
            error: err.message.slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'save job complete');
  });

  return worker;
}
