import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../plugins/auth.plugin.js';
import {
  ensureAnonUser,
  forgotPassword,
  login,
  logout,
  presentUser,
  refresh as refreshSession,
  resendVerification,
  resetPassword,
  signup,
  verifyEmail,
  type AccessTokenPayload,
  type AccessTokenSigner,
} from './auth.service.js';

const SignupBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(80).optional(),
});

const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

const TokenBody = z.object({ token: z.string().min(8).max(512) });
const ResetBody = z.object({
  token: z.string().min(8).max(512),
  password: z.string().min(8).max(256),
});
const EmailBody = z.object({ email: z.string().email().max(254) });

function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string, refreshExpiresAt: Date): void {
  const cookieDomain = env.COOKIE_DOMAIN || undefined;
  const baseOpts = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    domain: cookieDomain,
  };
  reply.setCookie(ACCESS_COOKIE, accessToken, {
    ...baseOpts,
    path: '/',
    maxAge: env.JWT_ACCESS_TTL_SEC,
  });
  const ttlMs = refreshExpiresAt.getTime() - Date.now();
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    ...baseOpts,
    path: REFRESH_COOKIE_PATH,
    expires: refreshExpiresAt,
    maxAge: Math.max(1, Math.floor(ttlMs / 1000)),
  });
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // ── Anonymous device session (back-compat with v1) ───────────────────────
  app.post(
    '/anon',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const user = await ensureAnonUser(req.userId);
      // Anonymous users have no refresh token; give the access cookie a long
      // TTL so the device-bound session survives without re-issuance.
      const ttl = env.JWT_REFRESH_TTL_SEC;
      const token = await reply.jwtSign(
        { sub: user.id, kind: user.kind, role: user.role },
        { expiresIn: ttl },
      );
      reply.setCookie(ACCESS_COOKIE, token, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: ttl,
        domain: env.COOKIE_DOMAIN || undefined,
      });
      return { user: presentUser(user) };
    },
  );

  // ── Signup ───────────────────────────────────────────────────────────────
  app.post(
    '/signup',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = SignupBody.parse(req.body);
      const result = await signup(body);
      reply.status(201);
      return {
        user: result.user,
        message: 'Check your email to verify your account.',
      };
    },
  );

  app.post(
    '/resend-verification',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = EmailBody.parse(req.body);
      await resendVerification(body.email);
      reply.status(204).send();
    },
  );

  app.post(
    '/verify-email',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req) => {
      const { token } = TokenBody.parse(req.body);
      const result = await verifyEmail(token);
      return { user: result.user, message: 'Email verified.' };
    },
  );

  // ── Login / refresh / logout ─────────────────────────────────────────────
  app.post(
    '/login',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = LoginBody.parse(req.body);
      // Type-annotated lambda forces TS to pick the correct jwtSign overload
      // (the Promise<string> one, not the void-returning callback one).
      const signAccess: AccessTokenSigner = (payload: AccessTokenPayload, opts) =>
        reply.jwtSign(payload, opts);
      const tokens = await login(
        body,
        signAccess,
        {
          ip: req.ip,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      );
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt);
      return { user: tokens.user };
    },
  );

  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const presented = req.cookies[REFRESH_COOKIE];
      if (!presented) throw new AppError('UNAUTHORIZED', 'No session');
      const signAccess: AccessTokenSigner = (payload: AccessTokenPayload, opts) =>
        reply.jwtSign(payload, opts);
      const tokens = await refreshSession(
        presented,
        signAccess,
        {
          ip: req.ip,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      );
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt);
      return { user: tokens.user };
    },
  );

  app.post('/logout', async (req, reply) => {
    const presented = req.cookies[REFRESH_COOKIE];
    await logout(presented);
    clearAuthCookies(reply);
    reply.status(204).send();
  });

  // ── Password reset ───────────────────────────────────────────────────────
  app.post(
    '/forgot-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = EmailBody.parse(req.body);
      await forgotPassword(body.email);
      reply.status(204).send();
    },
  );

  app.post(
    '/reset-password',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = ResetBody.parse(req.body);
      await resetPassword(body.token, body.password);
      reply.status(204).send();
    },
  );

  // ── Current user ─────────────────────────────────────────────────────────
  app.get('/me', async (req) => {
    if (!req.userId) return { user: null };
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    return { user: user ? presentUser(user) : null };
  });
};

export default authRoutes;
