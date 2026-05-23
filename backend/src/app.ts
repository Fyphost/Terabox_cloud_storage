import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import corsPlugin from './plugins/cors.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import ratelimitPlugin from './plugins/ratelimit.plugin.js';

import healthRoutes from './modules/health/health.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import ingestRoutes from './modules/ingest/ingest.routes.js';
import mediaRoutes from './modules/media/media.routes.js';
import streamRoutes from './modules/stream/stream.routes.js';
import saveRoutes from './modules/save/save.routes.js';
import libraryRoutes from './modules/library/library.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024, // 1 MB; streaming routes don't read bodies
  });

  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(corsPlugin);
  await app.register(authPlugin);
  await app.register(ratelimitPlugin);

  await app.register(healthRoutes, { prefix: '/api/v1/health' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(ingestRoutes, { prefix: '/api/v1/ingest' });
  await app.register(mediaRoutes, { prefix: '/api/v1/media' });
  await app.register(streamRoutes, { prefix: '/api/v1/stream' });
  await app.register(saveRoutes, { prefix: '/api/v1/save' });
  await app.register(libraryRoutes, { prefix: '/api/v1/library' });

  app.get('/', async () => ({ name: 'fyphost', env: env.NODE_ENV }));

  return app;
}
