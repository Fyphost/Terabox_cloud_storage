export type VariantState = 'EPHEMERAL' | 'CACHED' | 'PERSISTED' | 'PENDING_DELETE';
export type SavedState = 'PENDING' | 'DOWNLOADING' | 'COMPLETE' | 'FAILED';
export type MediaSourceState = 'EPHEMERAL' | 'PERSISTED' | 'PENDING_DELETE';

export interface ApiVariant {
  id: string;
  quality: string;
  container: 'HLS' | 'MP4' | 'OTHER';
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  sizeBytes: number | null;
  state: VariantState;
  /** HLS media playlist URL (signed). */
  playlistUrl: string;
  /** Same byte source as the canonical download, no Content-Disposition. */
  fileUrl: string;
  // NOTE: downloadUrl was intentionally removed. Downloads are media-scoped
  // (one canonical artifact per Media), not variant-scoped. Use
  // ApiMedia.sourceDownloadUrl.
}

export interface ApiMedia {
  id: string;
  name: string;
  /**
   * Original filename from the upstream extractor, with extension preserved.
   * Used by the browser as the suggested download name on the canonical
   * source download URL (server emits matching Content-Disposition).
   */
  originalFilename: string | null;
  kind: 'VIDEO' | 'AUDIO' | 'IMAGE' | 'OTHER';
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  durationSec: number | null;

  /** HLS master playlist (synthetic, aggregates all qualities as levels). */
  masterPlaylistUrl: string;

  /** Canonical source download (Media.sourceStorageKey when PERSISTED, else proxied). */
  sourceDownloadUrl: string;
  sourceFileUrl: string;
  sourceState: MediaSourceState;
  sourceSizeBytes: number | null;
  sourceContentType: string | null;

  variants: ApiVariant[];
}

export interface ApiSaveJob {
  savedMediaId: string;
  variantId: string;
  quality: string;
  jobId: string;
  state: SavedState;
  shareToken: string;
}

export interface ApiSaveStatus {
  savedMediaId: string;
  mediaId: string;
  variantId: string | null;
  quality: string;
  state: SavedState;
  progress: number;
  error: string | null;
  sourcePersisted: boolean;
  shareToken: string | null;
}

export interface ApiLibraryEntry {
  savedMediaId: string;
  mediaId: string;
  state: SavedState;
  progress: number;
  selectedQuality: string;
  selectedVariantId: string | null;
  createdAt: string;
  updatedAt: string | null;
  shareToken: string | null;
  shareUrl: string | null;
  media: ApiMedia;
}

export interface ApiLibraryPage {
  items: ApiLibraryEntry[];
  nextCursor: string | null;
}

export interface ApiShareTokenInfo {
  token: string;
  shareUrl: string;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
}

export interface ApiSharedMedia {
  share: ApiShareTokenInfo;
  selectedQuality: string;
  selectedVariantId: string | null;
  media: ApiMedia;
}

export interface ApiError {
  error: { code: string; message: string };
}
