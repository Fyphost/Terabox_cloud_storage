import { prisma } from '../../config/prisma.js';
import { getRedis } from '../../config/redis.js';
import { AppError } from '../../lib/errors.js';
import { upstreamRequest } from '../../lib/http.js';
import {
  rewriteMediaPlaylist,
  type RewriteMediaResult,
} from './hls.rewriter.js';
import { buildRelativeStreamUrl } from '../../services/signing/signed-url.js';

const SEGMENT_INDEX_TTL_SEC = 6 * 3600;

function segIndexKey(variantId: string): string {
  return `seg:idx:${variantId}`;
}

export async function loadVariant(variantId: string) {
  const v = await prisma.mediaVariant.findUnique({
    where: { id: variantId },
    include: { media: true },
  });
  if (!v) throw new AppError('NOT_FOUND', 'Variant not found');
  return v;
}

/**
 * Fetch upstream m3u8, rewrite all segment URIs to point at our /segment/:n,
 * persist the segment-index map to Redis, and return the rewritten body.
 *
 * URLs in the rewritten body are RELATIVE so the player loads them on the
 * same origin it fetched the master playlist from.
 */
export async function buildRewrittenPlaylist(
  variantId: string,
  upstreamUrl: string,
  userId: string | null,
): Promise<{ body: string; segments: number }> {
  const resp = await upstreamRequest(upstreamUrl, { method: 'GET', maxRedirections: 5 });
  if (resp.statusCode >= 400) {
    resp.body.resume();
    throw new AppError(
      resp.statusCode === 403 || resp.statusCode === 404 ? 'UPSTREAM_EXPIRED' : 'UPSTREAM_ERROR',
      `Upstream playlist returned ${resp.statusCode}`,
    );
  }
  const text = await resp.body.text();

  const rewritten: RewriteMediaResult = rewriteMediaPlaylist(
    text,
    upstreamUrl,
    (seg) => buildRelativeStreamUrl(variantId, `segment/${seg.index}`, userId),
    (kind, _originalUri, index) =>
      buildRelativeStreamUrl(variantId, `${kind}/${index}`, userId),
  );

  if (rewritten.segments.length > 0) {
    const redis = getRedis();
    const key = segIndexKey(variantId);
    const pipeline = redis.multi();
    pipeline.del(key);
    pipeline.rpush(key, ...rewritten.segments.map((s) => s.originalUri));
    pipeline.expire(key, SEGMENT_INDEX_TTL_SEC);
    await pipeline.exec();
  }

  return { body: rewritten.body, segments: rewritten.segments.length };
}

export async function lookupSegmentUpstream(
  variantId: string,
  index: number,
): Promise<string | null> {
  const redis = getRedis();
  const url = await redis.lindex(segIndexKey(variantId), index);
  return url ?? null;
}
