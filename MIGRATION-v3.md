# Migration to v3: persistence rebuild

This release reshapes the data model around **media-rooted permanent storage**
and introduces a true transactional save pipeline.  Read this before running
`prisma migrate` in production.

## What changes

### Storage layout

Before (per-variant directory, year/month bucketed):

    permanent/2026/05/{variantId}/playlist.m3u8
    permanent/2026/05/{variantId}/seg-0.ts

After (media-rooted, shared assets at the root):

    permanent/media/{mediaId}/metadata.json
    permanent/media/{mediaId}/thumb.jpg
    permanent/media/{mediaId}/poster.jpg
    permanent/media/{mediaId}/hls/master.m3u8
    permanent/media/{mediaId}/hls/720p/playlist.m3u8
    permanent/media/{mediaId}/hls/720p/seg-0.ts
    permanent/media/{mediaId}/hls/1080p/playlist.m3u8
    permanent/media/{mediaId}/.staging/{variantId}/...   (transient)

Implications:

  - The cache root (`STORAGE_CACHE_DIR`) is unchanged and still per-variant.
  - Migrating existing PERSISTED bytes requires moving each variant's
    directory into `media/{mediaId}/hls/{quality}/`. See "Backfill" below.

### Schema

  - `Media`
      + `storageKey`, `metadataKey`, `thumbnailKey`, `posterKey`,
        `originalKey`, `masterPlaylistKey` columns.

  - `MediaVariant`
      + `hlsPlaylistKey`, `hlsSegmentDir`, `fileKey`, `segmentCount`,
        `pipelineStep`, `progress`, `bytesDone`, `bytesTotal`,
        `speedBytesPerSec`, `etaSec`, `errorMessage`, `attemptCount`.
      − `storageKey` (moved to `Media`).
      `state` enum gains `PENDING`, `FETCHING`, `DOWNLOADING`,
      `GENERATING_HLS`, `GENERATING_THUMBNAIL`, `FINALIZING`.

  - `SavedMedia`
      Unique key changes from `(userId, mediaVariantId)` to `(userId, mediaId)`.
      `state` enum changes: PENDING / IN_PROGRESS / COMPLETE / PARTIAL / FAILED.
      − `mediaVariantId`, `progress`, `jobId`, `error` (moved to per-variant).

  - `SavedVariant` (new)
      Join table tying a `SavedMedia` row to one or more `MediaVariant` rows.

## Recommended migration order

1. **Snapshot** the database and `STORAGE_PERMANENT_DIR`.
2. Apply Prisma migrations:

       npx prisma migrate deploy   # production
       # or in dev:
       npx prisma migrate dev --name persistence_rebuild

3. **Backfill `Media.storageKey`** for any rows that already have persisted
   variants:

       UPDATE "Media" SET "storageKey" = 'media/' || id WHERE id IN (
         SELECT DISTINCT "mediaId" FROM "MediaVariant" WHERE state = 'PERSISTED'
       );

4. **Move existing PERSISTED bytes** into the new layout. A one-shot script
   (run from the API box):

       for mediaId in $(psql -At -c "SELECT id FROM \"Media\" WHERE \"storageKey\" IS NOT NULL"); do
         mkdir -p "/var/lib/fyphost/permanent/media/$mediaId/hls"
         # for each PERSISTED variant of $mediaId, mv old/{variantId} → media/$mediaId/hls/{quality}
       done

   The exact mv commands are environment-specific; the worker has been
   designed so that any PERSISTED variants without proper `hlsPlaylistKey`
   set will be cleaned up to EPHEMERAL on next pass and re-saved on demand.
   Re-saving is the safest path if your library is small.

5. **Backfill `SavedVariant`**:

       INSERT INTO "SavedVariant" (id, "savedMediaId", "mediaVariantId", "createdAt")
       SELECT 'svr_' || substr(md5(random()::text), 1, 18), s.id, s."mediaVariantId", s."createdAt"
       FROM "SavedMedia" s
       WHERE NOT EXISTS (
         SELECT 1 FROM "SavedVariant" sv WHERE sv."savedMediaId" = s.id
       );

6. **Collapse duplicate SavedMedia rows** (same (userId, mediaId), one per
   variant in v2):

       -- Pick the oldest row per (userId, mediaId) as canonical, point all
       -- SavedVariants at it, drop the duplicates.
       WITH canon AS (
         SELECT DISTINCT ON ("userId", "mediaId") id, "userId", "mediaId"
         FROM "SavedMedia" ORDER BY "userId", "mediaId", "createdAt" ASC
       )
       UPDATE "SavedVariant" sv
         SET "savedMediaId" = canon.id
         FROM canon
         JOIN "SavedMedia" old ON old."userId" = canon."userId"
                             AND old."mediaId" = canon."mediaId"
         WHERE sv."savedMediaId" = old.id AND old.id <> canon.id;

       DELETE FROM "SavedMedia" sm
         WHERE EXISTS (
           SELECT 1 FROM "SavedMedia" canon
           WHERE canon."userId" = sm."userId"
             AND canon."mediaId" = sm."mediaId"
             AND canon."createdAt" < sm."createdAt"
         );

7. Restart API + worker processes. The save worker will re-derive aggregate
   `SavedMedia.state` on first job touching each row.

## Risk analysis

  - **Lost bytes during dir rename.** The new save pipeline writes into a
    `.staging/` directory and only renames into place after verification. If
    the rename fails (permission, cross-device link), the worker leaves the
    failed staging dir for the next storage-cleanup pass. Always run
    permanent storage on a single mounted volume.

  - **Replay safety on retries.** Failed jobs reset to PENDING with progress
    counters cleared. The worker deletes the staging directory at the start
    of each attempt, so retries always start from a clean slate.

  - **Migration data loss.** Step 6 collapses duplicate SavedMedia rows;
    take a database snapshot before running. The query is idempotent — it
    can be re-run safely.

  - **Watch routes go live before bytes exist.** The /watch page renders a
    progress placeholder when no variant is yet PERSISTED. Users won't see
    a broken player.

## Rollback

If something goes wrong post-migration:

  1. Stop the worker (`pm2 stop fyphost-worker`).
  2. Restore database snapshot.
  3. Roll the API back to the v2 image.

The new permanent layout is additive at the filesystem level — old per-variant
directories are not removed by the rename script unless you run `mv` instead
of `cp` in step 4. We recommend `cp` first, verify with the new server,
then delete the old layout.
