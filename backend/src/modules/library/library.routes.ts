/**
 * Library routes.
 *
 * Two surfaces:
 *
 *   JSON (auth required):
 *     GET  /api/v1/library                       list
 *     GET  /api/v1/library/:savedMediaId         detail (includes signed asset URLs)
 *     DELETE /api/v1/library/:savedMediaId       remove from library
 *     POST /api/v1/library/bulk-delete           bulk remove
 *
 *   Signed media (no cookie required — signed URL IS the auth):
 *     GET /api/v1/library/:savedMediaId/master.m3u8
 *     GET /api/v1/library/:savedMediaId/variant/:variantId/playlist.m3u8
 *     GET /api/v1/library/:savedMediaId/variant/:variantId/segment/:n
 *     GET /api/v1/library/:savedMediaId/variant/:variantId/download
 *     GET /api/v1/library/:savedMediaId/thumb.jpg
 *
 * The signed routes ONLY ever serve from permanent storage. They never call
 * upstream and they never read from the cache backend.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { buildContentDisposition, buildDownloadFilename } from '../../lib/filename.js';
import { verifyLibrary } from '../../services/signing/signed-url.js';
import { permanentStorage } from '../../services/storage/index.js';
import { joinKey, assertVariantPlayable } from '../../services/storage/verify.js';
import { serveStored } from '../stream/stream.proxy.js';
import {
  bulkDeleteSavedMedia,
  deleteSavedMedia,
  getSavedMediaDetail,
  listSavedMedia,
} from './library.service.js';

const ListQuery = z.object({
  search: z.string().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(50).optional(),
  sort: z.enum(['recent', 'oldest', 'name', 'size']).optional(),
});
const Param = z.object({ savedMediaId: z.string().min(1) });
const VariantParam = z.object({
  savedMediaId: z.string().min(1),
  variantId: z.string().min(1),
});
const SegmentParam = z.object({
  savedMediaId: z.string().min(1),
  variantId: z.string().min(1),
  index: z.coerce.number().int().nonnegative(),
});
const SignedQuery = z.object({
  t: z.string(),
  exp: z.string(),
  u: z.string(),
  kv: z.string(),
});
const BulkDeleteBody = z.object({
  savedMediaIds: z.array(z.string().min(1)).min(1).max(100),
});

const STREAM_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers':
    'Content-Range, Accept-Ranges, Content-Length, Content-Type, Content-Disposition',
};
function applyStreamCors(reply: { header: (k: string, v: string) => unknown }): void {
  for (const [k, v] of Object.entries(STREAM_CORS_HEADERS)) reply.header(k, v);
}

function requireSig(req: FastifyRequest, savedMediaId: string, resource: string): void {
  const q = SignedQuery.safeParse(req.query);
  if (!q.success) throw new AppError('FORBIDDEN', 'Missing signature');
  verifyLibrary(savedMediaId, resource, q.data);
}

const libraryRoutes: FastifyPluginAsync = async (app) => {
  // Preflight on all signed routes.
  app.options('/:savedMediaId/*', async (_req, reply) => {
    applyStreamCors(reply);
    reply.status(204).send();
  });

  // ── JSON: list / detail / delete ───────────────────────────────────────────
  app.get('/', async (req) => {
    const userId = req.requireRegistered();
    const q = ListQuery.parse(req.query);
    return listSavedMedia(userId, q);
  });

  app.get('/:savedMediaId', async (req) => {
    const userId = req.requireRegistered();
    const { savedMediaId } = Param.parse(req.params);
    return getSavedMediaDetail(savedMediaId, userId);
  });

  app.delete('/:savedMediaId', async (req, reply) => {
    const userId = req.requireRegistered();
    const { savedMediaId } = Param.parse(req.params);
    await deleteSavedMedia(savedMediaId, userId);
    reply.status(204).send();
  });

  app.post('/bulk-delete', async (req, reply) => {
    const userId = req.requireRegistered();
    const body = BulkDeleteBody.parse(req.body);
    const removed = await bulkDeleteSavedMedia(body.savedMediaIds, userId);
    reply.status(200).send({ removed });
  });

  // ── Signed media: master playlist ─────────────────────────────────────────
  app.get('/:savedMediaId/master.m3u8', async (req, reply) => {
    const { savedMediaId } = Param.parse(req.params);
    requireSig(req, savedMediaId, 'master.m3u8');
    applyStreamCors(reply);

    const sm = await prisma.savedMedia.findUnique({
      where: { id: savedMediaId },
      include: {
        media: true,
        variants: {
          include: {
            variant: {
              select: {
                id: true,
                quality: true,
                state: true,
                width: true,
                height: true,
                bitrateBps: true,
              },
            },
          },
        },
      },
    });
    if (!sm) throw new AppError('NOT_FOUND', 'Saved media not found');

    const persisted = sm.variants
      .map((sv) => sv.variant)
      .filter((v) => v.state === 'PERSISTED')
      .sort((a, b) => (a.bitrateBps ?? 0) - (b.bitrateBps ?? 0));

    if (persisted.length === 0) throw new AppError('NOT_FOUND', 'No persisted variants yet');

    // Synthetic master pointing at the per-variant signed playlist routes.
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    const u = req.userId ?? 'anon';
    for (const v of persisted) {
      const attrs: string[] = [];
      attrs.push(`BANDWIDTH=${v.bitrateBps ?? 800_000}`);
      if (v.width && v.height) attrs.push(`RESOLUTION=${v.width}x${v.height}`);
      lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`);
      // Re-sign each variant's playlist URL bound to the same user.
      const { signLibrary, buildSignedPath } = await import('../../services/signing/signed-url.js');
      const sig = signLibrary(savedMediaId, `variant/${v.id}/playlist.m3u8`, u === 'anon' ? null : u);
      lines.push(buildSignedPath(`/api/v1/library/${savedMediaId}/variant/${v.id}/playlist.m3u8`, sig));
    }
    lines.push('');
    reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'private, no-store');
    return lines.join('\n');
  });

  // ── Signed media: variant playlist ────────────────────────────────────────
  app.get('/:savedMediaId/variant/:variantId/playlist.m3u8', async (req, reply) => {
    const { savedMediaId, variantId } = VariantParam.parse(req.params);
    requireSig(req, savedMediaId, `variant/${variantId}/playlist.m3u8`);
    applyStreamCors(reply);

    const sv = await prisma.savedVariant.findUnique({
      where: { savedMediaId_mediaVariantId: { savedMediaId, mediaVariantId: variantId } },
      include: { variant: { include: { media: true } } },
    });
    if (!sv) throw new AppError('NOT_FOUND', 'Variant not in saved media');

    await assertVariantPlayable(sv.variant.media, sv.variant);

    const playlistKey = joinKey(sv.variant.media.storageKey, sv.variant.hlsPlaylistKey ?? '');
    // Rewrite segment URIs to signed segment routes scoped to this savedMedia.
    const read = await permanentStorage().read(playlistKey);
    const text = await streamToString(read.stream);
    const u = req.userId ?? 'anon';
    const { signLibrary, buildSignedPath } = await import('../../services/signing/signed-url.js');
    const out: string[] = [];
    let segIndex = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine;
      if (line.length === 0 || line.startsWith('#')) {
        out.push(line);
        continue;
      }
      const sig = signLibrary(savedMediaId, `variant/${variantId}/segment/${segIndex}`, u === 'anon' ? null : u);
      out.push(
        buildSignedPath(
          `/api/v1/library/${savedMediaId}/variant/${variantId}/segment/${segIndex}`,
          sig,
        ),
      );
      segIndex += 1;
    }
    reply
      .status(200)
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'private, no-store');
    return out.join('\n');
  });

  // ── Signed media: segment ─────────────────────────────────────────────────
  app.get('/:savedMediaId/variant/:variantId/segment/:index', async (req, reply) => {
    const { savedMediaId, variantId, index } = SegmentParam.parse(req.params);
    requireSig(req, savedMediaId, `variant/${variantId}/segment/${index}`);
    applyStreamCors(reply);

    const sv = await prisma.savedVariant.findUnique({
      where: { savedMediaId_mediaVariantId: { savedMediaId, mediaVariantId: variantId } },
      include: { variant: { include: { media: true } } },
    });
    if (!sv) throw new AppError('NOT_FOUND', 'Variant not in saved media');
    if (sv.variant.state !== 'PERSISTED' || !sv.variant.hlsSegmentDir) {
      throw new AppError('NOT_FOUND', 'Variant not persisted');
    }
    const segKey = joinKey(
      sv.variant.media.storageKey,
      `${sv.variant.hlsSegmentDir}/seg-${index}.ts`,
    );
    await serveStored(req, reply, permanentStorage(), segKey, {
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  // ── Signed media: download ────────────────────────────────────────────────
  // Downloads ALWAYS serve the persisted source MP4 file, never the HLS
  // playlist. If no source file exists yet, return a clear 404.
  app.get('/:savedMediaId/variant/:variantId/download', async (req, reply) => {
    const { savedMediaId, variantId } = VariantParam.parse(req.params);
    requireSig(req, savedMediaId, `variant/${variantId}/download`);
    applyStreamCors(reply);

    const sv = await prisma.savedVariant.findUnique({
      where: { savedMediaId_mediaVariantId: { savedMediaId, mediaVariantId: variantId } },
      include: { variant: { include: { media: true } } },
    });
    if (!sv) throw new AppError('NOT_FOUND', 'Variant not in saved media');
    if (sv.variant.state !== 'PERSISTED') {
      throw new AppError('NOT_FOUND', 'Variant not persisted yet');
    }

    const media = sv.variant.media;

    // Build a proper filename: "VideoName (720p).mp4"
    const filename = buildDownloadFilename({
      baseName: media.name || 'video',
      quality: sv.variant.quality,
      container: 'MP4',
      mime: 'video/mp4',
    });
    reply.header('Content-Disposition', buildContentDisposition('attachment', filename));
    reply.header('Content-Type', 'video/mp4');

    // Priority 1: Serve the persisted source MP4 (canonical download file).
    if (media.originalKey && media.storageKey) {
      const key = joinKey(media.storageKey, media.originalKey);
      const exists = await permanentStorage().exists(key);
      if (exists) {
        await serveStored(req, reply, permanentStorage(), key, {
          cacheControl: 'private, no-store',
          contentType: 'video/mp4',
        });
        return;
      }
    }

    // Priority 2: If variant has a direct fileKey (MP4 container).
    if (sv.variant.container === 'MP4' && sv.variant.fileKey && media.storageKey) {
      const key = joinKey(media.storageKey, sv.variant.fileKey);
      const exists = await permanentStorage().exists(key);
      if (exists) {
        await serveStored(req, reply, permanentStorage(), key, {
          cacheControl: 'private, no-store',
          contentType: 'video/mp4',
        });
        return;
      }
    }

    // If neither source MP4 nor variant MP4 exists, the download is
    // genuinely unavailable. Do NOT serve the HLS playlist — that
    // produces the corrupt ~200B "download" users reported.
    throw new AppError(
      'NOT_FOUND',
      'Source file not yet available. The system is still processing this media.',
    );
  });

  // ── Signed media: thumbnail ──────────────────────────────────────────────
  app.get('/:savedMediaId/thumb.jpg', async (req, reply) => {
    const { savedMediaId } = Param.parse(req.params);
    requireSig(req, savedMediaId, 'thumb.jpg');
    applyStreamCors(reply);

    const sm = await prisma.savedMedia.findUnique({
      where: { id: savedMediaId },
      include: { media: { select: { storageKey: true, thumbnailKey: true } } },
    });
    if (!sm || !sm.media.thumbnailKey) throw new AppError('NOT_FOUND', 'Thumbnail not available');
    const key = joinKey(sm.media.storageKey, sm.media.thumbnailKey);
    await serveStored(req, reply, permanentStorage(), key, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=86400, immutable',
    });
  });
};

export default libraryRoutes;

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks).toString('utf8');
}
