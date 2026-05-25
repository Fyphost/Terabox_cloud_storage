import IORedis, { type Redis, type RedisOptions } from 'ioredis';
import { env } from './env.js';

let _redis: Redis | null = null;

// Under NodeNext + CommonJS interop, `import IORedis from 'ioredis'` resolves
// to the module namespace at runtime; the constructor lives on `.default`.
// Resolve the constructor at runtime once and lock it in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RedisCtor: any = (IORedis as any).default ?? IORedis;

export function getRedis(): Redis {
  if (_redis) return _redis;
  const opts: RedisOptions = {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const r: Redis = new RedisCtor(env.REDIS_URL, opts);
  _redis = r;
  return r;
}

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
