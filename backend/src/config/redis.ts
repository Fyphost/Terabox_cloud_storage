/**
 * Redis connection — singleton with startup validation.
 *
 * Root causes fixed:
 *   1. Previous code never validated Redis connectivity at startup.
 *      If REDIS_URL was wrong, the first BullMQ operation would crash
 *      minutes later with an opaque error.
 *   2. No error event handler → unhandled 'error' events crashed the process.
 *   3. Worker needs a SEPARATE connection for BullMQ (BullMQ docs mandate
 *      maxRetriesPerRequest: null). We expose both getRedis() for general
 *      use and createBullConnection() for queue/worker constructors.
 */

import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

let _redis: Redis | null = null;

/**
 * Get the shared Redis connection. Lazily created on first call.
 * Safe for rate-limit, caching, signed-URL replay sets, etc.
 */
export function getRedis(): Redis {
  if (_redis) return _redis;
  // Build a local const so TS narrows it as non-null in the closures below.
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ if same connection is reused
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times: number): number {
      // Exponential backoff capped at 10s.
      return Math.min(times * 500, 10_000);
    },
  });
  client.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'redis connection error');
  });
  client.on('connect', () => {
    logger.info('redis connected');
  });
  _redis = client;
  return client;
}

/**
 * Validate Redis is reachable. Call at startup before accepting traffic.
 * Throws if PING fails after timeout.
 */
export async function validateRedis(timeoutMs = 5000): Promise<void> {
  const redis = getRedis();
  const timer = setTimeout(() => {
    throw new Error(`Redis PING timed out after ${timeoutMs}ms. Check REDIS_URL.`);
  }, timeoutMs);
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Redis PING returned unexpected: ${pong}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a dedicated connection for BullMQ queues/workers.
 * BullMQ requires maxRetriesPerRequest: null and recommends separate
 * connections for producers vs consumers.
 */
export function createBullConnection(): Redis {
  const conn = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times: number): number {
      return Math.min(times * 500, 10_000);
    },
  });
  conn.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'bullmq redis connection error');
  });
  return conn;
}

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => undefined);
    _redis = null;
  }
}
