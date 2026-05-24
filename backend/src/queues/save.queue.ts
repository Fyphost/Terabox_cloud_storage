import { Queue } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { QUEUE_NAMES } from './types.js';

/**
 * Save jobs operate at the (user-claim, variant) level.
 *
 *   savedMediaId : the user's SavedMedia row that triggered this attempt
 *   variantId    : the MediaVariant being downloaded
 *
 * Job IDs are unique per attempt — see save.service for the construction.
 * The worker treats the variant as the single point of truth for bytes;
 * the savedMediaId is used only for ownership audit and roll-up state
 * recomputation after the variant transitions.
 */
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
