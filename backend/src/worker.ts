/**
 * Worker process entrypoint — BullMQ consumers.
 *
 * Hardening applied:
 *   1. Validates Redis connectivity before starting any workers.
 *   2. Registers a QueueEvents listener for stalled jobs.
 *   3. Catches unhandled rejections to force clean exit (PM2 restarts).
 *   4. kill_timeout in PM2 is 60s — workers call close() which waits for
 *      in-flight jobs to finish (BullMQ default: 30s drain timeout).
 */

import { QueueEvents } from 'bullmq';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { createBullConnection, disconnectRedis, validateRedis } from './config/redis.js';
import { scheduleCleanupCrons } from './queues/cleanup.queue.js';
import { QUEUE_NAMES } from './queues/types.js';
import { startSaveWorker } from './workers/save.worker.js';
import { startCacheCleanupWorker } from './workers/cache-cleanup.worker.js';
import { startStorageCleanupWorker } from './workers/storage-cleanup.worker.js';

async function main(): Promise<void> {
  // Validate Redis before anything else.
  try {
    await validateRedis();
  } catch (err) {
    logger.fatal({ err }, 'redis startup check failed (worker)');
    process.exit(1);
  }

  await scheduleCleanupCrons();

  const workers = [
    startSaveWorker(),
    startCacheCleanupWorker(),
    startStorageCleanupWorker(),
  ];

  // Monitor stalled jobs in the save queue.
  // BullMQ marks a job "stalled" if the worker doesn't report progress
  // within lockDuration (default 30s). This happens on worker crash.
  const saveQueueEvents = new QueueEvents(QUEUE_NAMES.save, {
    connection: createBullConnection(),
  });
  saveQueueEvents.on('stalled', ({ jobId }) => {
    logger.warn({ jobId, queue: QUEUE_NAMES.save }, 'job stalled — will be retried by BullMQ');
  });
  saveQueueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error({ jobId, failedReason, queue: QUEUE_NAMES.save }, 'job failed (event)');
  });

  logger.info({ count: workers.length }, 'fyphost workers running');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down workers');
    try {
      await saveQueueEvents.close();
      await Promise.all(workers.map((w) => w.close()));
      await disconnectPrisma();
      await disconnectRedis();
    } catch (err) {
      logger.error({ err }, 'worker shutdown error');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection in worker — process will exit');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'worker boot failure');
  process.exit(1);
});
