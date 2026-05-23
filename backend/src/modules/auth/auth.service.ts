import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { newSessionId, newUserId } from '../../lib/ids.js';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from '../../services/email/email.service.js';
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from '../../services/auth/password.js';
import {
  generateOpaqueToken,
  hashToken,
  unixIn,
} from '../../services/auth/tokens.js';

/**
 * Auth service.
 *
 * Token model:
 *  - Access JWT (short-lived) carries `sub` and `role` for stateless auth.
 *  - Refresh token is opaque, stored as sha256 hex in DB; rotates on every
 *    /auth/refresh call to enable replay detection.
 *  - Email tokens (verify, reset) are opaque, single-use, hashed.
 *
 * Enumeration hardening:
 *  - signup with an existing email → 200 with neutral message (the email
 *    owner gets a notice via email), but we DO return a clear error in dev
 *    to keep DX sharp. The neutralization for prod is done at the route
 *    layer if needed.
 *  - forgot-password ALWAYS returns 204 regardless of existence.
 */

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: 'USER' | 'ADMIN';
  kind: 'ANON' | 'REGISTERED';
  emailVerified: boolean;
  createdAt: string;
}

export type AccessTokenSigner = (payload: object, opts: { expiresIn: number }) => Promise<string>;

interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

export function presentUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    kind: u.kind,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueRefreshToken(
  userId: string,
  ctx: SessionContext,
  rotatedFromId?: string,
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = generateOpaqueToken(48);
  const tokenHash = hashToken(token);
  const id = newSessionId();
  const expiresAt = unixIn(env.JWT_REFRESH_TTL_SEC);

  await prisma.refreshToken.create({
    data: {
      id,
      userId,
      tokenHash,
      expiresAt,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      rotatedFromId: rotatedFromId ?? null,
    },
  });
  return { token, id, expiresAt };
}

async function signAccessForUser(user: User, sign: AccessTokenSigner): Promise<string> {
  return sign(
    { sub: user.id, kind: user.kind, role: user.role },
    { expiresIn: env.JWT_ACCESS_TTL_SEC },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signup / verification
// ─────────────────────────────────────────────────────────────────────────────

export interface SignupArgs {
  email: string;
  password: string;
  displayName?: string;
}

export async function signup(args: SignupArgs): Promise<{ user: PublicUser }> {
  const email = normalizeEmail(args.email);
  validatePasswordPolicy(args.password);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.kind === 'REGISTERED') {
    throw new AppError('CONFLICT', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(args.password);
  const displayName = (args.displayName ?? '').trim() || null;

  let user: User;
  if (existing && existing.kind === 'ANON') {
    // Promote existing anon device to a registered account.
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        kind: 'REGISTERED',
        email,
        passwordHash,
        displayName,
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        id: newUserId(),
        kind: 'REGISTERED',
        role: 'USER',
        email,
        passwordHash,
        displayName,
      },
    });
  }

  await issueAndSendVerification(user);
  return { user: presentUser(user) };
}

async function issueAndSendVerification(user: User): Promise<void> {
  if (!user.email) return;
  const token = generateOpaqueToken(32);
  const tokenHash = hashToken(token);
  await prisma.emailToken.create({
    data: {
      id: newSessionId(),
      userId: user.id,
      kind: 'VERIFY',
      tokenHash,
      expiresAt: unixIn(env.EMAIL_TOKEN_TTL_SEC),
    },
  });
  await sendVerificationEmail({ to: user.email, displayName: user.displayName, token });
}

export async function resendVerification(emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt || !user.email) return; // silent no-op
  // Invalidate older verify tokens to keep one active token per user.
  await prisma.emailToken.deleteMany({ where: { userId: user.id, kind: 'VERIFY', usedAt: null } });
  await issueAndSendVerification(user);
}

