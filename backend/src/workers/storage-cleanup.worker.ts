import { Worker } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../lib/logger.js';
import { permanentStorage } from '../services/storage/index.js';
import { QUEUE_NAMES } from '../queues/types.js';

const GRACE_MS = 24 * 60 * 60 * 1000; // 24h grace before delete

/**
 * Purge variants marked PENDING_DELETE whose grace window has elapsed AND
 * which have no remaining SavedMedia references.
 */
async function purgePending(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_MS);
  const candidates = await prisma.mediaVariant.findMany({
    where: { state: 'PENDING_DELETE', updatedAt: { lt: cutoff } },
    take: 100,
  });

  for (const v of candidates) {
    const refs = await prisma.savedMedia.count({ where: { mediaVariantId: v.id } });
    if (refs > 0) {
      // Someone re-saved during grace; restore.
      await prisma.mediaVariant.update({
        where: { id: v.id },
        data: { state: v.storageKey ? 'PERSISTED' : 'EPHEMERAL' },
      });
      continue;
    }

    if (v.storageKey) {
      // List + delete everything under storageKey/.
      try {
        for await (const f of permanentStorage().list(v.storageKey)) {
          await permanentStorage().delete(`${v.storageKey}/${f.key}`);
        }
      } catch (err) {
        logger.warn({ err, variantId: v.id }, 'storage delete failed');
        continue;
      }
    }

    await prisma.mediaVariant.update({
      where: { id: v.id },
      data: { state: 'EPHEMERAL', storageKey: null, sha256: null, sizeBytes: null },
    });
    logger.info({ variantId: v.id }, 'storage purged');
  }
}

export function startStorageCleanupWorker(): Worker {
  const w = new Worker(
    QUEUE_NAMES.cleanupStorage,
    async (job) => {
      if (job.name === 'purge-pending') await purgePending();
    },
    { connection: getRedis(), concurrency: 1 },
  );
  w.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id }, 'storage cleanup failed'),
  );
  return w;
}
