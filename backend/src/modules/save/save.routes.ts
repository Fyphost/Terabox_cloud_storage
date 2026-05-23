import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enqueueSave, getSaveJobStatus } from './save.service.js';

const Body = z.object({
  mediaId: z.string().min(1),
  qualities: z.array(z.string().min(1)).min(1).max(8),
});

const Params = z.object({ savedMediaId: z.string().min(1) });

const saveRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/',
    {
      config: {
        rateLimit: { max: 50, timeWindow: '1 day' },
      },
    },
    async (req, reply) => {
      const userId = req.requireUser();
      const body = Body.parse(req.body);
      const result = await enqueueSave({ userId, ...body });
      return reply.status(202).send({ jobs: result });
    },
  );

  app.get('/:savedMediaId', async (req) => {
    const userId = req.requireUser();
    const { savedMediaId } = Params.parse(req.params);
    return getSaveJobStatus(savedMediaId, userId);
  });
};

export default saveRoutes;
