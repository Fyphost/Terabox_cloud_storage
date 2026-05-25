-- Baseline migration. Captures the pre-canonical-archive schema.
--
-- For a fresh database: `prisma migrate deploy` will apply this normally.
-- For an existing production database that already has these tables (drifted
-- state): run `npx prisma migrate resolve --applied 20260524000000_baseline`
-- once before running `prisma migrate deploy`. This marks the baseline as
-- present without re-executing it.
--
-- The forward migrations (20260525000001_canonical_archive_part1 and
-- 20260525000002_canonical_archive_part2) are written defensively with
-- IF NOT EXISTS / IF EXISTS guards so they tolerate minor drift between
-- this baseline and the real production state.

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('ANON', 'REGISTERED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'AUDIO', 'IMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "VariantState" AS ENUM ('EPHEMERAL', 'CACHED', 'PERSISTED', 'PENDING_DELETE');

-- CreateEnum
CREATE TYPE "VariantContainer" AS ENUM ('HLS', 'MP4', 'OTHER');

-- CreateEnum
CREATE TYPE "SavedState" AS ENUM ('PENDING', 'DOWNLOADING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "CacheKind" AS ENUM ('HLS_PLAYLIST', 'HLS_SEGMENT', 'FILE');

-- CreateEnum
CREATE TYPE "QueueJobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL DEFAULT 'ANON',
    "email" TEXT,
    "displayName" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'VIDEO',
    "sizeBytes" BIGINT,
    "thumbnailUrl" TEXT,
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadataRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaVariant" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "container" "VariantContainer" NOT NULL DEFAULT 'HLS',
    "width" INTEGER,
    "height" INTEGER,
    "bitrateBps" INTEGER,
    "sizeBytes" BIGINT,
    "upstreamPlaylistUrl" TEXT,
    "upstreamFileUrl" TEXT,
    "upstreamRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "VariantState" NOT NULL DEFAULT 'EPHEMERAL',
    "storageKey" TEXT,
    "sha256" TEXT,
    "cachedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedMedia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaVariantId" TEXT NOT NULL,
    "state" "SavedState" NOT NULL DEFAULT 'PENDING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SavedMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "id" TEXT NOT NULL,
    "mediaVariantId" TEXT NOT NULL,
    "kind" "CacheKind" NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CacheEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "mediaVariantId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueJob" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" "QueueJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Media_sourceHash_key" ON "Media"("sourceHash");

-- CreateIndex
CREATE INDEX "Media_createdAt_idx" ON "Media"("createdAt");

-- CreateIndex
CREATE INDEX "MediaVariant_state_idx" ON "MediaVariant"("state");

-- CreateIndex
CREATE INDEX "MediaVariant_upstreamRefreshedAt_idx" ON "MediaVariant"("upstreamRefreshedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaVariant_mediaId_quality_key" ON "MediaVariant"("mediaId", "quality");

-- CreateIndex
CREATE INDEX "SavedMedia_userId_createdAt_idx" ON "SavedMedia"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedMedia_state_idx" ON "SavedMedia"("state");

-- CreateIndex
CREATE UNIQUE INDEX "SavedMedia_userId_mediaVariantId_key" ON "SavedMedia"("userId", "mediaVariantId");

-- CreateIndex
CREATE INDEX "CacheEntry_lastAccessedAt_idx" ON "CacheEntry"("lastAccessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CacheEntry_mediaVariantId_segmentKey_key" ON "CacheEntry"("mediaVariantId", "segmentKey");

-- CreateIndex
CREATE INDEX "StreamSession_mediaVariantId_expiresAt_idx" ON "StreamSession"("mediaVariantId", "expiresAt");

-- CreateIndex
CREATE INDEX "StreamSession_userId_idx" ON "StreamSession"("userId");

-- CreateIndex
CREATE INDEX "QueueJob_queue_status_idx" ON "QueueJob"("queue", "status");

-- CreateIndex
CREATE INDEX "QueueJob_createdAt_idx" ON "QueueJob"("createdAt");

-- AddForeignKey
ALTER TABLE "MediaVariant" ADD CONSTRAINT "MediaVariant_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMedia" ADD CONSTRAINT "SavedMedia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMedia" ADD CONSTRAINT "SavedMedia_mediaVariantId_fkey" FOREIGN KEY ("mediaVariantId") REFERENCES "MediaVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CacheEntry" ADD CONSTRAINT "CacheEntry_mediaVariantId_fkey" FOREIGN KEY ("mediaVariantId") REFERENCES "MediaVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
