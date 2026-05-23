import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ingestUrl } from './ingest.service.js';
import { presentMedia } from '../media/media.service.js';

const Body = z.object({
  url: z.string().url().max(2048),
});

const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '10 minutes',
        },
      },
    },
    async (req, reply) => {
      const { url } = Body.parse(req.body);
      const { media, variants } = await ingestUrl(url);
      const presented = await presentMedia(media, variants, req.userId ?? null);
      return reply.send(presented);
    },
  );
};

export default ingestRoutes;
