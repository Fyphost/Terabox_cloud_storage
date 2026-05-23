/**
 * RFC 5987 / RFC 6266 compliant Content-Disposition header builder.
 *
 * Many filenames contain non-ASCII characters (CJK, accents) which MUST be
 * encoded with `filename*=UTF-8''<percent-encoded>` per RFC 5987 to render
 * correctly in modern browsers. We also emit a sanitized ASCII fallback for
 * legacy clients via the plain `filename=` token.
 */

const FORBIDDEN_FS = /[\u0000-\u001f\u007f"\\/:*?<>|]/g;
const NON_ASCII = /[^\x20-\x7e]/g;

export function sanitizeFilename(name: string, maxLen = 200): string {
  return name.replace(FORBIDDEN_FS, '_').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function asciiFallback(name: string): string {
  return name
    .normalize('NFKD')
    .replace(NON_ASCII, '_')
    .replace(/"/g, '_')
    .slice(0, 200);
}

export function buildContentDisposition(
  disposition: 'attachment' | 'inline',
  filename: string,
): string {
  const safe = sanitizeFilename(filename);
  const ascii = asciiFallback(safe) || 'download';
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const EXT_BY_CONTAINER: Record<string, string> = {
  HLS: '.mp4',  // we surface saved HLS as mp4 for download convenience
  MP4: '.mp4',
  OTHER: '.bin',
};

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/x-m4v': '.m4v',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/mpeg': '.mpeg',
  'video/mp2t': '.ts',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/aac': '.aac',
  'application/vnd.apple.mpegurl': '.m3u8',
};

export function inferExtension(opts: {
  name?: string | null;
  container?: string | null;
  mime?: string | null;
}): string {
  if (opts.name) {
    const dot = opts.name.lastIndexOf('.');
    if (dot > 0 && dot >= opts.name.length - 6) {
      const ext = opts.name.slice(dot).toLowerCase();
      if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
    }
  }
  if (opts.mime && EXT_BY_MIME[opts.mime]) return EXT_BY_MIME[opts.mime]!;
  if (opts.container && EXT_BY_CONTAINER[opts.container]) return EXT_BY_CONTAINER[opts.container]!;
  return '.bin';
}

export function buildDownloadFilename(opts: {
  baseName: string;
  quality?: string | null;
  container?: string | null;
  mime?: string | null;
}): string {
  const baseRaw = opts.baseName.replace(/\.[^.]{2,5}$/, '');
  const base = sanitizeFilename(baseRaw) || 'media';
  const ext = inferExtension({ name: opts.baseName, container: opts.container, mime: opts.mime });
  const q = opts.quality ? ` (${opts.quality})` : '';
  return `${base}${q}${ext}`;
}
