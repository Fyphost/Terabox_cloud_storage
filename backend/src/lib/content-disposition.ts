/**
 * lib/content-disposition.ts
 *
 * RFC 5987 / RFC 6266 compliant Content-Disposition builder.
 *
 * Browsers will strip control chars and reject malformed values. The previous
 * implementation only emitted the legacy `filename="..."` form, which:
 *   • silently mangles non-ASCII filenames (Windows downloads them as `_`),
 *   • fails to escape quote and backslash properly,
 *   • degrades to URL-segment fallback on some browsers when the value is
 *     empty or contains an unsupported character — which is exactly how
 *     users ended up with files literally named "download".
 *
 * This implementation always emits BOTH forms:
 *   Content-Disposition: attachment; filename="ASCII fallback"; filename*=UTF-8''<percent-encoded>
 *
 * That dual form is the one prescribed by RFC 6266 and is what every modern
 * browser respects for non-ASCII names while preserving graceful fallback.
 */

const ATTACHMENT = 'attachment';

// Token characters allowed in the `filename=` quoted-string form. We replace
// disallowed characters in the ASCII fallback with `_`. The UTF-8 form
// preserves the original via percent-encoding.
const ASCII_RE = /^[\x20-\x7E]+$/;

function asciiFallback(name: string): string {
  // Strip newlines + replace each non-ASCII / forbidden char with '_', then
  // collapse runs and trim. Length cap at 200 to match the on-disk limits.
  const stripped = name
    .replace(/[\r\n\\"]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, 200);
  return stripped.length > 0 ? stripped : 'download.bin';
}

function rfc5987Encode(value: string): string {
  // encodeURIComponent + extra escapes mandated by RFC 5987 attr-char.
  return encodeURIComponent(value)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

/**
 * Build a Content-Disposition header value that forces a download with a
 * preserved filename. Always emits both forms; safe for all browsers.
 *
 * @param filename Human filename including extension (e.g. "Movie.mp4").
 *                 Must not be empty. Falls back to "download.bin" if invalid.
 */
export function attachmentContentDisposition(filename: string): string {
  const safeAscii = asciiFallback(filename);
  // The ASCII form is always quoted-string; we have already escaped quotes/backslashes.
  const asciiPart = ASCII_RE.test(safeAscii)
    ? `filename="${safeAscii}"`
    : `filename="download.bin"`;
  const utf8Part = `filename*=UTF-8''${rfc5987Encode(filename)}`;
  return `${ATTACHMENT}; ${asciiPart}; ${utf8Part}`;
}

/**
 * Convenience for inline (non-download) content with a filename hint.
 * Currently unused but exported for completeness.
 */
export function inlineContentDisposition(filename: string): string {
  return attachmentContentDisposition(filename).replace(/^attachment;/, 'inline;');
}
