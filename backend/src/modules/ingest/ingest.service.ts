import { createHash } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { newMediaId, newVariantId } from '../../lib/ids.js';
import { fetchTeraboxMetadata, parseHumanSize } from './terabox.client.js';
import type { Media, MediaVariant } from '@prisma/client';

const QUALITY_BANDWIDTH: Record<string, number> = {
  '240p': 300_000,
  '360p': 500_000,
  '480p': 900_000,
  '720p': 2_000_000,
  '1080p': 4_500_000,
  '1440p': 8_000_000,
  '2160p': 16_000_000,
};

const QUALITY_RESOLUTION: Record<string, { w: number; h: number }> = {
  '240p': { w: 426, h: 240 },
  '360p': { w: 640, h: 360 },
  '480p': { w: 854, h: 480 },
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
  '2160p': { w: 3840, h: 2160 },
};

export interface IngestResult {
  media: Media;
  variants: MediaVariant[];
}

function normalizeUrl(input: string): string {
  // Conservative normalize: strip fragment, trailing slash, lowercase host.
  try {
    const u = new URL(input.trim());
    u.hash = '';
    if (u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
    u.host = u.host.toLowerCase();
    return u.toString();
  } catch {
    return input.trim();
  }
}

function hashSourceUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export async function ingestUrl(rawUrl: string): Promise<IngestResult> {
  const url = normalizeUrl(rawUrl);
  const sourceHash = hashSourceUrl(url);

  // Dedup: return cached Media if present and recent.
  const existing = await prisma.media.findUnique({
    where: { sourceHash },
    include: { variants: true },
  });

  // Refresh policy: re-extract if older than 30 minutes (upstream URLs expire).
  const isStale =
    !existing ||
    Date.now() - existing.metadataRefreshedAt.getTime() > 30 * 60 * 1000 ||
    existing.variants.length === 0;

  if (existing && !isStale) {
    return { media: existing, variants: existing.variants };
  }

  const meta = await fetchTeraboxMetadata(url);
  const sizeBytes = parseHumanSize(meta.size);
  const streams: Record<string, string> = meta.streams ?? {};
  if (Object.keys(streams).length === 0 && meta.stream && meta.quality) {
    streams[meta.quality] = meta.stream;
  }

  return prisma.$transaction(async (tx) => {
    const media = await tx.media.upsert({
      where: { sourceHash },
      create: {
        id: newMediaId(),
        sourceHash,
        sourceUrl: url,
        name: meta.name,
        sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
        thumbnailUrl: meta.thumbnail ?? null,
        metadataRefreshedAt: new Date(),
      },
      update: {
        name: meta.name,
        sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
        thumbnailUrl: meta.thumbnail ?? null,
        metadataRefreshedAt: new Date(),
      },
    });

    // Upsert variants by (mediaId, quality), preserving state for already-saved.
    const variantRows: MediaVariant[] = [];
    for (const [quality, playlistUrl] of Object.entries(streams)) {
      const existingVar = await tx.mediaVariant.findUnique({
        where: { mediaId_quality: { mediaId: media.id, quality } },
      });
      const res = QUALITY_RESOLUTION[quality];
      const bw = QUALITY_BANDWIDTH[quality] ?? null;
      if (existingVar) {
        const updated = await tx.mediaVariant.update({
          where: { id: existingVar.id },
          data: {
            upstreamPlaylistUrl: playlistUrl,
            upstreamRefreshedAt: new Date(),
            ...(res ? { width: res.w, height: res.h } : {}),
            ...(bw ? { bitrateBps: bw } : {}),
          },
        });
        variantRows.push(updated);
      } else {
        const created = await tx.mediaVariant.create({
          data: {
            id: newVariantId(),
            mediaId: media.id,
            quality,
            container: 'HLS',
            upstreamPlaylistUrl: playlistUrl,
            upstreamFileUrl: meta.download ?? null,
            upstreamRefreshedAt: new Date(),
            width: res?.w ?? null,
            height: res?.h ?? null,
            bitrateBps: bw,
          },
        });
        variantRows.push(created);
      }
    }

    return { media, variants: variantRows };
  });
}

/** Re-extract upstream URLs for a single variant (called on 403/404 in stream proxy). */
export async function refreshVariantUpstream(variantId: string): Promise<string | null> {
  const variant = await prisma.mediaVariant.findUnique({
    where: { id: variantId },
    include: { media: true },
  });
  if (!variant) return null;

  const meta = await fetchTeraboxMetadata(variant.media.sourceUrl).catch(() => null);
  if (!meta) return null;
  const newUrl = meta.streams?.[variant.quality] ?? meta.stream ?? null;
  if (!newUrl) return null;

  await prisma.mediaVariant.update({
    where: { id: variantId },
    data: {
      upstreamPlaylistUrl: newUrl,
      upstreamRefreshedAt: new Date(),
    },
  });
  await prisma.media.update({
    where: { id: variant.mediaId },
    data: { metadataRefreshedAt: new Date() },
  });
  return newUrl;
}
