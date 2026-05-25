/**
 * modules/share/share.service.ts
 *
 * Permanent share-token system.
 *
 * Why this exists
 * ─────────────────────────────────────────────────────────────────────────────
 * Library URLs in the previous design exposed signed playback URLs directly.
 * Those URLs expire (6h default), so any "share" flow that copied a library
 * URL broke as soon as the token aged out. The fix is a layer of indirection:
 *
 *   Public, opaque ShareToken  ──►  SavedMedia  ──►  Media + variants
 *                                                   ──►  freshly-signed URLs
 *                                                        on every fetch
 *
 * The token never expires while the SavedMedia exists. The signed URLs the
 * client uses to actually fetch bytes ARE short-lived — the share endpoint
 * mints fresh ones on every read. So the share is permanent without ever
 * leaking a direct stream URL outside the API surface.
 *
 * Tokens are 32-char nanoid (~190 bits of entropy) so brute-forcing is
 * infeasible.
 */

import type { Media, MediaVariant, ShareToken } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { newShareToken } from '../../lib/ids.js';
import { env } from '../../config/env.js';
import { presentMedia, type PresentedMedia } from '../media/media.service.js';

export interface ShareTokenInfo {
  token: string;
  shareUrl: string;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
}

export interface SharedMedia {
  share: ShareTokenInfo;
  selectedQuality: string;
  selectedVariantId: string | null;
  media: PresentedMedia;
}

function shareUrlFor(token: string): string {
  // Frontend share page lives at PUBLIC_BASE_URL/share/<token>. We assume the
  // web app is served from the same origin as the API (or behind the same
  // edge proxy). If you split the two, override SHARE_PUBLIC_BASE_URL or
  // construct the URL on the frontend instead.
  return `${env.PUBLIC_BASE_URL.replace(/\/api\/v1\/?$/, '')}/share/${token}`;
}

function tokenInfo(t: ShareToken): ShareTokenInfo {
  return {
    token: t.token,
    shareUrl: shareUrlFor(t.token),
    createdAt: t.createdAt.toISOString(),
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
    viewCount: t.viewCount,
  };
}

/**
 * Get an existing token for a SavedMedia, or mint a new one. Idempotent —
 * called both by the save service (initial mint) and by the explicit
 * "Share" button on the frontend.
 */
export async function getOrCreateShareToken(
  savedMediaId: string,
  userId: string,
): Promise<ShareTokenInfo> {
  const sm = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: { shareToken: true },
  });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Saved media not found');

  if (sm.shareToken && !sm.shareToken.revokedAt) {
    return tokenInfo(sm.shareToken);
  }

  // If there's a revoked token, leave it alone and mint a new one (the old
  // one stays in the table as audit). The unique on savedMediaId means we
  // need to clear or replace; rotation = revoke-then-recreate.
  if (sm.shareToken && sm.shareToken.revokedAt) {
    await prisma.shareToken.delete({ where: { savedMediaId } }).catch(() => undefined);
  }

  const token = newShareToken();
  const created = await prisma.shareToken.create({
    data: { token, savedMediaId },
  });
  return tokenInfo(created);
}

export async function revokeShareToken(savedMediaId: string, userId: string): Promise<void> {
  const sm = await prisma.savedMedia.findUnique({
    where: { id: savedMediaId },
    include: { shareToken: true },
  });
  if (!sm || sm.userId !== userId) throw new AppError('NOT_FOUND', 'Saved media not found');
  if (!sm.shareToken) return;
  await prisma.shareToken.update({
    where: { savedMediaId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolve a public share token to its media presentation. Increments
 * viewCount asynchronously — failure to increment never breaks playback.
 */
export async function resolveShareToken(token: string): Promise<SharedMedia> {
  const st = await prisma.shareToken.findUnique({
    where: { token },
    include: {
      savedMedia: {
        include: {
          media: { include: { variants: true } },
          selectedVariant: true,
        },
      },
    },
  });
  if (!st) throw new AppError('NOT_FOUND', 'Share link not found');
  if (st.revokedAt) throw new AppError('FORBIDDEN', 'This share link has been revoked');

  const sm = st.savedMedia;
  if (!sm) throw new AppError('NOT_FOUND', 'Share target missing');

  const media = sm.media;
  const variants: MediaVariant[] = media.variants;
  // Sign URLs with `userId = null` (anonymous). The token itself is the
  // capability. Browser cookies are NOT required to play a shared media.
  const presented = await presentMedia(media as Media, variants, null);

  // Async fire-and-forget bookkeeping.
  void prisma.shareToken
    .update({
      where: { token: st.token },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    })
    .catch(() => undefined);

  return {
    share: tokenInfo(st),
    selectedQuality: sm.selectedQuality,
    selectedVariantId: sm.selectedVariantId,
    media: presented,
  };
}
