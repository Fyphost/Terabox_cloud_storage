import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getOrCreateShareToken,
  resolveShareToken,
  revokeShareToken,
} from './share.service.js';

const TokenParam = z.object({ token: z.string().min(20).max(64).regex(/^sht_[A-Za-z0-9]+$/) });
const SavedMediaParam = z.object({ savedMediaId: z.string().min(1) });

const shareRoutes: FastifyPluginAsync = async (app) => {
  // ── Public: resolve a share token to media + freshly-signed playback URLs.
  // No auth required. The token is the capability.
  app.get(
    '/:token',
    {
      config: {
        rateLimit: { max: 600, timeWindow: '1 minute' },
      },
    },
    async (req) => {
      const { token } = TokenParam.parse(req.params);
      return resolveShareToken(token);
    },
  );

  // ── Authenticated: mint or fetch a share token for a SavedMedia. ───────
  app.post('/by-saved/:savedMediaId', async (req, reply) => {
    const userId = req.requireUser();
    const { savedMediaId } = SavedMediaParam.parse(req.params);
    const info = await getOrCreateShareToken(savedMediaId, userId);
    return reply.status(200).send(info);
  });

  // ── Authenticated: revoke a token (owner only). ────────────────────────
  app.delete('/by-saved/:savedMediaId', async (req, reply) => {
    const userId = req.requireUser();
    const { savedMediaId } = SavedMediaParam.parse(req.params);
    await revokeShareToken(savedMediaId, userId);
    return reply.status(204).send();
  });
};

export default shareRoutes;
