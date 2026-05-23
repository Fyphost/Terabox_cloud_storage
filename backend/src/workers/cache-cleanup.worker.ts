import { Worker } from 'bullmq';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../lib/logger.js';
import { cacheStorage } from '../services/storage/index.js';
import { QUEUE_NAMES } from '../queues/types.js';

/**
 * LRU eviction by walking the cache root and ordering by mtime.
 * Cheap and correct for v1; replace with DB-driven version when CacheEntry
 * rows are populated by the proxy write-through path.
 */
async function evictLru(): Promise<void> {
  const root = resolve(env.STORAGE_CACHE_DIR);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat) return;

  const files: { key: string; size: number; mtimeMs: number }[] = [];
  for await (const f of cacheStorage().list('.')) {
    files.push(f);
  }

  let total = files.reduce((acc, f) => acc + f.size, 0);
  if (total <= env.CACHE_HIGH_WATERMARK_BYTES) {
    logger.debug({ total }, 'cache below high watermark; skip eviction');
    return;
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

  let removed = 0;
  for (const f of files) {
    if (total <= env.CACHE_LOW_WATERMARK_BYTES) break;
    await cacheStorage().delete(f.key);
    total -= f.size;
    removed++;

    // Best-effort: drop CacheEntry row if it exists.
    const [variantId, segmentKey] = splitKey(f.key);
    if (variantId && segmentKey) {
      await prisma.cacheEntry
        .deleteMany({ where: { mediaVariantId: variantId, segmentKey } })
        .catch(() => undefined);
    }
  }

  logger.info({ removed, total }, 'cache eviction complete');
}

function splitKey(key: string): [string | null, string | null] {
  const idx = key.indexOf('/');
  if (idx <= 0) return [null, null];
  return [key.slice(0, idx), key.slice(idx + 1)];
}

export function startCacheCleanupWorker(): Worker {
  const w = new Worker(
    QUEUE_NAMES.cleanupCache,
    async (job) => {
      if (job.name === 'evict-lru') await evictLru();
    },
    { connection: getRedis(), concurrency: 1 },
  );
  w.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id }, 'cache cleanup failed'),
  );
  return w;
}
