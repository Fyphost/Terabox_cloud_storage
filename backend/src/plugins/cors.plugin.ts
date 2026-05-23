import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { env } from '../config/env.js';

/**
 * CORS rules:
 * - Stream routes (`/api/v1/stream/*`, `/api/v1/media/.../master.m3u8`)
 *   handle their own permissive CORS in the route handler. They are signed
 *   by URL, no cookie required, so `*` is safe and is what hls.js needs.
 * - JSON API routes use the configured allowlist with credentials.
 */
export default fp(async function corsPlugin(app) {
  const allowlist =
    env.CORS_ORIGIN === '*'
      ? true
      : env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowlist === true) return cb(null, true);
      if (allowlist.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-Requested-With'],
    exposedHeaders: [
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
      'Content-Disposition',
      'Content-Type',
    ],
    maxAge: 86400,
  });
});
