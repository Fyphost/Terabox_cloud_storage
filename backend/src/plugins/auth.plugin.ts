import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export const ACCESS_COOKIE = 'fph_access';
export const REFRESH_COOKIE = 'fph_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userRole?: 'USER' | 'ADMIN';
    userKind?: 'ANON' | 'REGISTERED';
    requireUser: () => string;
    requireRegistered: () => string;
    requireAdmin: () => string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; kind: 'ANON' | 'REGISTERED'; role?: 'USER' | 'ADMIN' };
    user: { sub: string; kind: 'ANON' | 'REGISTERED'; role?: 'USER' | 'ADMIN' };
  }
}

export default fp(async function authPlugin(app) {
  await app.register(cookie, {});
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: ACCESS_COOKIE, signed: false },
  });

  app.decorateRequest('userId', undefined);
  app.decorateRequest('userRole', undefined);
  app.decorateRequest('userKind', undefined);

  app.decorateRequest('requireUser', function (this: any) {
    if (!this.userId) throw new AppError('UNAUTHORIZED', 'Authentication required');
    return this.userId;
  });
  app.decorateRequest('requireRegistered', function (this: any) {
    if (!this.userId || this.userKind !== 'REGISTERED') {
      throw new AppError('UNAUTHORIZED', 'Sign in to continue');
    }
    return this.userId;
  });
  app.decorateRequest('requireAdmin', function (this: any) {
    if (!this.userId) throw new AppError('UNAUTHORIZED', 'Authentication required');
    if (this.userRole !== 'ADMIN') throw new AppError('FORBIDDEN', 'Admin access required');
    return this.userId;
  });

  app.addHook('preHandler', async (req) => {
    try {
      const decoded = await req.jwtVerify().catch(() => null);
      if (decoded && typeof decoded === 'object' && 'sub' in decoded) {
        const d = decoded as { sub: string; kind?: string; role?: string };
        req.userId = d.sub;
        req.userKind = (d.kind as 'ANON' | 'REGISTERED' | undefined) ?? 'ANON';
        req.userRole = (d.role as 'USER' | 'ADMIN' | undefined) ?? 'USER';
      }
    } catch {
      /* anonymous */
    }
  });
});
