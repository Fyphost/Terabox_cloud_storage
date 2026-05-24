export type VariantState =
  | 'EPHEMERAL'
  | 'CACHED'
  | 'PENDING'
  | 'FETCHING'
  | 'DOWNLOADING'
  | 'GENERATING_HLS'
  | 'GENERATING_THUMBNAIL'
  | 'FINALIZING'
  | 'PERSISTED'
  | 'FAILED'
  | 'PENDING_DELETE';

export type SavedState =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'FAILED';

// ─── Preview / live streaming (backed by upstream + cache) ─────────────────

export interface ApiVariant {
  id: string;
  quality: string;
  container: 'HLS' | 'MP4' | 'OTHER';
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  sizeBytes: number | null;
  state: VariantState;
  playlistUrl: string;
  fileUrl: string;
  downloadUrl: string;
}

export interface ApiMedia {
  id: string;
  name: string;
  kind: 'VIDEO' | 'AUDIO' | 'IMAGE' | 'OTHER';
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  masterPlaylistUrl: string;
  variants: ApiVariant[];
}

// ─── Save flow (job + claim) ────────────────────────────────────────────────

export interface ApiEnqueuedClaim {
  savedMediaId: string;
  savedVariantId: string;
  variantId: string;
  quality: string;
  state: 'IN_FLIGHT' | 'ALREADY_PERSISTED';
  jobId: string | null;
}

export interface ApiEnqueueSaveResult {
  savedMediaId: string;
  claims: ApiEnqueuedClaim[];
}

export interface ApiSavedVariantProgress {
  savedVariantId: string;
  variantId: string;
  quality: string;
  state: VariantState;
  pipelineStep: string | null;
  progress: number;
  bytesDone: number;
  bytesTotal: number | null;
  speedBytesPerSec: number | null;
  etaSec: number | null;
  errorMessage: string | null;
  sizeBytes: number | null;
}

export interface ApiSavedMediaProgress {
  savedMediaId: string;
  mediaId: string;
  state: SavedState;
  completedAt: string | null;
  variants: ApiSavedVariantProgress[];
}

// ─── Library (saved-media catalog) ─────────────────────────────────────────

export interface ApiLibraryVariant extends ApiSavedVariantProgress {
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  /** Set only when state == PERSISTED. */
  playlistUrl: string | null;
  downloadUrl: string | null;
}

export interface ApiLibraryMedia {
  id: string;
  name: string;
  durationSec: number | null;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
}

export interface ApiLibraryItem {
  savedMediaId: string;
  state: SavedState;
  createdAt: string;
  completedAt: string | null;
  media: ApiLibraryMedia;
  topQuality: string | null;
  variants: ApiLibraryVariant[];
}

export interface ApiLibraryPage {
  items: ApiLibraryItem[];
  nextCursor: string | null;
}

export interface ApiSavedMediaDetail extends ApiLibraryItem {
  /** Master playlist URL — only when at least one variant is PERSISTED. */
  masterPlaylistUrl: string | null;
}
