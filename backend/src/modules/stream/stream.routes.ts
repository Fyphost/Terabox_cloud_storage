/**
 * modules/stream/stream.routes.ts
 *
 * Why this file changed (architectural delta vs. previous version)
 * ─────────────────────────────────────────────────────────────────────────────
 * Previously `/download` resolved to `<variant.storageKey>/file.bin`. For HLS
 * variants that file never existed, so the route returned 404 (and the
 * browser fell back to the URL's last segment, "download") — or, in the
 * other failure mode, served `playlist.m3u8` because some prior commit had
 * placed the m3u8 at the same prefix. Both modes broke downloads.
 *
 * In the new model the download artifact is owned by the *Media*, not by
 * any variant. `/download` always resolves to `Media.sourceStorageKey`
 * (i.e. `media/<mediaId>/source.mp4`). The variantId in the URL is only
 * used as the signing subject so existing signed URLs in the wild keep
 * working without contract changes.
 *
 * Likewise, `/playlist.m3u8` and `/segment/:n` for PERSISTED variants
 * resolve from `MediaVariant.storageKey` (which the worker now writes as
 * `media/<mediaId>/hls/<quality>`). The path layout is canonical and
 * checked at write-time by the central key builders in services/storage/keys.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { attachmentContentDisposition } from '../../lib/content-disposition.js';
import { verify } from '../../services/signing/signed-url.js';
import {
  cacheStorage,
  permanentStorage,
  cacheVariantFileKey,
  cacheVariantSegmentKey,
  ensureFilenameExtension,
  variantPlaylistKey,
  variantSegmentKey,
} from '../../services/storage/index.js';
import { proxyStream, serveStored } from './stream.proxy.js';
import {
  buildRewrittenPlaylist,
  loadVariant,
  lookupSegmentUpstream,
} from './stream.service.js';
import { refreshVariantUpstream } from '../ingest/ingest.service.js';
import { fetchTeraboxMetadata } from '../ingest/terabox.client.js';

const VariantParam = z.object({ variantId: z.string().min(1) });
const SegmentParam = z.object({
  variantId: z.string().min(1),
  index: z.coerce.number().int().nonnegative(),
});
const SignedQuery = z.object({
  t: z.string(),
  exp: z.string(),
  u: z.string(),
  kv: z.string(),
});

function requireSig(
  req: { query: unknown },
  variantId: string,
  resource: string,
): { userId: string | null } {
  const q = SignedQuery.safeParse(req.query);
  if (!q.success) throw new AppError('FORBIDDEN', 'Missing signature');
  return verify({ variantId, resource, query: q.data });
}

function downloadFilenameFor(variant: { media: { name: string; originalFilename: string | null }; quality: string }, contentType: string | null): string {
  const base = variant.media.originalFilename || variant.media.name || 'media';
  return ensureFilenameExtension(base, contentType ?? 'video/mp4');
}

const streamRoutes: FastifyPluginAsync = async (app) => {
  // ── HLS playlist ────────────────────────────────────────────────────────
  app.get('/:variantId/playlist.m3u8', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'playlist.m3u8');

    const variant = await loadVariant(variantId);

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      const key = variantPlaylistKey(variant.storageKey);
      const exists = await permanentStorage().exists(key).catch(() => false);
      if (exists) {
        await serveStored(req, reply, permanentStorage(), key, {
          contentType: 'application/vnd.apple.mpegurl',
          cacheControl: 'private, no-store',
        });
        return;
      }
      // Bytes drifted off disk; fall through to upstream rewrite path.
      req.log.warn({ variantId, key }, 'persisted playlist missing on disk; falling back to upstream rewrite');
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

  // ── HLS segment ─────────────────────────────────────────────────────────
  app.get('/:variantId/segment/:index', async (req, reply) => {
    const { variantId, index } = SegmentParam.parse(req.params);
    requireSig(req, variantId, `segment/${index}`);

    const variant = await loadVariant(variantId);

    if (variant.state === 'PERSISTED' && variant.storageKey) {
      const key = variantSegmentKey(variant.storageKey, index);
      if (await permanentStorage().exists(key).catch(() => false)) {
        await serveStored(req, reply, permanentStorage(), key, {
          cacheControl: 'public, max-age=31536000, immutable',
        });
        return;
      }
      req.log.warn({ variantId, index, key }, 'persisted segment missing on disk; proxying');
    }

    const cacheKey = cacheVariantSegmentKey(variantId, index);
    if (await cacheStorage().exists(cacheKey).catch(() => false)) {
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

  // ── Direct file (range-aware MP4 playback) ──────────────────────────────
  // Same byte source as /download, but no Content-Disposition.
  app.get('/:variantId/file', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'file');
    await serveDownload(req, reply, variantId, { asAttachment: false });
  });

  // ── Download (canonical source.mp4 with Content-Disposition) ────────────
  app.get('/:variantId/download', async (req, reply) => {
    const { variantId } = VariantParam.parse(req.params);
    requireSig(req, variantId, 'download');
    await serveDownload(req, reply, variantId, { asAttachment: true });
  });

  // ── shared download/file handler ────────────────────────────────────────
  async function serveDownload(
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
    variantId: string,
    opts: { asAttachment: boolean },
  ): Promise<void> {
    const variant = await loadVariant(variantId);
    const media = variant.media;

    // Phase 1: serve from Media.sourceStorageKey if persisted.
    if (
      media.sourceStorageKey &&
      !media.sourcePendingDeleteAt &&
      (await permanentStorage().exists(media.sourceStorageKey).catch(() => false))
    ) {
      const filename = downloadFilenameFor(
        { media, quality: variant.quality },
        media.sourceContentType,
      );
      await serveStored(req, reply, permanentStorage(), media.sourceStorageKey, {
        contentType: media.sourceContentType ?? undefined,
        cacheControl: 'private, max-age=3600',
        downloadFilename: opts.asAttachment ? filename : undefined,
      });
      return;
    }

    // Phase 2: cache hit on the legacy per-variant file path (rare).
    const cacheKey = cacheVariantFileKey(variantId);
    if (await cacheStorage().exists(cacheKey).catch(() => false)) {
      const filename = downloadFilenameFor(
        { media, quality: variant.quality },
        media.sourceContentType,
      );
      await serveStored(req, reply, cacheStorage(), cacheKey, {
        cacheControl: 'private, max-age=3600',
        downloadFilename: opts.asAttachment ? filename : undefined,
      });
      return;
    }

    // Phase 3: proxy from upstream `download` URL (EPHEMERAL fallback).
    // We re-extract on every request here because the upstream `download`
    // URL is short-lived and we never persist it in the DB.
    const meta = await fetchTeraboxMetadata(media.sourceUrl).catch(() => null);
    const url = meta?.download ?? variant.upstreamFileUrl;
    if (!url) {
      throw new AppError(
        'NOT_FOUND',
        'No download available for this media. Save it first to generate a permanent download.',
      );
    }
    const ct = meta?.name ? inferContentTypeFromName(meta.name) : 'video/mp4';
    const filename = downloadFilenameFor({ media, quality: variant.quality }, ct);

    if (opts.asAttachment) {
      reply.header('Content-Disposition', attachmentContentDisposition(filename));
    }

    await proxyStream(req, reply, {
      upstreamUrl: url,
      defaultContentType: ct,
      responseCacheControl: 'private, no-store',
      refreshOnce: async () => {
        const fresh = await fetchTeraboxMetadata(media.sourceUrl).catch(() => null);
        return fresh?.download ?? null;
      },
    });
  }
};

function inferContentTypeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.mp4') || n.endsWith('.m4v')) return 'video/mp4';
  if (n.endsWith('.mkv')) return 'video/x-matroska';
  if (n.endsWith('.webm')) return 'video/webm';
  if (n.endsWith('.mov')) return 'video/quicktime';
  if (n.endsWith('.mp3')) return 'audio/mpeg';
  if (n.endsWith('.aac')) return 'audio/aac';
  return 'video/mp4';
}

export default streamRoutes;
