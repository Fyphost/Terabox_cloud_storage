import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { verify } from '../../services/signing/signed-url.js';
import { cacheStorage, permanentStorage } from '../../services/storage/index.js';
import { proxyStream, serveStored } from './stream.proxy.js';
import {
  buildRewrittenPlaylist,
  loadVariant,
  lookupSegmentUpstream,
} from './stream.service.js';
import { refreshVariantUpstream } from '../ingest/ingest.service.js';

const VariantParam = z.object({ variantId: z.string().min(1) });
const SegmentParam = z.object({ variantId: z.string().min(1), index: z.coerce.number().int().nonnegative() });
const SignedQuery = z.object({
  t: z.string(),
  exp: z.string(),
  u: z.string(),
  kv: z.string(),
});

function requireSig(req: { query: unknown }, variantId: string, resource: string): { userId: string | null } {
  const q = SignedQuery.safeParse(req.query);
  if (!q.success) throw new AppError('FORBIDDEN', 'Missing signature');
  return verify({ variantId, resource, query: q.data });
}

const streamRoutes: FastifyPluginAsync = async (app) => {
  // ── HLS playlist ───────────────────────────────────────────────────────────
  app.get('/:variantId/playlist.m3u8', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'playlist.m3u8');

    const variant = await loadVariant(variantId);

    // Persisted: serve the local rewritten playlist directly.
    if (variant.state === 'PERSISTED' && variant.storageKey) {
      const key = `${variant.storageKey}/playlist.m3u8`;
      reply
        .header('Content-Type', 'application/vnd.apple.mpegurl')
        .header('Cache-Control', 'private, no-store');
      await serveStored(req, reply, permanentStorage(), key, {
        contentType: 'application/vnd.apple.mpegurl',
        cacheControl: 'private, no-store',
      });
      return;
    }

    // Otherwise: fetch upstream, rewrite, cache index map.
    if (!variant.upstreamPlaylistUrl) {
      throw new AppError('NOT_FOUND', 'No playlist available');
    }

    let upstreamUrl = variant.upstreamPlaylistUrl;
    let body: string;
    try {
      ({ body } = await buildRewrittenPlaylist(variantId, upstreamUrl, req.userId ?? null));
    } catch (err) {
      if (err instanceof AppError && err.code === 'UPSTREAM_EXPIRED') {
        const refreshed = await refreshVariantUpstream(variantId);
        if (!refreshed) throw err;
        upstreamUrl = refreshed;
        ({ body } = await buildRewrittenPlaylist(variantId, upstreamUrl, req.userId ?? null));
      } else {
        throw err;
      }
    }

    reply
      .status(200)
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'private, no-store');
    return body;
  });

  // ── HLS segment ────────────────────────────────────────────────────────────
  app.get('/:variantId/segment/:index', async (req, reply) => {
    const { variantId, index } = SegmentParam.parse(req.params);
    requireSig(req, variantId, `segment/${index}`);

    const variant = await loadVariant(variantId);

    // Persisted on disk?
    if (variant.state === 'PERSISTED' && variant.storageKey) {
      const key = `${variant.storageKey}/seg-${index}.ts`;
      await serveStored(req, reply, permanentStorage(), key, {
        cacheControl: 'public, max-age=31536000, immutable',
      });
      return;
    }

    // Cache hit on NVMe?
    const cacheKey = `${variantId}/seg-${index}.ts`;
    const cached = await cacheStorage().exists(cacheKey);
    if (cached) {
      await serveStored(req, reply, cacheStorage(), cacheKey, {
        cacheControl: 'public, max-age=86400, immutable',
      });
      return;
    }

    // Otherwise proxy from upstream and tee into cache.
    const upstream = await lookupSegmentUpstream(variantId, index);
    if (!upstream) {
      throw new AppError('NOT_FOUND', 'Segment index unknown — reload playlist');
    }

    await proxyStream(req, reply, {
      upstreamUrl: upstream,
      cache: { backend: cacheStorage(), key: cacheKey },
      defaultContentType: 'video/mp2t',
      responseCacheControl: 'public, max-age=86400, immutable',
      refreshOnce: async () => {
        const refreshed = await refreshVariantUpstream(variantId);
        if (!refreshed) return null;
        // Re-prime the segment index (the new playlist may have different URLs).
        await buildRewrittenPlaylist(variantId, refreshed, req.userId ?? null);
        return lookupSegmentUpstream(variantId, index);
      },
    });
  });

  // ── Direct file (MP4 etc) ──────────────────────────────────────────────────
  app.get('/:variantId/file', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'file');

    const variant = await loadVariant(variantId);

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      await serveStored(req, reply, permanentStorage(), `${variant.storageKey}/file.bin`, {
        cacheControl: 'public, max-age=3600',
      });
      return;
    }

    const cacheKey = `${variantId}/file.bin`;
    if (await cacheStorage().exists(cacheKey)) {
      await serveStored(req, reply, cacheStorage(), cacheKey, {
        cacheControl: 'public, max-age=86400',
      });
      return;
    }

    const url = variant.upstreamFileUrl;
    if (!url) throw new AppError('NOT_FOUND', 'No direct file URL for this variant');

    await proxyStream(req, reply, {
      upstreamUrl: url,
      cache: { backend: cacheStorage(), key: cacheKey },
      responseCacheControl: 'private, max-age=60',
      refreshOnce: () => refreshVariantUpstream(variantId),
    });
  });

  // ── Download (Content-Disposition) ────────────────────────────────────────
  app.get('/:variantId/download', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'download');

    const variant = await loadVariant(variantId);
    const filename = `${variant.media.name || 'media'}-${variant.quality}.mp4`;

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      await serveStored(req, reply, permanentStorage(), `${variant.storageKey}/file.bin`, {
        downloadFilename: filename,
        cacheControl: 'private, no-store',
      });
      return;
    }

    const cacheKey = `${variantId}/file.bin`;
    if (await cacheStorage().exists(cacheKey)) {
      await serveStored(req, reply, cacheStorage(), cacheKey, {
        downloadFilename: filename,
        cacheControl: 'private, no-store',
      });
      return;
    }

    const url = variant.upstreamFileUrl;
    if (!url) throw new AppError('NOT_FOUND', 'Download not available');

    reply.header(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/[\r\n"\\]/g, '_')}"`,
    );
    await proxyStream(req, reply, {
      upstreamUrl: url,
      defaultContentType: 'application/octet-stream',
      refreshOnce: () => refreshVariantUpstream(variantId),
    });
  });
};

export default streamRoutes;
