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

export interface StorageBackend {
  /** Read whole file or a byte range. */
  read(key: string, range?: ByteRange): Promise<ReadResult>;
  /** Write a stream to storage atomically (temp + rename). */
  write(key: string, src: Readable, opts?: { contentType?: string }): Promise<WriteResult>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<StorageStat | null>;
  delete(key: string): Promise<void>;
  /** Iterate keys under a prefix (for cleanup). */
  list(prefix: string): AsyncIterable<{ key: string; size: number; mtimeMs: number }>;
}
