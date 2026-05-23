/**
 * Range-aware streaming proxy.
 *
 * Pipes an upstream HTTP response straight to the Fastify reply, with:
 *  - HTTP 206 Partial Content support (Range request → Range response).
 *  - Optional write-through tee into a StorageBackend.
 *  - No buffering: pure Node Readable pipelines.
 *  - Refresh hook: caller can re-extract the upstream URL on 403/404 once.
 */

import { PassThrough, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { upstreamRequest } from '../../lib/http.js';
import { AppError } from '../../lib/errors.js';
import type { StorageBackend } from '../../services/storage/index.js';

export interface ProxyOptions {
  /** Final upstream URL (after any refresh). */
  upstreamUrl: string;
  /** If true, tee into storage at `cacheKey`. */
  cache?: { backend: StorageBackend; key: string };
  /** Default content type if upstream omits one. */
  defaultContentType?: string;
  /** Allow caller to re-extract upstream URL once on 403/404. */
  refreshOnce?: () => Promise<string | null>;
  /** Cache headers to set when the response is fresh. */
  responseCacheControl?: string;
}

export interface ParsedRange {
  start: number;
  end?: number; // undefined means open-ended (e.g. "bytes=500-")
}

/** Parse a single-range "bytes=A-B" header. We do not support multi-range. */
export function parseRangeHeader(header: string | undefined): ParsedRange | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const aStr = m[1] ?? '';
  const bStr = m[2] ?? '';
  if (aStr === '' && bStr === '') return null;
  if (aStr === '') {
    // suffix range "bytes=-N" — last N bytes; we let the upstream handle it
    return { start: -Number(bStr) };
  }
  const start = Number(aStr);
  if (!Number.isFinite(start) || start < 0) return null;
  if (bStr === '') return { start };
  const end = Number(bStr);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

export async function proxyStream(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: ProxyOptions,
): Promise<void> {
  const range = req.headers.range;
  let url = opts.upstreamUrl;

  let upstream = await upstreamRequest(url, {
    method: 'GET',
    headers: rangeHeaders(range, req.headers['user-agent']),
  });

  if ((upstream.statusCode === 403 || upstream.statusCode === 404) && opts.refreshOnce) {
    const refreshed = await opts.refreshOnce();
    if (refreshed) {
      url = refreshed;
      upstream = await upstreamRequest(url, {
        method: 'GET',
        headers: rangeHeaders(range, req.headers['user-agent']),
      });
    }
  }

  if (upstream.statusCode >= 400) {
    // Drain to free socket
    upstream.body.resume();
    throw new AppError(
      upstream.statusCode === 403 || upstream.statusCode === 404 ? 'UPSTREAM_EXPIRED' : 'UPSTREAM_ERROR',
      `Upstream returned ${upstream.statusCode}`,
    );
  }

  const ct = String(upstream.headers['content-type'] ?? opts.defaultContentType ?? 'application/octet-stream');
  const cl = upstream.headers['content-length'];
  const cr = upstream.headers['content-range'];

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', ct);
  if (cl) reply.header('Content-Length', String(cl));
  if (cr) reply.header('Content-Range', String(cr));
  if (opts.responseCacheControl) reply.header('Cache-Control', opts.responseCacheControl);
  reply.header('X-Accel-Buffering', 'no');

  reply.status(upstream.statusCode === 206 ? 206 : 200);

  const upstreamBody = Readable.from(upstream.body, { objectMode: false });

  // Tee to cache for full-body responses only. Skip for partial (Range) reads
  // since a partial blob is not a valid cache entry.
  const shouldCache =
    opts.cache && upstream.statusCode === 200 && (range === undefined || range === null);

  if (shouldCache && opts.cache) {
    // Bounded best-effort cache mirror. If the cache disk falls behind, we
    // abandon the cache write rather than stall the playback path.
    const cacheSink = new PassThrough({ highWaterMark: 8 * 1024 * 1024 });
    let cacheAlive = true;

    const tee = new Transform({
      transform(chunk: Buffer, _enc, cb: TransformCallback) {
        if (cacheAlive && !cacheSink.destroyed) {
          const ok = cacheSink.write(chunk);
          if (!ok) {
            cacheAlive = false;
            cacheSink.destroy();
            req.log.warn({ key: opts.cache!.key }, 'cache mirror dropped: backpressure');
          }
        }
        cb(null, chunk);
      },
      flush(cb) {
        if (cacheAlive) cacheSink.end();
        cb();
      },
    });

    void opts.cache.backend
      .write(opts.cache.key, cacheSink, { contentType: ct })
      .catch((err) => req.log.warn({ err, key: opts.cache!.key }, 'cache write failed'));

    await pipeline(upstreamBody, tee, reply.raw);
  } else {
    await pipeline(upstreamBody, reply.raw);
  }
}

function rangeHeaders(range: string | undefined, ua: string | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (range) h['range'] = range;
  if (ua) h['user-agent'] = ua;
  return h;
}

/**
 * Serve a stored file with HTTP range support.
 */
export async function serveStored(
  req: FastifyRequest,
  reply: FastifyReply,
  backend: StorageBackend,
  key: string,
  opts: { contentType?: string; cacheControl?: string; downloadFilename?: string } = {},
): Promise<void> {
  const stat = await backend.stat(key);
  if (!stat) throw new AppError('NOT_FOUND', 'Stored object not found');

  const total = stat.size;
  const parsed = parseRangeHeader(req.headers.range);

  if (parsed) {
    const start = parsed.start < 0 ? Math.max(0, total + parsed.start) : parsed.start;
    const end = parsed.end !== undefined ? parsed.end : total - 1;
    if (start >= total) {
      reply.header('Content-Range', `bytes */${total}`);
      throw new AppError('BAD_REQUEST', 'Range Not Satisfiable');
    }
    const result = await backend.read(key, { start, end });
    reply.status(206);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', opts.contentType ?? result.contentType);
    reply.header('Content-Length', String(end - start + 1));
    reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
    if (opts.cacheControl) reply.header('Cache-Control', opts.cacheControl);
    if (opts.downloadFilename) {
      reply.header(
        'Content-Disposition',
        `attachment; filename="${sanitizeFilename(opts.downloadFilename)}"`,
      );
    }
    reply.header('X-Accel-Buffering', 'no');
    await pipeline(result.stream, reply.raw);
    return;
  }

  const result = await backend.read(key);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', opts.contentType ?? result.contentType);
  reply.header('Content-Length', String(total));
  if (opts.cacheControl) reply.header('Cache-Control', opts.cacheControl);
  if (opts.downloadFilename) {
    reply.header(
      'Content-Disposition',
      `attachment; filename="${sanitizeFilename(opts.downloadFilename)}"`,
    );
  }
  reply.header('X-Accel-Buffering', 'no');
  await pipeline(result.stream, reply.raw);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_').slice(0, 200);
}
