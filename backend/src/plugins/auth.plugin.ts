import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    requireUser: () => string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; kind: 'ANON' | 'REGISTERED' };
    user: { sub: string; kind: 'ANON' | 'REGISTERED' };
  }
}

export default fp(async function authPlugin(app) {
  await app.register(cookie, {});
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: 'fph_token', signed: false },
  });

  app.decorateRequest('userId', undefined);
  app.decorateRequest('requireUser', function (this: any) {
    if (!this.userId) throw new AppError('UNAUTHORIZED', 'Authentication required');
    return this.userId;
  });

  app.addHook('preHandler', async (req) => {
    try {
      const decoded = await req.jwtVerify().catch(() => null);
      if (decoded && typeof decoded === 'object' && 'sub' in decoded) {
        req.userId = (decoded as { sub: string }).sub;
      }
    } catch {
      /* anonymous */
    }
  });
});
