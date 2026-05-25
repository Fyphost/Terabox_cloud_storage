/**
 * Share routes.
 *
 * Two surfaces:
 *
 *   Authenticated (manage shares):
 *     POST /api/v1/share           — create a share token
 *     GET  /api/v1/share/list/:savedMediaId — list tokens for a saved media
 *     POST /api/v1/share/revoke    — disable a share token
 *
 *   Public (consume shares):
 *     GET  /api/v1/share/:token    — resolve token → fresh signed URLs
 *
 * The public route dynamically generates short-lived signed playback URLs.
 * The share token itself is permanent (unless revoked or expired).
 * Raw storage paths are NEVER exposed to the public consumer.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createShareToken,
  listShareTokens,
  resolveShareToken,
  revokeShareToken,
} from './share.service.js';

const CreateBody = z.object({
  savedMediaId: z.string().min(1),
  quality: z.string().optional(),
});

const RevokeBody = z.object({
  tokenId: z.string().min(1),
});

const ListParams = z.object({
  savedMediaId: z.string().min(1),
});

const TokenParam = z.object({
  token: z.string().min(1),
});

const shareRoutes: FastifyPluginAsync = async (app) => {
  // ── Create share token (authenticated) ──────────────────────────────────
  app.post('/', async (req) => {
    const userId = req.requireRegistered();
    const body = CreateBody.parse(req.body);
    return createShareToken({
      userId,
      savedMediaId: body.savedMediaId,
      quality: body.quality,
    });
  });

  // ── List share tokens for a saved media (authenticated) ─────────────────
  app.get('/list/:savedMediaId', async (req) => {
    const userId = req.requireRegistered();
    const { savedMediaId } = ListParams.parse(req.params);
    return listShareTokens(savedMediaId, userId);
  });

  // ── Revoke a share token (authenticated) ────────────────────────────────
  app.post('/revoke', async (req, reply) => {
    const userId = req.requireRegistered();
    const body = RevokeBody.parse(req.body);
    await revokeShareToken(body.tokenId, userId);
    reply.status(204).send();
  });

  // ── Public: resolve share token → fresh signed URLs ─────────────────────
  // No auth required. The token IS the auth.
  app.get('/:token', async (req) => {
    const { token } = TokenParam.parse(req.params);
    return resolveShareToken(token);
  });
};

export default shareRoutes;
