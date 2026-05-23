import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * Signed URL parameters:
 *   t   = base64url(HMAC_SHA256(secret, `${kv}|${variantId}|${resource}|${exp}|${u}`))
 *   exp = unix seconds
 *   u   = userId or "anon"
 *   kv  = key version (allows secret rotation)
 *
 * HMAC verification only — no DB lookup on the hot path.
 */

export interface SignParams {
  variantId: string;
  resource: string;       // e.g. "playlist.m3u8" | "segment/12" | "file" | "download"
  userId?: string | null;
  ttlSec?: number;
}

export interface SignedQuery {
  t: string;
  exp: string;
  u: string;
  kv: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function payload(kv: string, variantId: string, resource: string, exp: number, u: string): string {
  return `${kv}|${variantId}|${resource}|${exp}|${u}`;
}

export function sign(params: SignParams): SignedQuery {
  const ttl = params.ttlSec ?? env.SIGNED_URL_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const u = params.userId ?? 'anon';
  const kv = env.SIGNING_KEY_VERSION;

  const mac = createHmac('sha256', env.SIGNING_SECRET)
    .update(payload(kv, params.variantId, params.resource, exp, u))
    .digest();

  return { t: b64url(mac), exp: String(exp), u, kv };
}

export function buildSignedPath(basePath: string, q: SignedQuery): string {
  const usp = new URLSearchParams(q as unknown as Record<string, string>);
  return `${basePath}?${usp.toString()}`;
}

/**
 * Build a relative signed stream URL. Always emit relative paths so the
 * browser uses the same origin it loaded the page from — this avoids CORS
 * and lets a Next rewrite proxy forward to the API in dev.
 */
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
  const { t, exp, u, kv } = params.query;
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
    .update(payload(kv, params.variantId, params.resource, expN, u))
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
