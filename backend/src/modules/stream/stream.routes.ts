import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildContentDisposition, buildDownloadFilename } from '../../lib/filename.js';
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

const STREAM_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers':
    'Content-Range, Accept-Ranges, Content-Length, Content-Type, ETag, Last-Modified',
};

function applyStreamCors(reply: { header: (k: string, v: string) => unknown }): void {
  for (const [k, v] of Object.entries(STREAM_CORS_HEADERS)) reply.header(k, v);
}

function requireSig(req: { query: unknown }, variantId: string, resource: string): { userId: string | null } {
  const q = SignedQuery.safeParse(req.query);
  if (!q.success) throw new AppError('FORBIDDEN', 'Missing signature');
  return verify({ variantId, resource, query: q.data });
}

const streamRoutes: FastifyPluginAsync = async (app) => {
  // Preflight handler for HLS players that send OPTIONS for ranged segment fetches.
  app.options('/:variantId/*', async (_req, reply) => {
    applyStreamCors(reply);
    reply.status(204).send();
  });

  // ── HLS playlist ───────────────────────────────────────────────────────────
  app.get('/:variantId/playlist.m3u8', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'playlist.m3u8');
    applyStreamCors(reply);

    const variant = await loadVariant(variantId);

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      const key = `${variant.storageKey}/playlist.m3u8`;
      await serveStored(req, reply, permanentStorage(), key, {
        contentType: 'application/vnd.apple.mpegurl',
        cacheControl: 'private, no-store',
      });
      return;
    }

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
    applyStreamCors(reply);

    const variant = await loadVariant(variantId);

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      const key = `${variant.storageKey}/seg-${index}.ts`;
      await serveStored(req, reply, permanentStorage(), key, {
        cacheControl: 'public, max-age=31536000, immutable',
      });
      return;
    }

    const cacheKey = `${variantId}/seg-${index}.ts`;
    const cached = await cacheStorage().exists(cacheKey);
    if (cached) {
      await serveStored(req, reply, cacheStorage(), cacheKey, {
        cacheControl: 'public, max-age=86400, immutable',
      });
      return;
    }

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
        await buildRewrittenPlaylist(variantId, refreshed, req.userId ?? null);
        return lookupSegmentUpstream(variantId, index);
      },
    });
  });

  // ── Direct file (MP4 etc) ──────────────────────────────────────────────────
  app.get('/:variantId/file', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'file');
    applyStreamCors(reply);

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

  // ── Download (Content-Disposition with RFC5987 filename) ──────────────────
  app.get('/:variantId/download', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'download');
    applyStreamCors(reply);

    const variant = await loadVariant(variantId);
    const filename = buildDownloadFilename({
      baseName: variant.media.name || 'media',
      quality: variant.quality,
      container: variant.container,
    });
    const contentDisposition = buildContentDisposition('attachment', filename);
    reply.header('Content-Disposition', contentDisposition);

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      await serveStored(req, reply, permanentStorage(), `${variant.storageKey}/file.bin`, {
        cacheControl: 'private, no-store',
      });
      return;
    }

    const cacheKey = `${variantId}/file.bin`;
    if (await cacheStorage().exists(cacheKey)) {
      await serveStored(req, reply, cacheStorage(), cacheKey, {
        cacheControl: 'private, no-store',
      });
      return;
    }

    const url = variant.upstreamFileUrl;
    if (!url) throw new AppError('NOT_FOUND', 'Download not available');

    await proxyStream(req, reply, {
      upstreamUrl: url,
      defaultContentType: 'application/octet-stream',
      refreshOnce: () => refreshVariantUpstream(variantId),
    });
  });
};

export default streamRoutes;
