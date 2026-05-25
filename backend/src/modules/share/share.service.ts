/**
 * Share service — permanent public sharing via opaque tokens.
 *
 * Architecture:
 *   - Each ShareToken row maps a unique opaque string to a SavedMedia.
 *   - The public route /share/:token resolves the token → generates fresh
 *     signed playback URLs dynamically. The token itself never expires
 *     (unless expiresAt is set), but the playback URLs it generates are
 *     short-lived signed URLs — so raw storage paths are never exposed.
 *   - Users can create/revoke share tokens from their library.
 */

import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { newShareToken, newShareTokenId } from '../../lib/ids.js';
import { buildLibrarySignedUrl } from '../../services/signing/signed-url.js';

export interface CreateShareInput {
  userId: string;
  savedMediaId: string;
  quality?: string;
}

export interface ShareTokenResponse {
  id: string;
  token: string;
  savedMediaId: string;
  quality: string | null;
  enabled: boolean;
  createdAt: string;
  shareUrl: string;
}

export interface PublicShareView {
  mediaName: string;
  thumbnailUrl: string | null;
  quality: string | null;
  masterPlaylistUrl: string | null;
  downloadUrl: string | null;
}

export async function createShareToken(input: CreateShareInput): Promise<ShareTokenResponse> {
  // Verify ownership
  const sm = await prisma.savedMedia.findUnique({
    where: { id: input.savedMediaId },
  });
  if (!sm || sm.userId !== input.userId) {
    throw new AppError('NOT_FOUND', 'Saved media not found');
  }

  const token = newShareToken();
  const row = await prisma.shareToken.create({
    data: {
      id: newShareTokenId(),
      savedMediaId: input.savedMediaId,
      token,
      quality: input.quality ?? null,
      enabled: true,
    },
  });

  return {
    id: row.id,
    token: row.token,
    savedMediaId: row.savedMediaId,
    quality: row.quality,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    shareUrl: `/share/${row.token}`,
  };
}

export async function revokeShareToken(tokenId: string, userId: string): Promise<void> {
  const row = await prisma.shareToken.findUnique({
    where: { id: tokenId },
    include: { saved: true },
  });
  if (!row || row.saved.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Share token not found');
  }
  await prisma.shareToken.update({
    where: { id: tokenId },
    data: { enabled: false },
  });
}

export async function listShareTokens(savedMediaId: string, userId: string): Promise<ShareTokenResponse[]> {
  const sm = await prisma.savedMedia.findUnique({ where: { id: savedMediaId } });
  if (!sm || sm.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Saved media not found');
  }
  const tokens = await prisma.shareToken.findMany({
    where: { savedMediaId, enabled: true },
    orderBy: { createdAt: 'desc' },
  });
  return tokens.map((t) => ({
    id: t.id,
    token: t.token,
    savedMediaId: t.savedMediaId,
    quality: t.quality,
    enabled: t.enabled,
    createdAt: t.createdAt.toISOString(),
    shareUrl: `/share/${t.token}`,
  }));
}

/**
 * Resolve a public share token into fresh signed playback URLs.
 * This is the PUBLIC route — no auth required.
 */
export async function resolveShareToken(token: string): Promise<PublicShareView> {
  const row = await prisma.shareToken.findUnique({
    where: { token },
    include: {
      saved: {
        include: {
          media: true,
          variants: {
            include: { variant: true },
          },
        },
      },
    },
  });

  if (!row || !row.enabled) {
    throw new AppError('NOT_FOUND', 'Share link not found or has been revoked');
  }

  // Check expiry
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new AppError('NOT_FOUND', 'Share link has expired');
  }

  // Increment access count (fire-and-forget)
  prisma.shareToken.update({
    where: { id: row.id },
    data: { accessCount: { increment: 1 } },
  }).catch(() => undefined);

  const media = row.saved.media;
  const savedMediaId = row.saved.id;

  // Find a persisted variant for playback
  const persistedVariants = row.saved.variants
    .filter((sv) => sv.variant.state === 'PERSISTED')
    .map((sv) => sv.variant);

  // Use the share's quality preference, or the saved canonical, or first persisted
  const targetQuality = row.quality ?? row.saved.canonicalQuality;
  const selectedVariant = targetQuality
    ? persistedVariants.find((v) => v.quality === targetQuality) ?? persistedVariants[0]
    : persistedVariants[0];

  let masterPlaylistUrl: string | null = null;
  let downloadUrl: string | null = null;

  if (persistedVariants.length > 0) {
    // Generate fresh signed URLs — these expire in 6h but the share token itself is permanent
    masterPlaylistUrl = buildLibrarySignedUrl(savedMediaId, 'master.m3u8');
  }

  if (selectedVariant) {
    downloadUrl = buildLibrarySignedUrl(
      savedMediaId,
      `variant/${selectedVariant.id}/download`,
    );
  }

  return {
    mediaName: media.name,
    thumbnailUrl: media.thumbnailUrl,
    quality: selectedVariant?.quality ?? null,
    masterPlaylistUrl,
    downloadUrl,
  };
}
