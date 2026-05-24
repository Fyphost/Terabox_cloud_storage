import { Worker } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../lib/logger.js';
import { permanentStorage } from '../services/storage/index.js';
import { variantHlsDir, variantStagingDir } from '../services/storage/paths.js';
import { joinKey } from '../services/storage/verify.js';
import { QUEUE_NAMES } from '../queues/types.js';

const GRACE_MS = 24 * 60 * 60 * 1000; // 24h grace before delete
const PURGE_BATCH = 100;

/**
 * Purge variants marked PENDING_DELETE whose grace window has elapsed AND
 * which still have no remaining SavedVariant references.
 *
 * Behavior:
 *   - For HLS variants: rm -rf {storageKey}/hls/{quality}/
 *   - For MP4 variants: delete the single file
 *   - Always clean staging dir (best-effort)
 *   - Demote variant back to EPHEMERAL with cleared physical paths
 *   - If the parent Media has no PERSISTED variants remaining, blow away
 *     the master playlist + thumbnail; the metadata stays so the upstream
 *     hash dedup still works on re-ingest.
 */
async function purgePending(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_MS);
  const candidates = await prisma.mediaVariant.findMany({
    where: { state: 'PENDING_DELETE', updatedAt: { lt: cutoff } },
    include: { media: { select: { id: true, storageKey: true } } },
    take: PURGE_BATCH,
  });

  for (const v of candidates) {
    // Late-check: a user may have re-saved during the grace window.
    const refs = await prisma.savedVariant.count({ where: { mediaVariantId: v.id } });
    if (refs > 0) {
      await prisma.mediaVariant.update({
        where: { id: v.id },
        data: { state: v.hlsPlaylistKey || v.fileKey ? 'PERSISTED' : 'EPHEMERAL' },
      });
      continue;
    }

    const storage = permanentStorage();
    const mediaStorageKey = v.media.storageKey;

    try {
      // Always nuke staging — leftover from a failed attempt.
      await storage.deletePrefix(variantStagingDir(v.media.id, v.id)).catch(() => undefined);

      if (v.container === 'HLS') {
        // Delete {storageKey}/hls/{quality}/ tree.
        const hlsDirRel = mediaStorageKey
          ? variantHlsDir(v.media.id, v.quality).slice(mediaStorageKey.length + 1)
          : `hls/${v.quality}`;
        await storage.deletePrefix(joinKey(mediaStorageKey, hlsDirRel));
      } else if (v.container === 'MP4' && v.fileKey) {
        await storage.delete(joinKey(mediaStorageKey, v.fileKey));
      }
    } catch (err) {
      logger.warn({ err, variantId: v.id }, 'storage delete failed; will retry next pass');
      continue;
    }

    await prisma.mediaVariant.update({
      where: { id: v.id },
      data: {
        state: 'EPHEMERAL',
        hlsPlaylistKey: null,
        hlsSegmentDir: null,
        fileKey: null,
        sha256: null,
        sizeBytes: null,
        bytesDone: 0n,
        bytesTotal: null,
        progress: 0,
        pipelineStep: null,
        speedBytesPerSec: null,
        etaSec: null,
        errorMessage: null,
      },
    });
    logger.info({ variantId: v.id }, 'storage purged');

    // If no PERSISTED variants remain on this media, drop the master playlist.
    const persistedRemaining = await prisma.mediaVariant.count({
      where: { mediaId: v.mediaId, state: 'PERSISTED' },
    });
    if (persistedRemaining === 0) {
      const media = await prisma.media.findUnique({ where: { id: v.mediaId } });
      if (media?.masterPlaylistKey && media.storageKey) {
        await storage.delete(joinKey(media.storageKey, media.masterPlaylistKey)).catch(() => undefined);
        await prisma.media
          .update({ where: { id: v.mediaId }, data: { masterPlaylistKey: null } })
          .catch(() => undefined);
      }
    }
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
