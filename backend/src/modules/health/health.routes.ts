import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { getRedis } from '../../config/redis.js';

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/live', async () => ({ ok: true }));

  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const pong = await getRedis().ping();
      return { ok: true, redis: pong === 'PONG' };
    } catch (err) {
      reply.status(503);
      return { ok: false, error: (err as Error).message };
    }
  });
};

export default healthRoutes;
