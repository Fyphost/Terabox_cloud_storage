import { logger } from './lib/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { disconnectRedis } from './config/redis.js';
import { scheduleCleanupCrons } from './queues/cleanup.queue.js';
import { startSaveWorker } from './workers/save.worker.js';
import { startCacheCleanupWorker } from './workers/cache-cleanup.worker.js';
import { startStorageCleanupWorker } from './workers/storage-cleanup.worker.js';

async function main(): Promise<void> {
  await scheduleCleanupCrons();

  const workers = [
    startSaveWorker(),
    startCacheCleanupWorker(),
    startStorageCleanupWorker(),
  ];

  logger.info({ count: workers.length }, 'fyphost workers running');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down workers');
    await Promise.all(workers.map((w) => w.close()));
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker boot failure');
  process.exit(1);
});
