import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * Two URL families, both HMAC-signed:
 *
 *   variant scope ("V") — for live/cached upstream-backed streaming:
 *      payload = `${kv}|V|${variantId}|${resource}|${exp}|${u}`
 *      route   = /api/v1/stream/{variantId}/{resource}
 *
 *   library scope ("L") — for saved-media local-only playback/download:
 *      payload = `${kv}|L|${savedMediaId}|${resource}|${exp}|${u}`
 *      route   = /api/v1/library/{savedMediaId}/{resource}
 *
 * Verification is constant-time, no DB lookup.
 */

export interface SignedQuery {
  t: string;
  exp: string;
  u: string;
  kv: string;
}

type Scope = 'V' | 'L';

function payload(scope: Scope, kv: string, id: string, resource: string, exp: number, u: string): string {
  return `${kv}|${scope}|${id}|${resource}|${exp}|${u}`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function makeSig(scope: Scope, id: string, resource: string, userId: string | null, ttlSec?: number): SignedQuery {
  const ttl = ttlSec ?? env.SIGNED_URL_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const u = userId ?? 'anon';
  const kv = env.SIGNING_KEY_VERSION;
  const mac = createHmac('sha256', env.SIGNING_SECRET)
    .update(payload(scope, kv, id, resource, exp, u))
    .digest();
  return { t: b64url(mac), exp: String(exp), u, kv };
}

export function buildSignedPath(basePath: string, q: SignedQuery): string {
  const usp = new URLSearchParams(q as unknown as Record<string, string>);
  return `${basePath}?${usp.toString()}`;
}

// ─── Variant scope (live/cached) ─────────────────────────────────────────────

export interface SignParams {
  variantId: string;
  resource: string;
  userId?: string | null;
  ttlSec?: number;
}

export function sign(params: SignParams): SignedQuery {
  return makeSig('V', params.variantId, params.resource, params.userId ?? null, params.ttlSec);
}

export function buildRelativeStreamUrl(
  variantId: string,
  resource: string,
  userId: string | null,
  ttlSec?: number,
): string {
  const q = sign({ variantId, resource, userId, ttlSec });
  return buildSignedPath(`/api/v1/stream/${variantId}/${resource}`, q);
}

export interface VerifyParams {
  variantId: string;
  resource: string;
  query: { t?: string; exp?: string; u?: string; kv?: string };
}

export function verify(params: VerifyParams): { userId: string | null } {
  return verifyAny('V', params.variantId, params.resource, params.query);
}

// ─── Library scope (saved-only) ──────────────────────────────────────────────

export function signLibrary(savedMediaId: string, resource: string, userId: string | null, ttlSec?: number): SignedQuery {
  return makeSig('L', savedMediaId, resource, userId, ttlSec);
}

export function buildLibrarySignedUrl(
  savedMediaId: string,
  resource: string,
  userId: string | null = null,
  ttlSec?: number,
): string {
  const q = signLibrary(savedMediaId, resource, userId, ttlSec);
  return buildSignedPath(`/api/v1/library/${savedMediaId}/${resource}`, q);
}

export function verifyLibrary(
  savedMediaId: string,
  resource: string,
  query: { t?: string; exp?: string; u?: string; kv?: string },
): { userId: string | null } {
  return verifyAny('L', savedMediaId, resource, query);
}

// ─── Shared verification ─────────────────────────────────────────────────────

function verifyAny(
  scope: Scope,
  id: string,
  resource: string,
  query: { t?: string; exp?: string; u?: string; kv?: string },
): { userId: string | null } {
  const { t, exp, u, kv } = query;
  if (!t || !exp || !u || !kv) {
    throw new AppError('FORBIDDEN', 'Missing signature');
  }
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN < Math.floor(Date.now() / 1000)) {
    throw new AppError('FORBIDDEN', 'Signature expired');
  }
  if (kv !== env.SIGNING_KEY_VERSION) {
    throw new AppError('FORBIDDEN', 'Stale key version');
  }

  const expected = createHmac('sha256', env.SIGNING_SECRET)
    .update(payload(scope, kv, id, resource, expN, u))
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(t, 'base64url');
  } catch {
    throw new AppError('FORBIDDEN', 'Bad signature');
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AppError('FORBIDDEN', 'Bad signature');
  }
  return { userId: u === 'anon' ? null : u };
}
