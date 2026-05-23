import { Queue } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { QUEUE_NAMES } from './types.js';

export const cacheCleanupQueue = new Queue(QUEUE_NAMES.cleanupCache, {
  connection: getRedis(),
});

export const storageCleanupQueue = new Queue(QUEUE_NAMES.cleanupStorage, {
  connection: getRedis(),
});

/** Bootstrap repeatable schedules. Idempotent (BullMQ dedups by key). */
export async function scheduleCleanupCrons(): Promise<void> {
  await cacheCleanupQueue.add(
    'evict-lru',
    {},
    {
      repeat: { every: 10 * 60 * 1000 }, // 10 minutes
      jobId: 'cron:cache:evict-lru',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  await storageCleanupQueue.add(
    'purge-pending',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1 hour
      jobId: 'cron:storage:purge-pending',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
