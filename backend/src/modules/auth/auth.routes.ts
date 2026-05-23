import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { newUserId } from '../../lib/ids.js';

const COOKIE_NAME = 'fph_token';

const authRoutes: FastifyPluginAsync = async (app) => {
  /** Anonymous device-bound token. Issued on first visit; persists library. */
  app.post('/anon', async (req, reply) => {
    let userId = req.userId;
    if (!userId) {
      const user = await prisma.user.create({
        data: { id: newUserId(), kind: 'ANON' },
      });
      userId = user.id;
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date() },
      });
    }
    const token = await reply.jwtSign({ sub: userId, kind: 'ANON' }, { expiresIn: '14d' });
    reply
      .setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 14 * 24 * 3600,
      })
      .send({ userId, token });
  });

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' }).send({ ok: true });
  });

  app.get('/me', async (req) => {
    if (!req.userId) return { user: null };
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    return { user: user ? { id: user.id, kind: user.kind, email: user.email } : null };
  });
};

export default authRoutes;
