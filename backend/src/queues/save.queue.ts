import { Queue } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { QUEUE_NAMES } from './types.js';

export interface SaveJobData {
  savedMediaId: string;
  variantId: string;
}

export const saveQueue = new Queue<SaveJobData>(QUEUE_NAMES.save, {
  connection: getRedis(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 1000 },
  },
});
