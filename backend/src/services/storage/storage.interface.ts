import type { Readable } from 'node:stream';

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

export interface StorageStat {
  size: number;
  mtimeMs: number;
}

export interface ReadResult {
  stream: Readable;
  size: number;          // total file size, even on ranged read
  contentType: string;
  range?: ByteRange;     // populated when ranged
}

export interface WriteResult {
  bytes: number;
  sha256: string;
}

export interface ListedObject {
  /** Path relative to the prefix passed to `list()`. */
  key: string;
  size: number;
  mtimeMs: number;
}

export interface StorageBackend {
  /** Read whole file or a byte range. */
  read(key: string, range?: ByteRange): Promise<ReadResult>;
  /** Write a stream to storage atomically (temp + rename). */
  write(key: string, src: Readable, opts?: { contentType?: string }): Promise<WriteResult>;
  /** Write a buffer atomically. */
  writeBuffer(key: string, buf: Buffer, opts?: { contentType?: string }): Promise<WriteResult>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<StorageStat | null>;
  delete(key: string): Promise<void>;
  /** Recursively delete a key prefix (best-effort). No-op if missing. */
  deletePrefix(prefix: string): Promise<void>;
  /** Iterate keys under a prefix (for cleanup, verification). */
  list(prefix: string): AsyncIterable<ListedObject>;
  /**
   * Atomic directory rename: move `from` → `to` (both paths within the same
   * backend root). `to` MUST NOT exist. Used by the save worker to promote a
   * staged tree into its permanent location.
   */
  renameDir(from: string, to: string): Promise<void>;
  /** Resolve a key to an absolute filesystem path (local backend only). */
  resolve(key: string): string;
}
