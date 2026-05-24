import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ingestUrl } from './ingest.service.js';
import { presentMedia } from '../media/media.service.js';

const Body = z.object({
  url: z.string().url().max(2048),
  // Homepage analyze always sends `forceRefresh: true`. Default false so
  // ingestion called as part of other flows can reuse fresh results.
  forceRefresh: z.boolean().optional(),
});

const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '10 minutes' },
      },
    },
    async (req, reply) => {
      const body = Body.parse(req.body);
      const { media, variants } = await ingestUrl(body.url, {
        forceRefresh: body.forceRefresh ?? false,
      });
      const presented = await presentMedia(media, variants, req.userId ?? null);
      return reply.send(presented);
    },
  );
};

export default ingestRoutes;
