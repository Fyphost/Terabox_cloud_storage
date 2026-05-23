import { env } from '../../config/env.js';
import { LocalDiskBackend } from './local-storage.js';
import type { StorageBackend } from './storage.interface.js';

let _cache: StorageBackend | null = null;
let _permanent: StorageBackend | null = null;

export function cacheStorage(): StorageBackend {
  if (_cache) return _cache;
  if (env.STORAGE_BACKEND !== 'local') {
    throw new Error('Only local backend is implemented; S3 stub deferred.');
  }
  _cache = new LocalDiskBackend(env.STORAGE_CACHE_DIR);
  return _cache;
}

export function permanentStorage(): StorageBackend {
  if (_permanent) return _permanent;
  if (env.STORAGE_BACKEND !== 'local') {
    throw new Error('Only local backend is implemented; S3 stub deferred.');
  }
  _permanent = new LocalDiskBackend(env.STORAGE_PERMANENT_DIR);
  return _permanent;
}

export type { StorageBackend, ByteRange, ReadResult, WriteResult } from './storage.interface.js';
