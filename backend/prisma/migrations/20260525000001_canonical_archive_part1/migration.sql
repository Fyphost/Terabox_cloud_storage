-- Canonical-archive correction — Part 1 (additive only).
--
-- Why this is split in two:
--   * Part 1 (this file) is purely additive and safe to run while API and
--     workers are still on the old code path.
--   * Between Part 1 and Part 2 we run `npm run reconcile:archive` which
--     backfills the new SavedMedia columns, downloads source.mp4 for any
--     existing PERSISTED variants, relocates old per-variant storage keys
--     to the canonical media-prefixed layout, and mints ShareTokens.
--   * Part 2 then enforces NOT NULL, adds the new uniqueness, drops the
--     old uniqueness, and adds the new FK.
--
-- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS so this migration
-- is idempotent against minor drift between the baseline and the live
-- production schema.

-- ── Media: canonical source artifact + filename preservation ────────────────
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "originalFilename"      TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourceStorageKey"      TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourceSizeBytes"       BIGINT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourceSha256"          TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourceContentType"     TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourcePersistedAt"     TIMESTAMP(3);
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "sourcePendingDeleteAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Media_sourcePendingDeleteAt_idx"
    ON "Media"("sourcePendingDeleteAt");

-- ── SavedMedia: per-media identity + canonical quality choice ───────────────
-- These columns are added nullable. The reconciliation script backfills them;
-- Part 2 then promotes them to NOT NULL.
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "mediaId"           TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "selectedQuality"   TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "selectedVariantId" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3);

-- Bootstrap updatedAt for any existing rows so Part 2 can tighten it.
UPDATE "SavedMedia" SET "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP);

-- Index supports the per-media uniqueness check and saved-variant lookups.
CREATE INDEX IF NOT EXISTS "SavedMedia_selectedVariantId_idx"
    ON "SavedMedia"("selectedVariantId");

-- ── ShareToken: opaque permanent share links ────────────────────────────────
CREATE TABLE IF NOT EXISTS "ShareToken" (
    "token"        TEXT          NOT NULL,
    "savedMediaId" TEXT          NOT NULL,
    "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"    TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount"    INTEGER       NOT NULL DEFAULT 0,

    CONSTRAINT "ShareToken_pkey" PRIMARY KEY ("token")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShareToken_savedMediaId_key"
    ON "ShareToken"("savedMediaId");

CREATE INDEX IF NOT EXISTS "ShareToken_savedMediaId_idx"
    ON "ShareToken"("savedMediaId");

CREATE INDEX IF NOT EXISTS "ShareToken_revokedAt_idx"
    ON "ShareToken"("revokedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ShareToken_savedMediaId_fkey'
    ) THEN
        ALTER TABLE "ShareToken"
            ADD CONSTRAINT "ShareToken_savedMediaId_fkey"
            FOREIGN KEY ("savedMediaId") REFERENCES "SavedMedia"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
