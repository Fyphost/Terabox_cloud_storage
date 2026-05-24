/**
 * Auth plugin — JWT + Cookie lifecycle.
 *
 * Root cause of FST_ERR_DEC_ALREADY_PRESENT:
 *   @fastify/cookie adds a `serializeCookie` decorator to the Fastify instance.
 *   If ANY other plugin (cors, rate-limit, etc.) also registers @fastify/cookie,
 *   the second registration throws FST_ERR_DEC_ALREADY_PRESENT.
 *
 * Fix:
 *   1. Guard @fastify/cookie registration with `app.hasDecorator('serializeCookie')`.
 *   2. Use fastify-plugin (fp) so decorators propagate to the root scope.
 *   3. This plugin is the ONLY place that registers @fastify/cookie and @fastify/jwt.
 */

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
  // Guard: only register @fastify/cookie if not already present.
  // This prevents FST_ERR_DEC_ALREADY_PRESENT when plugins are loaded in
  // different orders or when testing with app.inject().
  if (!app.hasDecorator('serializeCookie')) {
    await app.register(cookie, {});
  }

  // Guard: only register @fastify/jwt once.
  if (!app.hasDecorator('jwt')) {
    await app.register(jwt, {
      secret: env.JWT_SECRET,
      cookie: { cookieName: ACCESS_COOKIE, signed: false },
    });
  }

  // Decorator guards: prevent double-registration in test harnesses.
  if (!app.hasRequestDecorator('userId')) {
    app.decorateRequest('userId', undefined);
  }
  if (!app.hasRequestDecorator('userRole')) {
    app.decorateRequest('userRole', undefined);
  }
  if (!app.hasRequestDecorator('userKind')) {
    app.decorateRequest('userKind', undefined);
  }

  if (!app.hasRequestDecorator('requireUser')) {
    app.decorateRequest('requireUser', function (this: any) {
      if (!this.userId) throw new AppError('UNAUTHORIZED', 'Authentication required');
      return this.userId;
    });
  }
  if (!app.hasRequestDecorator('requireRegistered')) {
    app.decorateRequest('requireRegistered', function (this: any) {
      if (!this.userId || this.userKind !== 'REGISTERED') {
        throw new AppError('UNAUTHORIZED', 'Sign in to continue');
      }
      return this.userId;
    });
  }
  if (!app.hasRequestDecorator('requireAdmin')) {
    app.decorateRequest('requireAdmin', function (this: any) {
      if (!this.userId) throw new AppError('UNAUTHORIZED', 'Authentication required');
      if (this.userRole !== 'ADMIN') throw new AppError('FORBIDDEN', 'Admin access required');
      return this.userId;
    });
  }

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
      /* anonymous — no token or invalid token */
    }
  });
});
