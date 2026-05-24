import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enqueueSave, getSavedMediaProgress, retrySavedVariant } from './save.service.js';

const Body = z.object({
  mediaId: z.string().min(1),
  qualities: z.array(z.string().min(1)).min(1).max(8),
});

const Params = z.object({ savedMediaId: z.string().min(1) });
const RetryParams = z.object({ savedVariantId: z.string().min(1) });

const saveRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/',
    { config: { rateLimit: { max: 50, timeWindow: '1 day' } } },
    async (req, reply) => {
      const userId = req.requireRegistered();
      const body = Body.parse(req.body);
      const result = await enqueueSave({ userId, ...body });
      return reply.status(202).send(result);
    },
  );

  app.get('/:savedMediaId', async (req) => {
    const userId = req.requireRegistered();
    const { savedMediaId } = Params.parse(req.params);
    return getSavedMediaProgress(savedMediaId, userId);
  });

  app.post('/variant/:savedVariantId/retry', async (req) => {
    const userId = req.requireRegistered();
    const { savedVariantId } = RetryParams.parse(req.params);
    return retrySavedVariant(savedVariantId, userId);
  });
};

export default saveRoutes;
