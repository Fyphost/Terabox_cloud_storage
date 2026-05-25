/**
 * services/storage/keys.ts
 *
 * Single source of truth for storage paths.
 *
 * Why this module exists
 * ─────────────────────────────────────────────────────────────────────────────
 * The previous codebase computed storage keys ad-hoc in three different
 * places (save.worker, stream.routes, storage-cleanup.worker), each producing
 * a slightly different shape. That divergence is exactly how `download`
 * ended up serving `playlist.m3u8` bytes, why downloads were ~200 B, and why
 * we lost track of which variants were canonical. Centralizing key
 * construction makes that class of bug impossible: every reader and every
 * writer consults the same builder.
 *
 * Canonical permanent layout
 * ─────────────────────────────────────────────────────────────────────────────
 *   permanent/
 *   └── media/
 *       └── <mediaId>/
 *           ├── source.mp4                ← Media.sourceStorageKey (canonical
 *           │                                download artifact, exactly one
 *           │                                per Media; deduplicated across
 *           │                                users by Media.sourceHash)
 *           ├── thumb.jpg                 ← optional, future
 *           └── hls/
 *               └── <quality>/            ← MediaVariant.storageKey
 *                   ├── playlist.m3u8     ← rewritten media playlist
 *                   ├── seg-0.ts
 *                   └── seg-N.ts
 *
 * Cache layout (unchanged)
 * ─────────────────────────────────────────────────────────────────────────────
 *   cache/
 *   └── <variantId>/
 *       ├── playlist.m3u8 (rare; usually fetched live)
 *       ├── seg-N.ts
 *       └── file.bin (rare; only for non-HLS direct files)
 */

import { extname } from 'node:path';

/** Whitelist of quality labels we will store under hls/. Any other label is rejected. */
const QUALITY_RE = /^(audio|\d{3,4}p)$/;

function assertSafeMediaId(mediaId: string): void {
  if (!/^med_[A-Za-z0-9]{6,40}$/.test(mediaId)) {
    throw new Error(`Refusing to build storage key for unsafe mediaId: ${mediaId}`);
  }
}

function assertSafeQuality(quality: string): void {
  if (!QUALITY_RE.test(quality)) {
    throw new Error(`Refusing to build storage key for unsafe quality: ${quality}`);
  }
}

/** Choose the file extension for the canonical source artifact based on its content type. */
export function sourceFilenameForContentType(contentType: string | null | undefined): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('video/mp4')) return 'source.mp4';
  if (ct.startsWith('video/x-matroska')) return 'source.mkv';
  if (ct.startsWith('video/webm')) return 'source.webm';
  if (ct.startsWith('video/quicktime')) return 'source.mov';
  if (ct.startsWith('audio/mpeg')) return 'source.mp3';
  if (ct.startsWith('audio/aac')) return 'source.aac';
  // Default: assume MP4. Container choice doesn't change byte-for-byte
  // playback; it only changes the suffix on the disk file. Prefer .mp4 to
  // keep filesystem consumers happy.
  return 'source.mp4';
}

/** Path of the canonical source artifact for a Media. */
export function mediaSourceKey(mediaId: string, contentType?: string | null): string {
  assertSafeMediaId(mediaId);
  return `media/${mediaId}/${sourceFilenameForContentType(contentType)}`;
}

/** Directory prefix containing the entire archive of a Media. */
export function mediaPrefix(mediaId: string): string {
  assertSafeMediaId(mediaId);
  return `media/${mediaId}`;
}

/** Directory key holding HLS bytes for one (mediaId, quality) variant. */
export function mediaVariantHlsKey(mediaId: string, quality: string): string {
  assertSafeMediaId(mediaId);
  assertSafeQuality(quality);
  return `media/${mediaId}/hls/${quality}`;
}

export function variantPlaylistKey(variantStorageKey: string): string {
  return `${variantStorageKey}/playlist.m3u8`;
}

export function variantSegmentKey(variantStorageKey: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid segment index: ${index}`);
  }
  return `${variantStorageKey}/seg-${index}.ts`;
}

/** Storage key for a thumbnail (reserved for future use). */
export function mediaThumbnailKey(mediaId: string, ext = '.jpg'): string {
  assertSafeMediaId(mediaId);
  const safe = ext.startsWith('.') ? ext : `.${ext}`;
  return `media/${mediaId}/thumb${safe}`;
}

/**
 * Test whether a stored MediaVariant.storageKey is in the legacy
 * `YYYY/MM/<variantId>` shape produced by the old save worker. Used by the
 * reconciliation script to decide whether bytes need relocation.
 */
export function isLegacyVariantStorageKey(key: string): boolean {
  // New: starts with "media/"
  if (key.startsWith('media/')) return false;
  // Legacy: YYYY/MM/var_xxx (or any non-media-prefixed shape)
  return true;
}

// ── Cache (NVMe) ────────────────────────────────────────────────────────────

export function cacheVariantSegmentKey(variantId: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid segment index: ${index}`);
  }
  return `${variantId}/seg-${index}.ts`;
}

export function cacheVariantFileKey(variantId: string): string {
  return `${variantId}/file.bin`;
}

// ── Filename helpers ────────────────────────────────────────────────────────

/**
 * Ensure a filename has an extension consistent with the given content type.
 * Used when persisting a source for which the upstream `name` may not have
 * an extension (some TeraBox responses).
 */
export function ensureFilenameExtension(filename: string, contentType: string | null): string {
  if (extname(filename)) return filename;
  if (!contentType) return `${filename}.mp4`;
  const ct = contentType.toLowerCase();
  if (ct.startsWith('video/mp4')) return `${filename}.mp4`;
  if (ct.startsWith('video/x-matroska')) return `${filename}.mkv`;
  if (ct.startsWith('video/webm')) return `${filename}.webm`;
  if (ct.startsWith('audio/mpeg')) return `${filename}.mp3`;
  if (ct.startsWith('audio/aac')) return `${filename}.aac`;
  return `${filename}.mp4`;
}
