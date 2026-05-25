/**
 * scripts/reconcile-archive.ts
 *
 * One-shot data reconciliation that bridges the legacy
 * "HLS-only, per-variant storage key" world to the new
 * "canonical source.mp4 + per-media HLS layout + share tokens" world.
 *
 * Runs AFTER 20260525000001_canonical_archive_part1 (additive columns/tables)
 * and BEFORE 20260525000002_canonical_archive_part2 (tighten NOT NULL +
 * uniqueness). Idempotent: rerunning is safe; rows already migrated are
 * skipped. Failures are isolated per row so one bad media never blocks the
 * batch.
 *
 * Steps:
 *   1. Backfill SavedMedia.mediaId + selectedQuality + selectedVariantId
 *      + updatedAt from the joined MediaVariant.
 *   2. Dedupe (userId, mediaId): when multiple legacy rows exist (because
 *      the old code allowed multi-quality saves), keep the highest-quality
 *      row and delete the rest.
 *   3. Relocate any PERSISTED variant whose storageKey is in the old
 *      `YYYY/MM/<variantId>` shape into the canonical
 *      `media/<mediaId>/hls/<quality>` shape, renaming bytes on disk and
 *      updating the DB.
 *   4. For every Media that still has at least one SavedMedia, ensure
 *      `Media.sourceStorageKey` exists. If not, re-extract metadata, stream
 *      the upstream `download` URL into `media/<mediaId>/source.mp4`,
 *      compute sha256/bytes, and update Media.
 *   5. Mint ShareToken rows for every SavedMedia that doesn't have one.
 *   6. Backfill `Media.originalFilename` from `Media.name` for any rows
 *      where it's null (best-effort filename preservation).
 *
 * Usage:
 *   tsx backend/scripts/reconcile-archive.ts [--dry-run] [--skip-source]
 *                                             [--limit N] [--media <id>]
 *
 * Flags:
 *   --dry-run       Print actions; do not write to DB or disk.
 *   --skip-source   Skip Step 4 (don't download source.mp4 — useful for fast
 *                   structural fixes; you can re-run later for sources).
 *   --limit N       Cap the number of medias processed in Step 4.
 *   --media <id>    Process only the given mediaId (useful for backfill of
 *                   one entry at a time after the first sweep).
 */

import { rename, mkdir, stat as fsStat } from 'node:fs/promises';
import { dirname, resolve as resolvePath, join as joinPath } from 'node:path';
import { Readable } from 'node:stream';

import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { disconnectRedis } from '../src/config/redis.js';
import { env } from '../src/config/env.js';
import { permanentStorage } from '../src/services/storage/index.js';
import { fetchTeraboxMetadata } from '../src/modules/ingest/terabox.client.js';
import { upstreamRequest } from '../src/lib/http.js';
import { newShareToken } from '../src/lib/ids.js';
import { logger } from '../src/lib/logger.js';
import {
  mediaSourceKey,
  mediaVariantHlsKey,
  isLegacyVariantStorageKey,
} from '../src/services/storage/keys.js';

