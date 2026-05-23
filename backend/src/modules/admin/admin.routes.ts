import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getStats, listFailedJobs, listUsers } from './admin.service.js';

const PageQuery = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req) => {
    req.requireAdmin();
  });

  app.get('/stats', async () => {
    return getStats();
  });

  app.get('/users', async (req) => {
    const q = PageQuery.parse(req.query);
    return listUsers(q);
  });

  app.get('/jobs/failed', async (req) => {
    const q = PageQuery.parse(req.query);
    return listFailedJobs({ take: q.take ?? 50 });
  });
};

export default adminRoutes;
