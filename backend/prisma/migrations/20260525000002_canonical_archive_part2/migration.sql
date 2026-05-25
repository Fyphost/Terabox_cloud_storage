-- Canonical-archive correction — Part 2 (tighten).
--
-- Run this AFTER `npm run reconcile:archive` finishes successfully.
-- It fails fast (and rolls back) if any row still has NULL where it should
-- now be non-null. That is intentional: a failure here means the
-- reconciliation script left work undone, and applying the constraint would
-- mask data corruption.

BEGIN;

-- Sanity: refuse to proceed with un-backfilled rows.
DO $$
DECLARE
    bad INTEGER;
BEGIN
    SELECT COUNT(*) INTO bad
        FROM "SavedMedia"
        WHERE "mediaId" IS NULL OR "selectedQuality" IS NULL OR "updatedAt" IS NULL;
    IF bad > 0 THEN
        RAISE EXCEPTION 'SavedMedia has % rows with NULL mediaId/selectedQuality/updatedAt. Run scripts/reconcile-archive.ts first.', bad;
    END IF;
END $$;

-- ── Promote SavedMedia columns to NOT NULL ──────────────────────────────────
ALTER TABLE "SavedMedia" ALTER COLUMN "mediaId"         SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "selectedQuality" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "updatedAt"       SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "updatedAt"       SET DEFAULT CURRENT_TIMESTAMP;

-- ── Make legacy mediaVariantId nullable so it can be SET NULL on cascade. ──
-- The new `selectedVariantId` (with ON DELETE SET NULL) replaces it as the
-- pinned-quality pointer. We keep the column for one release for safety, but
-- never write to it from new code.
ALTER TABLE "SavedMedia" ALTER COLUMN "mediaVariantId" DROP NOT NULL;

-- Drop the legacy uniqueness now that one-save-per-(user, media) is the rule.
DROP INDEX IF EXISTS "SavedMedia_userId_mediaVariantId_key";

-- ── New per-media uniqueness ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "SavedMedia_userId_mediaId_key"
    ON "SavedMedia"("userId", "mediaId");

-- ── Foreign keys for the new relations ──────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SavedMedia_mediaId_fkey'
    ) THEN
        ALTER TABLE "SavedMedia"
            ADD CONSTRAINT "SavedMedia_mediaId_fkey"
            FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SavedMedia_selectedVariantId_fkey'
    ) THEN
        ALTER TABLE "SavedMedia"
            ADD CONSTRAINT "SavedMedia_selectedVariantId_fkey"
            FOREIGN KEY ("selectedVariantId") REFERENCES "MediaVariant"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