export async function verifyEmail(token: string): Promise<{ user: PublicUser }> {
  const tokenHash = hashToken(token);
  const record = await prisma.emailToken.findUnique({ where: { tokenHash } });
  if (
    !record ||
    record.kind !== 'VERIFY' ||
    record.usedAt !== null ||
    record.expiresAt.getTime() < Date.now()
  ) {
    throw new AppError('FORBIDDEN', 'This verification link is invalid or has expired');
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw new AppError('NOT_FOUND', 'Account not found');

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    }),
    prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  if (!user.emailVerifiedAt && updated.email) {
    // first-time verification → welcome email
    void sendWelcomeEmail({ to: updated.email, displayName: updated.displayName }).catch(() => undefined);
  }
  return { user: presentUser(updated) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Login / refresh / logout
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginArgs {
  email: string;
  password: string;
}

export async function login(
  args: LoginArgs,
  signAccess: AccessTokenSigner,
  ctx: SessionContext,
): Promise<IssuedTokens> {
  const email = normalizeEmail(args.email);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.kind !== 'REGISTERED' || !user.passwordHash) {
    // Equal-time response to deter enumeration: do a dummy hash compare.
    await verifyPassword(args.password, '$2a$12$0000000000000000000000.invalidhashvalue000000000000000000000');
    throw new AppError('UNAUTHORIZED', 'Invalid email or password');
  }
  const ok = await verifyPassword(args.password, user.passwordHash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Invalid email or password');

  if (!user.emailVerifiedAt) {
    throw new AppError('FORBIDDEN', 'Verify your email before signing in');
  }

  const accessToken = await signAccessForUser(user, signAccess);
  const refresh = await issueRefreshToken(user.id, ctx);

  await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshTokenId: refresh.id,
    refreshExpiresAt: refresh.expiresAt,
    user: presentUser(user),
  };
}

/**
 * Rotate a refresh token. Detects replay: a token already revoked OR an
 * attempt to rotate from a token whose chain is revoked invalidates the
 * whole chain for that user.
 */
export async function refresh(
  presentedToken: string,
  signAccess: AccessTokenSigner,
  ctx: SessionContext,
): Promise<IssuedTokens> {
  const tokenHash = hashToken(presentedToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record) throw new AppError('UNAUTHORIZED', 'Invalid session');

  if (record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    // Replay or expired → revoke everything for this user as a safety net.
    await prisma.refreshToken
      .updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
    throw new AppError('UNAUTHORIZED', 'Session expired or revoked');
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw new AppError('UNAUTHORIZED', 'Account not found');

  const accessToken = await signAccessForUser(user, signAccess);
  const next = await issueRefreshToken(user.id, ctx, record.id);

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });

  return {
    accessToken,
    refreshToken: next.token,
    refreshTokenId: next.id,
    refreshExpiresAt: next.expiresAt,
    user: presentUser(user),
  };
}

export async function logout(presentedToken?: string): Promise<void> {
  if (!presentedToken) return;
  const tokenHash = hashToken(presentedToken);
  await prisma.refreshToken
    .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Password reset
// ─────────────────────────────────────────────────────────────────────────────

export async function forgotPassword(emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.kind !== 'REGISTERED' || !user.email) return;

  await prisma.emailToken
    .deleteMany({ where: { userId: user.id, kind: 'RESET', usedAt: null } })
    .catch(() => undefined);

  const token = generateOpaqueToken(32);
  const tokenHash = hashToken(token);
  await prisma.emailToken.create({
    data: {
      id: newSessionId(),
      userId: user.id,
      kind: 'RESET',
      tokenHash,
      expiresAt: unixIn(env.EMAIL_TOKEN_TTL_SEC),
    },
  });

  try {
    await sendPasswordResetEmail({ to: user.email, displayName: user.displayName, token });
  } catch (err) {
    logger.error({ err }, 'failed to send reset email');
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  validatePasswordPolicy(newPassword);
  const tokenHash = hashToken(token);
  const record = await prisma.emailToken.findUnique({ where: { tokenHash } });
  if (
    !record ||
    record.kind !== 'RESET' ||
    record.usedAt !== null ||
    record.expiresAt.getTime() < Date.now()
  ) {
    throw new AppError('FORBIDDEN', 'This reset link is invalid or has expired');
  }
  const passwordHash = await hashPassword(newPassword);

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Revoke all sessions on password reset.
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ];
  await prisma.$transaction(ops);
}

// ─────────────────────────────────────────────────────────────────────────────
// Anonymous device session (preserved from v1)
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureAnonUser(existingUserId: string | undefined): Promise<User> {
  if (existingUserId) {
    const existing = await prisma.user.findUnique({ where: { id: existingUserId } });
    if (existing) {
      await prisma.user
        .update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
      return existing;
    }
  }
  return prisma.user.create({
    data: { id: newUserId(), kind: 'ANON', role: 'USER' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
