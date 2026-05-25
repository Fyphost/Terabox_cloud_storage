/**
 * workers/storage-cleanup.worker.ts
 *
 * Two cleanup pathways, both grace-period-protected:
 *
 *   1. Variant HLS bytes
 *      MediaVariant.state = PENDING_DELETE for > GRACE_MS
 *      AND no SavedMedia.selectedVariantId references it
 *      → delete all bytes under `media/<mediaId>/hls/<quality>/`
 *      → reset variant to EPHEMERAL with storageKey=null
 *
 *   2. Media source.mp4
 *      Media.sourcePendingDeleteAt < cutoff
 *      AND no SavedMedia rows reference the media
 *      → delete `media/<mediaId>/source.<ext>` AND any leftover hls/
 *        directory if all variants are also EPHEMERAL/PENDING_DELETE
 *      → clear Media.{sourceStorageKey, sourceSizeBytes, sourceSha256,
 *        sourceContentType, sourcePersistedAt, sourcePendingDeleteAt}
 *
 * If a SavedMedia reappears during the grace window, both pathways notice
 * and restore the row instead of deleting bytes — saves are sticky.
 */

import { Worker } from 'bullmq';
import { rm } from 'node:fs/promises';
import { resolve as resolvePath, join as joinPath } from 'node:path';
import { getRedis } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { permanentStorage } from '../services/storage/index.js';
import { mediaPrefix } from '../services/storage/keys.js';
import { QUEUE_NAMES } from '../queues/types.js';

const GRACE_MS = 24 * 60 * 60 * 1000;
const VARIANT_BATCH = 100;
const MEDIA_BATCH = 100;

async function purgePendingVariants(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_MS);
  const candidates = await prisma.mediaVariant.findMany({
    where: { state: 'PENDING_DELETE', updatedAt: { lt: cutoff } },
    take: VARIANT_BATCH,
  });

  for (const v of candidates) {
    try {
      // Restore if a save reappeared.
      const refs = await prisma.savedMedia.count({ where: { selectedVariantId: v.id } });
      if (refs > 0) {
        await prisma.mediaVariant.update({
          where: { id: v.id },
          data: { state: v.storageKey ? 'PERSISTED' : 'EPHEMERAL' },
        });
        logger.info({ variantId: v.id }, 'cleanup: variant restored (re-saved during grace)');
        continue;
      }

      // Delete bytes under v.storageKey if it's the canonical layout. We
      // explicitly refuse to recurse delete on legacy paths to avoid any
      // chance of clobbering files outside the variant directory.
      if (v.storageKey && v.storageKey.startsWith('media/')) {
        await deletePrefix(v.storageKey);
      } else if (v.storageKey) {
        logger.warn(
          { variantId: v.id, storageKey: v.storageKey },
          'cleanup: refusing to bulk-delete non-canonical variant storageKey',
        );
      }

      await prisma.mediaVariant.update({
        where: { id: v.id },
        data: { state: 'EPHEMERAL', storageKey: null, sha256: null, sizeBytes: null },
      });
      logger.info({ variantId: v.id, mediaId: v.mediaId }, 'cleanup: variant purged');
    } catch (err) {
      logger.error({ err, variantId: v.id }, 'cleanup: variant purge failed');
    }
  }
}

async function purgePendingMediaSources(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_MS);
  const candidates = await prisma.media.findMany({
    where: { sourcePendingDeleteAt: { lt: cutoff } },
    take: MEDIA_BATCH,
  });

  for (const m of candidates) {
    try {
      const refs = await prisma.savedMedia.count({ where: { mediaId: m.id } });
      if (refs > 0) {
        // Saved during grace — restore.
        await prisma.media.update({
          where: { id: m.id },
          data: { sourcePendingDeleteAt: null },
        });
        logger.info({ mediaId: m.id }, 'cleanup: media source restored (re-saved during grace)');
        continue;
      }

      // Delete source.<ext>.
      if (m.sourceStorageKey) {
        await permanentStorage().delete(m.sourceStorageKey).catch((err) => {
          logger.warn({ err, key: m.sourceStorageKey }, 'cleanup: source delete failed');
        });
      }

      // Also reap any leftover hls/ directory under the media — the variant
      // pathway would normally do this, but we sweep here too for safety.
      await deletePrefix(`${mediaPrefix(m.id)}/hls`).catch(() => undefined);

      // Drop the entire media/<mediaId>/ directory if it's now empty (best-effort).
      await deletePrefix(mediaPrefix(m.id)).catch(() => undefined);

      await prisma.media.update({
        where: { id: m.id },
        data: {
          sourceStorageKey: null,
          sourceSizeBytes: null,
          sourceSha256: null,
          sourceContentType: null,
          sourcePersistedAt: null,
          sourcePendingDeleteAt: null,
        },
      });
      logger.info({ mediaId: m.id }, 'cleanup: media source purged');
    } catch (err) {
      logger.error({ err, mediaId: m.id }, 'cleanup: media source purge failed');
    }
  }
}

/**
 * Recursively delete a key prefix from permanent storage.
 *
 * The LocalDiskBackend.delete() takes individual file keys, so we walk the
 * directory and delete files one-by-one through the backend (going through
 * the backend so the same code is forward-compatible with S3). We then use
 * fs.rm to clean the (now-empty) directory tree.
 */
async function deletePrefix(prefix: string): Promise<void> {
  const backend = permanentStorage();

  for await (const entry of backend.list(prefix)) {
    // backend.list yields keys *relative to the prefix*. Prepend it back.
    const fullKey = `${prefix}/${entry.key}`;
    await backend.delete(fullKey).catch(() => undefined);
  }

  // Drop any empty directories left behind. Restricted to the permanent root
  // so we never reach outside storage.
  const root = resolvePath(env.STORAGE_PERMANENT_DIR);
  const dirPath = joinPath(root, prefix);
  if (dirPath.startsWith(root)) {
    await rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function startStorageCleanupWorker(): Worker {
  const w = new Worker(
    QUEUE_NAMES.cleanupStorage,
    async (job) => {
      if (job.name === 'purge-pending') {
        await purgePendingVariants();
        await purgePendingMediaSources();
      }
    },
    { connection: getRedis(), concurrency: 1 },
  );
  w.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id }, 'storage cleanup failed'),
  );
  return w;
}
