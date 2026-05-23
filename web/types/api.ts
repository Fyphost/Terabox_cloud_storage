export type VariantState = 'EPHEMERAL' | 'CACHED' | 'PERSISTED' | 'PENDING_DELETE';
export type SavedState = 'PENDING' | 'DOWNLOADING' | 'COMPLETE' | 'FAILED';

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

export interface ApiSaveJob {
  savedMediaId: string;
  variantId: string;
  quality: string;
  jobId: string;
  state: 'PENDING' | 'COMPLETE';
}

export interface ApiLibraryEntry {
  savedMediaId: string;
  state: SavedState;
  progress: number;
  createdAt: string;
  variantId: string;
  quality: string;
  media: ApiMedia;
}

export interface ApiLibraryPage {
  items: ApiLibraryEntry[];
  nextCursor: string | null;
}

export interface ApiError {
  error: { code: string; message: string };
}
