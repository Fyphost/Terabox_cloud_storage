import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque token utilities.
 *
 * - `generateOpaqueToken()` returns a URL-safe random string the client gets.
 * - `hashToken(token)` returns the value we persist (sha256 hex).
 * - `safeEqualHash(a, b)` is constant-time comparison of two hex digests.
 */

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqualHash(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function unixIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
