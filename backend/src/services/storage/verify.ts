/**
 * Storage verification.
 *
 * Used by the save worker (before transitioning a variant to PERSISTED) and
 * by the streaming routes (before serving saved-media bytes).
 *
 * Two flavors:
 *
 *   verifyVariantBytes    — exhaustive check used post-write. Confirms the
 *                           playlist parses, lists segments, all segment
 *                           files exist with non-zero size.
 *   assertVariantPlayable — fast pre-stream check used on every saved-media
 *                           playlist request. Catches drift between DB and
 *                           filesystem (manual delete, partial rollback).
 */

import type { Media, MediaVariant } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { permanentStorage } from './index.js';

export interface VerificationResult {
  ok: boolean;
  bytes: number;
  segmentCount: number;
  errors: string[];
}

const SEGMENT_LINE = /^[^#].*\.ts(\?.*)?$/;

export async function verifyVariantBytes(
  media: Media,
  variant: MediaVariant,
): Promise<VerificationResult> {
  const errors: string[] = [];
  const storage = permanentStorage();

  if (variant.container === 'MP4') {
    if (!variant.fileKey) return { ok: false, bytes: 0, segmentCount: 0, errors: ['fileKey unset'] };
    const stat = await storage.stat(joinKey(media.storageKey, variant.fileKey));
    if (!stat || stat.size <= 0) return { ok: false, bytes: 0, segmentCount: 0, errors: ['mp4 file missing or empty'] };
    return { ok: true, bytes: stat.size, segmentCount: 0, errors: [] };
  }

  // HLS path
  if (!variant.hlsPlaylistKey || !variant.hlsSegmentDir) {
    return { ok: false, bytes: 0, segmentCount: 0, errors: ['hls keys unset'] };
  }

  const playlistKey = joinKey(media.storageKey, variant.hlsPlaylistKey);
  const playlistRead = await storage.read(playlistKey).catch(() => null);
  if (!playlistRead) {
    return { ok: false, bytes: 0, segmentCount: 0, errors: [`playlist missing: ${playlistKey}`] };
  }

  const playlistText = await streamToString(playlistRead.stream);
  const segmentLines = playlistText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && SEGMENT_LINE.test(l));

  if (segmentLines.length === 0) {
    return { ok: false, bytes: 0, segmentCount: 0, errors: ['playlist has no segments'] };
  }

  let totalBytes = playlistText.length;
  for (let i = 0; i < segmentLines.length; i++) {
    const segName = segmentLines[i]!.split('?')[0]!;
    const segKey = joinKey(media.storageKey, `${variant.hlsSegmentDir}/${segName}`);
    const stat = await storage.stat(segKey);
    if (!stat || stat.size <= 0) {
      errors.push(`segment missing or empty: ${segKey}`);
      if (errors.length >= 5) break; // cap log noise
      continue;
    }
    totalBytes += stat.size;
  }

  return {
    ok: errors.length === 0,
    bytes: totalBytes,
    segmentCount: segmentLines.length,
    errors,
  };
}

/**
 * Fast pre-serve assertion. Throws AppError('NOT_FOUND') if the variant
 * cannot be served from local storage.
 */
export async function assertVariantPlayable(
  media: { storageKey: string | null },
  variant: MediaVariant,
): Promise<void> {
  if (variant.state !== 'PERSISTED') {
    throw new AppError('NOT_FOUND', 'Variant is not yet persisted');
  }
  const storage = permanentStorage();

  if (variant.container === 'MP4') {
    if (!variant.fileKey) throw new AppError('NOT_FOUND', 'fileKey unset');
    const ok = await storage.exists(joinKey(media.storageKey, variant.fileKey));
    if (!ok) throw new AppError('NOT_FOUND', 'mp4 file missing');
    return;
  }

  if (!variant.hlsPlaylistKey) throw new AppError('NOT_FOUND', 'hlsPlaylistKey unset');
  const ok = await storage.exists(joinKey(media.storageKey, variant.hlsPlaylistKey));
  if (!ok) throw new AppError('NOT_FOUND', 'hls playlist missing');
}

export function joinKey(base: string | null, rel: string): string {
  if (!base) return rel;
  if (rel.startsWith('/')) return rel.slice(1);
  return `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks).toString('utf8');
}
