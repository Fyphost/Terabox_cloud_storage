/**
 * TeraBox extractor client — hardened for production.
 *
 * Root causes fixed:
 *   1. HTML/error pages from upstream: the extractor (Cloudflare Worker) can
 *      return HTML on bot detection, rate-limit, or internal error. Previous
 *      code called resp.body.json() unconditionally → "Unexpected end of JSON".
 *   2. No retry: transient 5xx or network timeouts caused immediate failure.
 *   3. No structured logging: errors were invisible in production.
 *   4. No timeout: requests could hang forever.
 *
 * Strategy:
 *   - Read body as text first, detect HTML, then parse JSON.
 *   - Retry with exponential backoff (max 3 attempts).
 *   - Structured pino logging for every attempt.
 *   - Configurable timeout (default 30s header, 30s body).
 */

import { request } from 'undici';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const StreamsSchema = z.record(z.string(), z.string().url());

export const TeraboxResponseSchema = z.object({
  name: z.string(),
  size: z.string().optional(),
  thumbnail: z.string().url().optional(),
  stream: z.string().url().optional(),
  quality: z.string().optional(),
  streams: StreamsSchema.optional(),
  download: z.string().url().optional(),
});

export type TeraboxResponse = z.infer<typeof TeraboxResponseSchema>;

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;
const HEADERS_TIMEOUT_MS = 30_000;
const BODY_TIMEOUT_MS = 30_000;

/**
 * Detect whether a response body is HTML (bot page, error page, CF challenge).
 */
function looksLikeHtml(body: string): boolean {
  const trimmed = body.trimStart().slice(0, 200).toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.includes('<title>')
  );
}

export async function fetchTeraboxMetadata(url: string): Promise<TeraboxResponse> {
  const log = logger.child({ module: 'terabox-client', sourceUrl: url });
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await request(env.TERABOX_EXTRACTOR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
        headersTimeout: HEADERS_TIMEOUT_MS,
        bodyTimeout: BODY_TIMEOUT_MS,
      });

      // Always read body as text first for safe inspection.
      const rawBody = await resp.body.text();

      if (resp.statusCode >= 500) {
        log.warn(
          { attempt, statusCode: resp.statusCode, bodyPreview: rawBody.slice(0, 300) },
          'extractor returned 5xx — retrying',
        );
        lastError = new Error(`Extractor 5xx: ${resp.statusCode}`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
          continue;
        }
        throw new AppError('UPSTREAM_ERROR', `Extractor returned ${resp.statusCode} after ${MAX_ATTEMPTS} attempts`);
      }

      if (resp.statusCode >= 400) {
        log.warn(
          { attempt, statusCode: resp.statusCode, bodyPreview: rawBody.slice(0, 300) },
          'extractor returned 4xx',
        );
        throw new AppError(
          'UPSTREAM_ERROR',
          `Extractor returned ${resp.statusCode}: ${rawBody.slice(0, 200)}`,
        );
      }

      // Detect HTML bot/challenge pages.
      if (looksLikeHtml(rawBody)) {
        log.warn(
          { attempt, bodyPreview: rawBody.slice(0, 300) },
          'extractor returned HTML instead of JSON — possible bot detection',
        );
        lastError = new Error('Extractor returned HTML');
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
          continue;
        }
        throw new AppError('UPSTREAM_ERROR', 'Extractor returned non-JSON response (HTML). Possible anti-bot challenge.');
      }

      // Parse JSON safely.
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch (parseErr) {
        log.error(
          { attempt, bodyPreview: rawBody.slice(0, 500), err: parseErr },
          'extractor returned invalid JSON',
        );
        lastError = new Error('Invalid JSON from extractor');
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
          continue;
        }
        throw new AppError('UPSTREAM_ERROR', 'Extractor returned invalid JSON');
      }

      // Check if extractor returned its own error object.
      if (json && typeof json === 'object' && 'error' in json) {
        const errMsg = (json as { error?: string }).error ?? 'Unknown extractor error';
        log.warn({ attempt, extractorError: errMsg }, 'extractor returned error payload');
        throw new AppError('UPSTREAM_ERROR', `Extractor error: ${errMsg}`);
      }

      // Validate against schema.
      const parsed = TeraboxResponseSchema.safeParse(json);
      if (!parsed.success) {
        log.error(
          { attempt, zodErrors: parsed.error.flatten().fieldErrors, rawKeys: Object.keys(json as object) },
          'extractor returned malformed payload',
        );
        throw new AppError('UPSTREAM_ERROR', 'Extractor returned malformed payload');
      }

      log.info(
        { attempt, name: parsed.data.name, qualities: Object.keys(parsed.data.streams ?? {}) },
        'extractor success',
      );
      return parsed.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Network-level errors (ECONNREFUSED, timeout, etc.)
      lastError = err instanceof Error ? err : new Error(String(err));
      log.error(
        { attempt, err: lastError.message },
        'extractor request failed — network error',
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
        continue;
      }
    }
  }

  throw new AppError(
    'UPSTREAM_ERROR',
    `Extractor unreachable after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown'}`,
  );
}

/** "6.23 MB" → bytes (best-effort). */
export function parseHumanSize(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i.exec(s.trim());
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 'B').toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return Math.round(n * (mult[unit] ?? 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
