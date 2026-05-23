import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { getRedis } from '../config/redis.js';

export default fp(async function ratelimitPlugin(app) {
  await app.register(rateLimit, {
    global: false,
    redis: getRedis(),
    keyGenerator: (req) => {
      // Prefer userId for authenticated routes; fall back to IP.
      return req.userId ?? req.ip;
    },
  });
});
