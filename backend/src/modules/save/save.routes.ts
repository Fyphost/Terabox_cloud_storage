import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enqueueSave, getSaveJobStatus } from './save.service.js';

/**
 * Save request body — single quality only.
 *
 * The previous shape was `qualities: string[]` (1..8), which created the
 * "user can persist many qualities for one media" defect. The new shape
 * enforces ONE canonical quality per saved media at the contract level so
 * the frontend cannot accidentally re-introduce multi-quality saves.
 */
const Body = z.object({
  mediaId: z.string().min(1),
  quality: z.string().regex(/^(audio|\d{3,4}p)$/),
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
      const result = await enqueueSave({ userId, mediaId: body.mediaId, quality: body.quality });
      return reply.status(202).send(result);
    },
  );

  app.get('/:savedMediaId', async (req) => {
    const userId = req.requireUser();
    const { savedMediaId } = Params.parse(req.params);
    return getSaveJobStatus(savedMediaId, userId);
  });
};

export default saveRoutes;