// ── CLI ─────────────────────────────────────────────────────────────────────
interface Args {
  dryRun: boolean;
  skipSource: boolean;
  limit: number | null;
  onlyMedia: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, skipSource: false, limit: null, onlyMedia: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-source') out.skipSource = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.limit = Math.floor(n);
    } else if (a === '--media') {
      out.onlyMedia = argv[++i] ?? null;
    }
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const QUALITY_ORDER = ['audio', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'];

function qualityRank(q: string): number {
  const i = QUALITY_ORDER.indexOf(q);
  return i === -1 ? -1 : i;
}

function inferContentType(filename: string | null): string {
  if (!filename) return 'video/mp4';
  const ext = filename.toLowerCase();
  if (ext.endsWith('.mp4') || ext.endsWith('.m4v')) return 'video/mp4';
  if (ext.endsWith('.mkv')) return 'video/x-matroska';
  if (ext.endsWith('.webm')) return 'video/webm';
  if (ext.endsWith('.mov')) return 'video/quicktime';
  if (ext.endsWith('.mp3')) return 'audio/mpeg';
  if (ext.endsWith('.aac')) return 'audio/aac';
  return 'application/octet-stream';
}

function ensureExtension(name: string, contentType: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  if (contentType.startsWith('video/mp4')) return `${name}.mp4`;
  if (contentType.startsWith('video/x-matroska')) return `${name}.mkv`;
  if (contentType.startsWith('video/webm')) return `${name}.webm`;
  return `${name}.mp4`;
}

interface Counters {
  savedBackfilled: number;
  savedDeduped: number;
  variantsRelocated: number;
  sourcesPersisted: number;
  sourcesSkipped: number;
  tokensMinted: number;
  filenamesBackfilled: number;
  errors: number;
}

const counters: Counters = {
  savedBackfilled: 0,
  savedDeduped: 0,
  variantsRelocated: 0,
  sourcesPersisted: 0,
  sourcesSkipped: 0,
  tokensMinted: 0,
  filenamesBackfilled: 0,
  errors: 0,
};

// ── Step 1. Backfill SavedMedia.{mediaId, selectedQuality, selectedVariantId, updatedAt} ──
async function backfillSavedMedia(args: Args): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<
    { id: string; mediaVariantId: string; mediaId: string | null; selectedQuality: string | null }[]
  >(
    `SELECT sm."id", sm."mediaVariantId", sm."mediaId", sm."selectedQuality"
       FROM "SavedMedia" sm
      WHERE sm."mediaId" IS NULL OR sm."selectedQuality" IS NULL OR sm."selectedVariantId" IS NULL`,
  );

  if (rows.length === 0) return;
  logger.info({ count: rows.length }, 'reconcile: backfilling SavedMedia');

  for (const row of rows) {
    if (args.dryRun) {
      counters.savedBackfilled++;
      continue;
    }
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "SavedMedia"
          SET "mediaId" = mv."mediaId",
              "selectedQuality" = mv."quality",
              "selectedVariantId" = sm."mediaVariantId",
              "updatedAt" = COALESCE("SavedMedia"."updatedAt", "SavedMedia"."createdAt", CURRENT_TIMESTAMP)
         FROM "SavedMedia" sm
         JOIN "MediaVariant" mv ON mv."id" = sm."mediaVariantId"
        WHERE "SavedMedia"."id" = $1
          AND sm."id" = "SavedMedia"."id"`,
      row.id,
    );
    counters.savedBackfilled += updated;
  }
}

// ── Step 2. Dedupe (userId, mediaId) ────────────────────────────────────────
async function dedupeSavedMedia(args: Args): Promise<void> {
  // Find groups with > 1 SavedMedia for the same (userId, mediaId).
  const groups = await prisma.$queryRawUnsafe<{ userId: string; mediaId: string; n: bigint }[]>(
    `SELECT "userId", "mediaId", COUNT(*)::bigint AS n
       FROM "SavedMedia"
      WHERE "mediaId" IS NOT NULL
      GROUP BY "userId", "mediaId"
     HAVING COUNT(*) > 1`,
  );

  for (const g of groups) {
    const rows = await prisma.$queryRawUnsafe<
      { id: string; selectedQuality: string | null; createdAt: Date; state: string }[]
    >(
      `SELECT "id", "selectedQuality", "createdAt", "state"
         FROM "SavedMedia"
        WHERE "userId" = $1 AND "mediaId" = $2
        ORDER BY "createdAt" ASC`,
      g.userId,
      g.mediaId,
    );

    // Keep the row with the highest quality (ties: most recent). Prefer COMPLETE.
    const sorted = [...rows].sort((a, b) => {
      const sa = a.state === 'COMPLETE' ? 1 : 0;
      const sb = b.state === 'COMPLETE' ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const qa = qualityRank(a.selectedQuality ?? '');
      const qb = qualityRank(b.selectedQuality ?? '');
      if (qa !== qb) return qb - qa;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const winner = sorted[0]!;
    const losers = sorted.slice(1);

    logger.info(
      { userId: g.userId, mediaId: g.mediaId, winner: winner.id, losers: losers.map((l) => l.id) },
      'reconcile: dedup SavedMedia',
    );

    if (args.dryRun) {
      counters.savedDeduped += losers.length;
      continue;
    }

    for (const loser of losers) {
      await prisma.$executeRawUnsafe(`DELETE FROM "SavedMedia" WHERE "id" = $1`, loser.id);
      counters.savedDeduped++;
    }
  }
}

// ── Step 3. Relocate legacy storage keys ────────────────────────────────────
async function relocateLegacyVariants(args: Args): Promise<void> {
  const variants = await prisma.$queryRawUnsafe<
    { id: string; mediaId: string; quality: string; storageKey: string | null; state: string }[]
  >(
    `SELECT "id", "mediaId", "quality", "storageKey", "state"
       FROM "MediaVariant"
      WHERE "state" IN ('PERSISTED', 'PENDING_DELETE')
        AND "storageKey" IS NOT NULL`,
  );

  const root = resolvePath(env.STORAGE_PERMANENT_DIR);

  for (const v of variants) {
    const oldKey = v.storageKey!;
    if (!isLegacyVariantStorageKey(oldKey)) continue;

    const newKey = mediaVariantHlsKey(v.mediaId, v.quality);
    const oldPath = joinPath(root, oldKey);
    const newPath = joinPath(root, newKey);

    const exists = await fsStat(oldPath).catch(() => null);
    if (!exists) {
      // Old directory missing on disk. DB still references it — repoint to
      // canonical key anyway so future writes go to the right place; the
      // worker will refetch missing bytes on demand.
      logger.warn({ variantId: v.id, oldPath }, 'reconcile: legacy storage missing on disk');
      if (!args.dryRun) {
        await prisma.$executeRawUnsafe(
          `UPDATE "MediaVariant" SET "storageKey" = $1 WHERE "id" = $2`,
          newKey,
          v.id,
        );
      }
      counters.variantsRelocated++;
      continue;
    }

    if (args.dryRun) {
      counters.variantsRelocated++;
      continue;
    }

    try {
      await mkdir(dirname(newPath), { recursive: true });
      await rename(oldPath, newPath);
      await prisma.$executeRawUnsafe(
        `UPDATE "MediaVariant" SET "storageKey" = $1 WHERE "id" = $2`,
        newKey,
        v.id,
      );
      counters.variantsRelocated++;
      logger.info({ variantId: v.id, oldKey, newKey }, 'reconcile: relocated variant storage');
    } catch (err) {
      counters.errors++;
      logger.error({ err, variantId: v.id, oldPath, newPath }, 'reconcile: relocate failed');
    }
  }
}

// ── Step 4. Persist source.mp4 for any media with at least one save ─────────
async function persistMissingSources(args: Args): Promise<void> {
  if (args.skipSource) {
    logger.info('reconcile: --skip-source, skipping Step 4');
    return;
  }

  const where = args.onlyMedia ? `AND m."id" = '${args.onlyMedia.replace(/'/g, "''")}'` : '';
  const limit = args.limit ? `LIMIT ${args.limit}` : '';

  const medias = await prisma.$queryRawUnsafe<
    { id: string; sourceUrl: string; name: string }[]
  >(
    `SELECT DISTINCT m."id", m."sourceUrl", m."name"
       FROM "Media" m
       JOIN "SavedMedia" sm ON sm."mediaId" = m."id"
      WHERE m."sourceStorageKey" IS NULL
        ${where}
      ORDER BY m."id"
      ${limit}`,
  );

  logger.info({ count: medias.length }, 'reconcile: candidates needing source.mp4');

  for (const m of medias) {
    if (args.dryRun) {
      counters.sourcesPersisted++;
      continue;
    }

    try {
      // Re-extract upstream metadata to get a fresh `download` URL.
      const meta = await fetchTeraboxMetadata(m.sourceUrl);
      const downloadUrl = meta.download;
      if (!downloadUrl) {
        logger.warn({ mediaId: m.id }, 'reconcile: extractor returned no download URL — skipping');
        counters.sourcesSkipped++;
        continue;
      }

      // Stream upstream → permanent storage atomically (LocalDiskBackend
      // writes to `<key>.partial-...` and renames on completion + computes sha256).
      let resp = await upstreamRequest(downloadUrl, { method: 'GET' });
      if (resp.statusCode === 403 || resp.statusCode === 404) {
        resp.body.resume();
        // The metadata we just fetched is likely valid; the download URL may
        // require a different headers profile. As a defensive retry, ask
        // again with a UA hint.
        resp = await upstreamRequest(downloadUrl, {
          method: 'GET',
          headers: { 'user-agent': 'fyphost/1.0 (+reconcile)' },
        });
      }
      if (resp.statusCode >= 400) {
        resp.body.resume();
        counters.errors++;
        logger.error(
          { mediaId: m.id, statusCode: resp.statusCode },
          'reconcile: upstream download failed',
        );
        continue;
      }

      const contentType =
        (resp.headers['content-type'] as string | undefined) ?? inferContentType(meta.name);
      const filename = ensureExtension(meta.name || m.name, contentType);
      const key = mediaSourceKey(m.id, contentType);

      const result = await permanentStorage().write(key, Readable.from(resp.body), {
        contentType,
      });

      await prisma.$executeRawUnsafe(
        `UPDATE "Media"
            SET "sourceStorageKey"   = $1,
                "sourceSizeBytes"    = $2,
                "sourceSha256"       = $3,
                "sourceContentType"  = $4,
                "sourcePersistedAt"  = CURRENT_TIMESTAMP,
                "originalFilename"   = COALESCE("originalFilename", $5)
          WHERE "id" = $6`,
        key,
        BigInt(result.bytes),
        result.sha256,
        contentType,
        filename,
        m.id,
      );

      counters.sourcesPersisted++;
      logger.info(
        { mediaId: m.id, key, bytes: result.bytes, sha256: result.sha256 },
        'reconcile: source persisted',
      );
    } catch (err) {
      counters.errors++;
      logger.error({ err, mediaId: m.id }, 'reconcile: source persist failed');
    }
  }
}

