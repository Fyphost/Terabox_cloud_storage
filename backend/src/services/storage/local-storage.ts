import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  rename,
  rm,
  stat,
  unlink,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../lib/errors.js';
import type {
  ByteRange,
  ListedObject,
  ReadResult,
  StorageBackend,
  StorageStat,
  WriteResult,
} from './storage.interface.js';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

function inferContentType(key: string): string {
  const idx = key.lastIndexOf('.');
  if (idx < 0) return 'application/octet-stream';
  return CONTENT_TYPE_BY_EXT[key.slice(idx).toLowerCase()] ?? 'application/octet-stream';
}

export class LocalDiskBackend implements StorageBackend {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve and guard against traversal. */
  resolve(key: string): string {
    const normalized = key.replace(/^\/+/, '').replace(/\\/g, '/');
    const full = resolve(this.root, normalized);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new AppError('STORAGE_ERROR', 'Invalid storage key');
    }
    return full;
  }

  async read(key: string, range?: ByteRange): Promise<ReadResult> {
    const path = this.resolve(key);
    const s = await stat(path).catch(() => null);
    if (!s || !s.isFile()) throw new AppError('NOT_FOUND', 'Not in storage');

    const total = s.size;
    if (range) {
      const start = Math.max(0, range.start);
      const end = Math.min(total - 1, range.end);
      if (start > end) throw new AppError('BAD_REQUEST', 'Invalid byte range');
      return {
        stream: createReadStream(path, { start, end }),
        size: total,
        contentType: inferContentType(key),
        range: { start, end },
      };
    }
    return {
      stream: createReadStream(path),
      size: total,
      contentType: inferContentType(key),
    };
  }

  async write(key: string, src: Readable, _opts?: { contentType?: string }): Promise<WriteResult> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });

    const tmp = `${path}.partial-${process.pid}-${Date.now()}`;
    const hash = createHash('sha256');
    let bytes = 0;

    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb: TransformCallback) {
        bytes += chunk.length;
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(src, meter, createWriteStream(tmp));
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw new AppError('STORAGE_ERROR', 'Failed to write to storage', err);
    }

    return { bytes, sha256: hash.digest('hex') };
  }

  async writeBuffer(key: string, buf: Buffer, _opts?: { contentType?: string }): Promise<WriteResult> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.partial-${process.pid}-${Date.now()}`;
    try {
      await writeFile(tmp, buf);
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw new AppError('STORAGE_ERROR', 'Failed to write to storage', err);
    }
    return {
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
  }

  async exists(key: string): Promise<boolean> {
    const path = this.resolve(key);
    return !!(await stat(path).catch(() => null));
  }

  async stat(key: string): Promise<StorageStat | null> {
    const path = this.resolve(key);
    const s = await stat(path).catch(() => null);
    if (!s || !s.isFile()) return null;
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  async delete(key: string): Promise<void> {
    const path = this.resolve(key);
    await unlink(path).catch(() => undefined);
  }

  async deletePrefix(prefix: string): Promise<void> {
    const path = this.resolve(prefix);
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }

  async *list(prefix: string): AsyncIterable<ListedObject> {
    const root = this.resolve(prefix);
    yield* walk(root, root);
  }

  async renameDir(from: string, to: string): Promise<void> {
    const src = this.resolve(from);
    const dst = this.resolve(to);
    if (src === dst) return;
    // Ensure parent exists; refuse to overwrite an existing destination.
    if (await stat(dst).catch(() => null)) {
      throw new AppError('STORAGE_ERROR', `renameDir destination exists: ${to}`);
    }
    await mkdir(dirname(dst), { recursive: true });
    try {
      await rename(src, dst);
    } catch (err) {
      throw new AppError('STORAGE_ERROR', 'renameDir failed', err);
    }
  }
}

async function* walk(
  root: string,
  current: string,
): AsyncIterable<ListedObject> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(current, e.name);
    if (e.isDirectory()) {
      yield* walk(root, full);
    } else if (e.isFile()) {
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      yield {
        key: full.slice(root.length + 1).replace(/\\/g, '/'),
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
    }
  }
}
