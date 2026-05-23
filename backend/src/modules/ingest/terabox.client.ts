import { request } from 'undici';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

const StreamsSchema = z.record(z.string(), z.string().url());

export const TeraboxResponseSchema = z.object({
  name: z.string(),
  size: z.string().optional(),         // human "6.23 MB"; convert in service
  thumbnail: z.string().url().optional(),
  stream: z.string().url().optional(), // default playlist
  quality: z.string().optional(),      // default quality label
  streams: StreamsSchema.optional(),   // map of "360p" -> m3u8 url
  download: z.string().url().optional(),
});

export type TeraboxResponse = z.infer<typeof TeraboxResponseSchema>;

export async function fetchTeraboxMetadata(url: string): Promise<TeraboxResponse> {
  const resp = await request(env.TERABOX_EXTRACTOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });

  if (resp.statusCode >= 400) {
    const text = await resp.body.text().catch(() => '');
    throw new AppError(
      'UPSTREAM_ERROR',
      `Extractor returned ${resp.statusCode}: ${text.slice(0, 200)}`,
    );
  }

  const json = await resp.body.json();
  const parsed = TeraboxResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('UPSTREAM_ERROR', 'Extractor returned malformed payload');
  }
  return parsed.data;
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
