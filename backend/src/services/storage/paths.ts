/**
 * Storage path conventions — single source of truth.
 *
 * Permanent layout (under env.STORAGE_PERMANENT_DIR):
 *
 *   media/{mediaId}/
 *     metadata.json
 *     thumb.jpg
 *     poster.jpg
 *     original/
 *       file.mp4
 *     hls/
 *       master.m3u8
 *       {quality}/
 *         playlist.m3u8
 *         seg-0.ts
 *         seg-1.ts
 *
 * Cache layout (under env.STORAGE_CACHE_DIR) — unchanged from v2; kept
 * isolated from permanent media bytes:
 *
 *   {variantId}/
 *     playlist.m3u8
 *     seg-0.ts
 *     file.bin
 *
 * Staging (used by save.worker for transactional moves):
 *
 *   media/{mediaId}/.staging/{variantId}/
 *     playlist.m3u8
 *     seg-N.ts
 *
 * Once a staging directory passes verification it is renamed atomically into
 * place under hls/{quality}/.
 */

export type Quality = string;

export const MEDIA_ROOT = 'media';

export function mediaDir(mediaId: string): string {
  return `${MEDIA_ROOT}/${mediaId}`;
}

export function metadataKey(mediaId: string): string {
  return `${mediaDir(mediaId)}/metadata.json`;
}

export function thumbnailKey(mediaId: string): string {
  return `${mediaDir(mediaId)}/thumb.jpg`;
}

export function posterKey(mediaId: string): string {
  return `${mediaDir(mediaId)}/poster.jpg`;
}

export function originalDir(mediaId: string): string {
  return `${mediaDir(mediaId)}/original`;
}

export function originalFileKey(mediaId: string): string {
  return `${originalDir(mediaId)}/file.mp4`;
}

export function hlsRoot(mediaId: string): string {
  return `${mediaDir(mediaId)}/hls`;
}

export function masterPlaylistKey(mediaId: string): string {
  return `${hlsRoot(mediaId)}/master.m3u8`;
}

export function variantHlsDir(mediaId: string, quality: Quality): string {
  return `${hlsRoot(mediaId)}/${quality}`;
}

export function variantPlaylistKey(mediaId: string, quality: Quality): string {
  return `${variantHlsDir(mediaId, quality)}/playlist.m3u8`;
}

export function variantSegmentKey(mediaId: string, quality: Quality, index: number): string {
  return `${variantHlsDir(mediaId, quality)}/seg-${index}.ts`;
}

export function variantMp4Key(mediaId: string, quality: Quality): string {
  return `${mediaDir(mediaId)}/files/${quality}.mp4`;
}

// Staging --------------------------------------------------------------------

export function variantStagingDir(mediaId: string, variantId: string): string {
  return `${mediaDir(mediaId)}/.staging/${variantId}`;
}

export function stagingPlaylistKey(mediaId: string, variantId: string): string {
  return `${variantStagingDir(mediaId, variantId)}/playlist.m3u8`;
}

export function stagingSegmentKey(mediaId: string, variantId: string, index: number): string {
  return `${variantStagingDir(mediaId, variantId)}/seg-${index}.ts`;
}

export function stagingMp4Key(mediaId: string, variantId: string): string {
  return `${variantStagingDir(mediaId, variantId)}/file.mp4`;
}

// Cache ----------------------------------------------------------------------

export function cacheVariantDir(variantId: string): string {
  return `${variantId}`;
}

export function cacheSegmentKey(variantId: string, index: number): string {
  return `${cacheVariantDir(variantId)}/seg-${index}.ts`;
}

export function cacheFileKey(variantId: string): string {
  return `${cacheVariantDir(variantId)}/file.bin`;
}

export function cachePlaylistKey(variantId: string): string {
  return `${cacheVariantDir(variantId)}/playlist.m3u8`;
}
