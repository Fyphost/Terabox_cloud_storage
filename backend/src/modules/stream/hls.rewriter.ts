/**
 * HLS playlist rewriter.
 *
 * Parses an m3u8 playlist (master or media) and rewrites all URI lines so
 * the player only ever talks to Fyphost. The rewriter is line-oriented and
 * format-preserving — we never re-emit unknown tags.
 *
 * Two modes:
 *  - rewriteMediaPlaylist: TS/m4s segment URIs become /stream/:variantId/segment/:n
 *  - rewriteMasterPlaylist: variant-stream URIs become /stream/:variantId/playlist.m3u8
 *
 * Any URI tag with attribute lists (EXT-X-MAP, EXT-X-KEY) has its URI="..."
 * attribute rewritten in place.
 */

export interface SegmentRewrite {
  /** index of the segment in the playlist (0-based, in document order). */
  index: number;
  /** original absolute or relative URI as found in the playlist. */
  originalUri: string;
}

export interface RewriteMediaResult {
  body: string;
  segments: SegmentRewrite[];
}

export type SegmentUrlBuilder = (seg: SegmentRewrite) => string;
export type VariantPlaylistUrlBuilder = (variantId: string) => string;
export type KeyOrMapUrlBuilder = (kind: 'key' | 'map', originalUri: string, index: number) => string;

const URI_TAGS_WITH_ATTR = new Set(['#EXT-X-MAP', '#EXT-X-KEY', '#EXT-X-SESSION-KEY', '#EXT-X-PART']);

function resolveUri(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref) || ref.startsWith('//')) return ref;
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

/** Rewrite URI="..." inside an attribute-list tag line. */
function rewriteAttrUri(
  line: string,
  base: string,
  index: number,
  builder: KeyOrMapUrlBuilder,
  kind: 'key' | 'map',
): string {
  return line.replace(/URI="([^"]+)"/i, (_m, ref: string) => {
    const abs = resolveUri(base, ref);
    return `URI="${builder(kind, abs, index)}"`;
  });
}

export function rewriteMediaPlaylist(
  playlistText: string,
  baseUrl: string,
  buildSegmentUrl: SegmentUrlBuilder,
  buildAuxUrl?: KeyOrMapUrlBuilder,
): RewriteMediaResult {
  const out: string[] = [];
  const segs: SegmentRewrite[] = [];
  const lines = playlistText.split(/\r?\n/);
  let segIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length === 0) {
      out.push(line);
      continue;
    }

    if (line.startsWith('#')) {
      const tag = line.split(':', 1)[0]!;
      if (URI_TAGS_WITH_ATTR.has(tag) && buildAuxUrl) {
        const kind = tag === '#EXT-X-KEY' || tag === '#EXT-X-SESSION-KEY' ? 'key' : 'map';
        out.push(rewriteAttrUri(line, baseUrl, segIndex, buildAuxUrl, kind));
      } else {
        out.push(line);
      }
      continue;
    }

    // Segment URI line.
    const originalAbs = resolveUri(baseUrl, line);
    const seg: SegmentRewrite = { index: segIndex, originalUri: originalAbs };
    segs.push(seg);
    out.push(buildSegmentUrl(seg));
    segIndex++;
  }

  return { body: out.join('\n'), segments: segs };
}

export interface VariantInfo {
  variantId: string;
  /** the upstream playlist URL for this variant (absolute). */
  upstreamUrl: string;
  /** Optional pre-known stream attributes for synthetic master generation. */
  bandwidth?: number;
  resolution?: string; // e.g. "1280x720"
  codecs?: string;
}

/**
 * Rewrite a master playlist's variant URIs to point at our /stream/:varId/playlist.m3u8.
 * The mapping from upstream URI → variantId is provided externally.
 */
export function rewriteMasterPlaylist(
  playlistText: string,
  baseUrl: string,
  resolveVariantId: (upstreamUri: string) => string | null,
  buildVariantPlaylistUrl: VariantPlaylistUrlBuilder,
): string {
  const lines = playlistText.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) {
      out.push(line);
      continue;
    }
    const abs = resolveUri(baseUrl, line);
    const variantId = resolveVariantId(abs);
    out.push(variantId ? buildVariantPlaylistUrl(variantId) : line);
  }
  return out.join('\n');
}

/**
 * Build a synthetic master playlist from a known set of variants. Used when
 * the upstream extractor returns per-quality media playlists rather than a
 * single master.
 */
export function buildSyntheticMaster(
  variants: VariantInfo[],
  buildVariantPlaylistUrl: VariantPlaylistUrlBuilder,
): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const v of variants) {
    const attrs: string[] = [];
    attrs.push(`BANDWIDTH=${v.bandwidth ?? 800_000}`);
    if (v.resolution) attrs.push(`RESOLUTION=${v.resolution}`);
    if (v.codecs) attrs.push(`CODECS="${v.codecs}"`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`);
    lines.push(buildVariantPlaylistUrl(v.variantId));
  }
  lines.push('');
  return lines.join('\n');
}