// ── Step 5. Mint share tokens ───────────────────────────────────────────────
async function mintShareTokens(args: Args): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ savedMediaId: string }[]>(
    `SELECT sm."id" AS "savedMediaId"
       FROM "SavedMedia" sm
       LEFT JOIN "ShareToken" st ON st."savedMediaId" = sm."id"
      WHERE st."token" IS NULL`,
  );

  for (const r of rows) {
    if (args.dryRun) {
      counters.tokensMinted++;
      continue;
    }
    const token = newShareToken();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ShareToken" ("token", "savedMediaId", "createdAt")
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT ("savedMediaId") DO NOTHING`,
      token,
      r.savedMediaId,
    );
    counters.tokensMinted++;
  }
}

// ── Step 6. Backfill originalFilename ───────────────────────────────────────
async function backfillFilenames(args: Args): Promise<void> {
  if (args.dryRun) {
    const n = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "Media" WHERE "originalFilename" IS NULL`,
    );
    counters.filenamesBackfilled = Number(n[0]?.n ?? 0n);
    return;
  }
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Media"
        SET "originalFilename" =
            CASE
              WHEN "name" ~ '\\.[a-z0-9]{2,5}$' THEN "name"
              ELSE "name" || '.mp4'
            END
      WHERE "originalFilename" IS NULL`,
  );
  counters.filenamesBackfilled = updated;
}

// ── Driver ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  logger.info({ args }, 'reconcile: starting');

  await backfillSavedMedia(args);
  await dedupeSavedMedia(args);
  await relocateLegacyVariants(args);
  await persistMissingSources(args);
  await mintShareTokens(args);
  await backfillFilenames(args);

  logger.info({ counters, dryRun: args.dryRun }, 'reconcile: complete');
}

main()
  .catch((err) => {
    logger.fatal({ err }, 'reconcile: fatal');
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => undefined);
    await disconnectRedis().catch(() => undefined);
  });
