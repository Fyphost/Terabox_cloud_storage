# Fyphost — Architecture

A cloud media ingestion and streaming platform. Users paste a TeraBox URL,
stream instantly, optionally save selected qualities into Fyphost-owned
storage, and re-stream from the library forever — without ads, fake download
buttons, or throttled cloud-host UX.

This document is the source of truth for backend and frontend design,
intended for engineers shipping production code.

---

## 1. System Overview

```
                 ┌────────────────────────────────────────────────────────┐
                 │                     Fyphost Web                         │
                 │   Next.js 15 · React · Tailwind · shadcn · hls.js · Zus │
                 └─────────────────────────┬──────────────────────────────┘
                                           │ HTTPS
                                           ▼
                 ┌────────────────────────────────────────────────────────┐
                 │                  Fyphost API (Fastify)                  │
                 │    /ingest    /media    /stream    /save    /library    │
                 └──────┬──────────┬──────────┬──────────┬──────────┬─────┘
                        │          │          │          │          │
              ┌─────────┘    ┌─────┘    ┌─────┘    ┌─────┘    ┌─────┘
              ▼              ▼          ▼          ▼          ▼
        ┌──────────┐  ┌────────────┐  ┌──────┐ ┌──────────┐ ┌─────────────┐
        │ TeraBox  │  │ PostgreSQL │  │Redis │ │ BullMQ   │ │ Local NVMe  │
        │ Worker   │  │  (Prisma)  │  │cache │ │ queues   │ │ hot cache + │
        │(extractor│  │            │  │meta  │ │          │ │ permanent   │
        │ already  │  └────────────┘  └──────┘ └──────────┘ │ storage      │
        │  built)  │                                         └─────────────┘
        └──────────┘
                                                            ▲
                                                            │ later
                                                            ▼
                                                    ┌──────────────┐
                                                    │ S3-compatible│
                                                    │ + Cloudflare │
                                                    │     CDN      │
                                                    └──────────────┘
```

Two execution surfaces share the codebase:

- **API process** — Fastify. Serves HTTP, signs URLs, proxies HLS, ranges.
- **Worker process** — BullMQ consumers. Saves media, cleans cache.

Both link to PostgreSQL, Redis, and the storage volume. They are **the same
package** (modular monolith), built once, deployed twice with different
entrypoints. No network coupling between them.

---

## 2. Core Concepts

### Media vs. MediaVariant vs. SavedMedia

| Concept        | Meaning                                                                    |
|----------------|----------------------------------------------------------------------------|
| `Media`        | Logical media item identified by source URL hash. Created on first ingest. |
| `MediaVariant` | One quality (360p/480p/720p/...) of a `Media`. Rows added on extraction.   |
| `SavedMedia`   | A user-owned record claiming variants for permanent storage.               |
| `CacheEntry`   | A locally cached file/segment for hot streaming (NOT user-owned).          |
| `StreamSession`| A short-lived signed token tying a viewer to a variant (rate, abuse, IP).  |

A `MediaVariant` can simultaneously be:

- **EPHEMERAL** — proxied live from TeraBox; nothing persisted.
- **CACHED** — present on local NVMe under LRU eviction.
- **PERSISTED** — copied into permanent storage, owned by one or more users.

These are not mutually exclusive. The state machine is:

```
        ┌────────────┐  first stream  ┌────────────┐
        │ EPHEMERAL  ├───────────────▶│  CACHED    │
        └────────────┘                └─────┬──────┘
              ▲                             │ user save
              │ LRU evict                   ▼
              │                       ┌────────────┐
              └───────────────────────┤ PERSISTED  │
                                      └────────────┘
```

`PERSISTED` is never auto-evicted; only deleted on explicit user delete or
when no `SavedMedia` row references it (with a grace period).

### Source-URL deduplication

Every TeraBox URL normalizes to a canonical `sourceHash`
(`sha256(normalized_url)`). Two users pasting the same link share one `Media`
row and one set of `MediaVariant` rows. Saves are per-user via `SavedMedia`,
so disk usage scales by **unique variants saved**, not by users.

---

## 3. Backend

### 3.1 Tech Stack

- Node.js 20+ (native `fetch`, `Readable.fromWeb`, undici)
- Fastify 4 (uvloop-class throughput, schema-validated routes)
- TypeScript strict
- PostgreSQL 16 + Prisma
- Redis 7 (BullMQ + signed-URL replay cache + rate limit)
- BullMQ for queues
- pino for logging
- zod for env + payload validation
- undici for upstream HTTP (keep-alive pool, native streams)

### 3.2 Folder Structure

```
backend/
├── src/
│   ├── server.ts                     # API process entrypoint
│   ├── worker.ts                     # Worker process entrypoint
│   ├── app.ts                        # buildApp(): Fastify factory
│   ├── config/
│   │   ├── env.ts                    # zod-validated env
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   └── storage.ts                # storage paths/limits
│   ├── modules/
│   │   ├── ingest/
│   │   │   ├── ingest.routes.ts
│   │   │   ├── ingest.service.ts
│   │   │   ├── ingest.schema.ts
│   │   │   └── terabox.client.ts     # wraps existing CF Worker
│   │   ├── media/
│   │   │   ├── media.routes.ts
│   │   │   └── media.service.ts
│   │   ├── stream/
│   │   │   ├── stream.routes.ts
│   │   │   ├── stream.service.ts
│   │   │   ├── stream.proxy.ts       # range-aware passthrough
│   │   │   └── hls.rewriter.ts       # m3u8 manifest rewriting
│   │   ├── save/
│   │   │   ├── save.routes.ts
│   │   │   └── save.service.ts
│   │   ├── library/
│   │   │   ├── library.routes.ts
│   │   │   └── library.service.ts
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.service.ts
│   │   │   └── jwt.ts
│   │   └── health/
│   │       └── health.routes.ts
│   ├── services/
│   │   ├── storage/
│   │   │   ├── storage.interface.ts
│   │   │   ├── local-storage.ts      # NVMe + permanent volume
│   │   │   ├── s3-storage.ts         # future
│   │   │   └── index.ts              # picks impl from env
│   │   ├── cache/
│   │   │   ├── cache.service.ts      # LRU-by-access-time on disk
│   │   │   └── lru.ts
│   │   ├── signing/
│   │   │   └── signed-url.ts         # HMAC, replay-safe
│   │   └── hls/
│   │       └── hls.service.ts        # parse/serialize playlists
│   ├── queues/
│   │   ├── index.ts                  # queue registry
│   │   ├── save.queue.ts
│   │   ├── cleanup.queue.ts
│   │   └── types.ts
│   ├── workers/
│   │   ├── save.worker.ts
│   │   ├── cache-cleanup.worker.ts
│   │   ├── storage-cleanup.worker.ts
│   │   └── metadata-refresh.worker.ts
│   ├── plugins/
│   │   ├── auth.plugin.ts
│   │   ├── ratelimit.plugin.ts
│   │   ├── cors.plugin.ts
│   │   └── error-handler.plugin.ts
│   └── lib/
│       ├── logger.ts
│       ├── errors.ts
│       ├── http.ts                   # undici dispatcher
│       └── ids.ts                    # nanoid/ulid
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── storage/                          # gitignored
│   ├── cache/                        # NVMe hot cache
│   └── permanent/                    # saved media
└── package.json
```

### 3.3 Database Schema (Prisma)

See `backend/prisma/schema.prisma`. Highlights:

- `Media` — canonical, dedup'd by `sourceHash`.
- `MediaVariant` — one row per `(mediaId, quality)`. Holds upstream URLs
  (refreshable), and storage state (`EPHEMERAL` / `CACHED` / `PERSISTED`),
  plus `storageKey` (path inside the storage backend) when persisted.
- `SavedMedia` — `(userId, mediaVariantId)` claim. Supports per-user library
  view without duplicating bytes.
- `CacheEntry` — file-level cache record (full file or HLS segment).
  Indexed by `(mediaVariantId, segmentKey)` and `lastAccessedAt`.
- `StreamSession` — issued tokens, IP, expiry; useful for revocation/abuse
  triage. Hot path uses HMAC, not DB lookups.
- `QueueJob` — audit trail of BullMQ jobs (id, type, status, error). Optional
  but helpful for ops.

### 3.4 API Surface

All routes namespaced under `/api/v1`. JSON in/out unless noted.

| Method | Path                                  | Auth | Purpose                                     |
|--------|---------------------------------------|------|---------------------------------------------|
| POST   | `/ingest`                             | opt  | Analyze TeraBox URL → returns `Media`.      |
| GET    | `/media/:id`                          | opt  | Get media + variants + signed stream URLs.  |
| GET    | `/stream/:variantId/playlist.m3u8`    | sig  | HLS master/media playlist (rewritten).      |
| GET    | `/stream/:variantId/segment/:idx`     | sig  | HLS segment (proxied, range-aware, cached). |
| GET    | `/stream/:variantId/file`             | sig  | Direct file with `Range` support.           |
| GET    | `/stream/:variantId/download`         | sig  | Same as `/file` with `Content-Disposition`. |
| POST   | `/save`                               | yes  | Enqueue save job for selected variants.     |
| GET    | `/save/:jobId`                        | yes  | Job progress.                               |
| GET    | `/library`                            | yes  | Saved media list (paginated).               |
| DELETE | `/library/:savedMediaId`              | yes  | Remove from library.                        |
| POST   | `/auth/anon`                          | no   | Issue anonymous device token.               |
| POST   | `/auth/login`                         | no   | (Optional) email/oauth login.               |
| GET    | `/health`                             | no   | Liveness/readiness.                         |

`sig` = HMAC-signed URL parameter (`?t=...&exp=...`); does not require a
session. `yes` = bearer JWT.

### 3.5 Ingestion Pipeline

```
client          api                       cf-worker            postgres        redis
  │   POST /ingest{url}                    │                       │             │
  │ ─────────────▶ │                       │                       │             │
  │                │ normalize + sha256    │                       │             │
  │                │ check cache (Redis)   │                       │             │
  │                │ ────────────────────────────────────────────────▶          │
  │                │ ◀────────────── miss ───────────────────────────            │
  │                │ POST extractor        │                       │             │
  │                │ ─────────────────────▶│                       │             │
  │                │ ◀───────────── meta ──│                       │             │
  │                │ upsert Media + Variants ─────────────────────▶│             │
  │                │ cache meta in Redis (TTL 10m) ──────────────────────────────▶│
  │ ◀── 200 JSON ──│                       │                       │             │
```

Notes:

- TeraBox upstream stream URLs **expire**. The DB stores them but treats them
  as a refreshable cache; the `metadata-refresh` worker re-extracts on
  expiry, and stream requests will trigger a re-extract on 403/404.
- Ingest is idempotent: same URL → same `mediaId`.
- Anonymous users can ingest. Rate limited per IP.

### 3.6 Streaming Pipeline

Two orthogonal concerns: **what** to play, and **where the bytes come from**.

#### What to play

Frontend always requests Fyphost URLs, never TeraBox URLs directly. The
frontend never sees upstream URLs — only signed Fyphost URLs. This is what
makes "no ads, no fake buttons" possible: the player is bound to our origin.

For each variant, `/api/v1/media/:id` returns:

```json
{
  "id": "med_01H...",
  "name": "video.mp4",
  "size": 6534144,
  "thumbnail": "https://cdn.fyphost/.../thumb.jpg",
  "variants": [
    {
      "id": "var_01H...",
      "quality": "720p",
      "playlistUrl": "/api/v1/stream/var_01H.../playlist.m3u8?t=...&exp=...",
      "fileUrl":     "/api/v1/stream/var_01H.../file?t=...&exp=...",
      "downloadUrl": "/api/v1/stream/var_01H.../download?t=...&exp=...",
      "state": "EPHEMERAL"
    }
  ]
}
```

#### Where the bytes come from

Decision tree at request time, inside `stream.service`:

```
request /stream/:variant/<resource>
  │
  ├─ verify signed URL (HMAC + exp)
  ├─ load variant
  │
  ├─ if state=PERSISTED → serve from permanent storage (sendFile w/ ranges)
  │
  ├─ else if cache hit  → serve from NVMe cache (sendFile w/ ranges)
  │                       touch lastAccessedAt
  │
  └─ else                → proxy from TeraBox upstream
                           - HLS playlist: fetch, rewrite URLs, return
                           - HLS segment / file: pipe through, optionally
                             tee to cache writer (write-through)
                           - on upstream 403/404: re-extract, retry once
```

**Range support.** All three branches honor `Range`. Ranged requests on
upstream files use `Range` headers on the upstream `fetch`; we forward
`Content-Range`/`206`. We **never** buffer bodies — only `Readable`
pipelines via `stream/promises#pipeline`.

**HLS rewriting.** The `.m3u8` from TeraBox references segment URLs on
TeraBox CDN. We parse the playlist and rewrite each segment URI to:

```
/api/v1/stream/<variantId>/segment/<n>?t=<sig>&exp=<unix>
```

This keeps the player in our origin (CSP-friendly, abuse-controllable, and a
prerequisite for caching/persistence).

**Write-through caching.** When a segment is missing in cache and proxied
live, the response stream is `tee`'d: one branch returns to the client,
the other writes to `storage/cache/<variantId>/<segIdx>.ts` via a temp file
+ atomic rename. Failures on the write branch are logged but do not affect
the playback branch.

**Saved-media playback.** Same routes, same signed URLs. The decision tree
just hits the first branch. The frontend is unaware of where bytes live;
this lets us migrate to S3+CDN later without UI changes.

### 3.7 Save Workflow

```
POST /api/v1/save                       Worker
  body: { mediaId, qualities: [...] }     │
  │                                       │
  ├─ validate mediaId + qualities         │
  ├─ for each variant:                    │
  │    create SavedMedia(state=PENDING)   │
  │    enqueue save:download {variantId}  │
  │                                       │
  └─ 202 { jobIds: [...] }                ▼
                                   ┌──────────────┐
                                   │ save.worker  │
                                   │              │
                                   │ resolve URLs │
                                   │ (HLS or MP4) │
                                   │              │
                                   │ HLS:         │
                                   │  fetch m3u8  │
                                   │  fetch segs  │
                                   │  to /perm/   │
                                   │  rewrite     │
                                   │              │
                                   │ MP4:         │
                                   │  fetch w/    │
                                   │  ranges,     │
                                   │  resumable   │
                                   │              │
                                   │ on done:     │
                                   │  variant.state=PERSISTED
                                   │  variant.storageKey=...
                                   │  saved.state=COMPLETE
                                   └──────────────┘
```

Invariants:

- **Concurrent saves of the same variant** dedup in the worker by holding a
  Redis lock on `lock:variant:<id>`. The first job downloads; subsequent
  jobs block, then succeed instantly when the first completes.
- **Idempotent.** The worker checks `MediaVariant.state === PERSISTED` before
  doing anything. Retried jobs are safe.
- **Resumable.** MP4 saves write to `<key>.partial` and resume via `Range`.
  HLS saves track per-segment progress in Redis (`save:<jobId>:segs`).
- **Bounded concurrency.** `Worker({ concurrency: 4 })`. Adjustable per box.
- **Integrity.** sha256 hash computed during stream-write; stored on variant
  for later verification.

### 3.8 Caching Architecture

- **Hot cache** lives on local NVMe at `storage/cache/<variantId>/...`.
  - For MP4: single file `file.bin`.
  - For HLS: `playlist.m3u8` + `seg-<n>.ts`.
- Each cached object has a `CacheEntry` row tracking
  `bytes`, `lastAccessedAt`, `mediaVariantId`, `kind`.
- Redis mirrors hot stats (`cache:size:total`, per-variant TTL hints).
- Eviction:
  - Triggered when `cache_size > CACHE_HIGH_WATERMARK`.
  - Cleanup worker selects oldest by `lastAccessedAt` until
    `cache_size <= CACHE_LOW_WATERMARK`.
  - Persisted variants are exempt — their bytes live in `storage/permanent`,
    not `storage/cache`.
- Cache reads update `lastAccessedAt` lazily (every Nth read, or via
  Redis-buffered debounce) to avoid write amplification.

### 3.9 Signed URLs

```
url      = /api/v1/stream/<variantId>/<resource>?t=<sig>&exp=<unix>&u=<userOrAnon>
sig      = base64url(HMAC_SHA256(secret, `${variantId}|${resource}|${exp}|${u}`))
```

- TTL: 6h default (renewable on `/media/:id` refresh).
- HMAC verification is constant-time, in-process — no DB lookup.
- Replay protection: optional Redis `streamtoken:<sig>` set with TTL,
  rejecting tokens already burned for download routes (not segments).
- Bound to `userOrAnon` ID so abuse can be traced and revoked
  (revocation list = small Redis set checked only for high-value routes).

### 3.10 Auth Strategy

- Anonymous-by-default. First-time visitors get a device-bound token via
  `POST /auth/anon` (httpOnly cookie + opaque ID stored as `User` row with
  `kind=ANON`).
- Anonymous users can ingest, stream, and save (subject to a small quota
  enforced via Redis counters).
- Optional email/OAuth login upgrades the same `User` row, preserving their
  library.
- JWT (HS256) with 14-day refresh; rotation on each refresh. Keys in env.

### 3.11 Rate Limiting

`@fastify/rate-limit` backed by Redis. Buckets:

| Route                       | Bucket    | Limit       |
|-----------------------------|-----------|-------------|
| `POST /ingest`              | per-IP    | 30 / 10 min |
| `POST /save`                | per-user  | 50 / day    |
| `GET  /stream/.../playlist` | per-token | 600 / min   |
| `GET  /stream/.../segment`  | per-token | 6000 / min  |
| `POST /auth/*`              | per-IP    | 20 / min    |

Streaming limits are deliberately loose; the signed URL is the primary
control. Limits exist to catch leaked tokens.

### 3.12 Logging & Observability

- pino JSON logs, request-scoped child logger with `reqId`.
- Sensitive fields scrubbed (`url`, `cookie`, `authorization`).
- Metrics endpoint (`/metrics`) exposes Prometheus counters:
  `ingest_total`, `stream_bytes_total{kind}`, `cache_hits_total`,
  `cache_misses_total`, `save_jobs_total{status}`, queue depth.
- Stream errors emit a structured event with `variantId`, `range`, upstream
  status — these become the operational signal for upstream URL expiry.

### 3.13 Error Handling

- Custom `AppError` with `code`, `httpStatus`, `userMessage`, `cause`.
- Fastify `errorHandler` plugin maps to consistent JSON:
  `{ error: { code, message } }`.
- Upstream 403/404 → `UPSTREAM_EXPIRED` → triggers re-extract once → retry.
- Worker errors are caught, logged, and surface in `QueueJob.error`.

---

## 4. Storage

### 4.1 Layout

```
storage/
├── cache/
│   └── <variantId>/
│       ├── playlist.m3u8        (HLS)
│       ├── seg-0.ts
│       ├── seg-1.ts
│       └── ...                   OR
│       └── file.bin              (MP4 / single-file)
└── permanent/
    └── <yyyy>/<mm>/<variantId>/
        ├── playlist.m3u8
        ├── seg-*.ts
        └── ...                   OR
        └── file.bin
```

`storage.service` exposes a narrow interface:

```ts
interface StorageBackend {
  read(key: string, range?: ByteRange): Promise<{ stream: Readable; size: number; contentType: string }>;
  write(key: string, src: Readable, opts?: { contentType?: string }): Promise<{ bytes: number; sha256: string }>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<{ size: number; mtimeMs: number } | null>;
  delete(key: string): Promise<void>;
  signedReadUrl?(key: string, ttlSec: number): Promise<string>; // S3 future
}
```

Two implementations: `LocalDiskBackend` (now), `S3Backend` (later, drop-in).
Choice driven by env. Permanent and cache use **separate volumes** so cache
churn can't fill the persistent disk.

### 4.2 Lifecycle

| Event                         | Effect                                                  |
|-------------------------------|---------------------------------------------------------|
| First playback of a variant   | Either pure proxy or write-through into `cache/`.       |
| Cache exceeds high-watermark  | Cleanup worker evicts LRU entries until low-watermark.  |
| Save job completes            | Variant copied/moved to `permanent/`, state=PERSISTED.  |
| Last `SavedMedia` deleted     | Variant marked `PENDING_DELETE`, grace period (24h).    |
| `PENDING_DELETE` + grace ends | Storage-cleanup worker deletes bytes, demotes state.    |
| Source URL expired            | Metadata refresh re-extracts; storage untouched.        |

---

## 5. Queues

`queues/` defines all queue names + payload types in one place. `workers/`
imports the same types — single source of truth.

| Queue              | Job types                | Concurrency | Retries          |
|--------------------|--------------------------|-------------|------------------|
| `save`             | `download-variant`       | 4           | 5 (exp backoff)  |
| `cleanup-cache`    | `evict-lru` (cron)       | 1           | 1                |
| `cleanup-storage`  | `purge-pending` (cron)   | 1           | 1                |
| `metadata-refresh` | `reextract` (on demand)  | 2           | 3                |
| `stream-retry`     | `retry-failed-prefetch`  | 2           | 3                |

Cron jobs use BullMQ repeatable jobs (10 min cache, 1 h storage).

---

## 6. Frontend

### 6.1 Tech Stack

- Next.js 15 (App Router, RSC where it helps, Client where it must)
- React 19
- TypeScript strict
- Tailwind 4 + shadcn/ui
- Zustand (per-page slice stores; no global megastore)
- hls.js
- TanStack Query for server state (cache + retry + dedupe), Zustand for UI state

### 6.2 Folder Structure

```
web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                       # Landing
│   ├── m/
│   │   └── [id]/
│   │       └── page.tsx               # Media preview (RSC shell + Client player)
│   ├── library/
│   │   └── page.tsx
│   └── globals.css
├── components/
│   ├── ui/                            # shadcn primitives
│   ├── player/
│   │   ├── HlsPlayer.tsx
│   │   ├── QualitySelector.tsx
│   │   ├── PlayerControls.tsx
│   │   └── PlayerSkeleton.tsx
│   ├── ingest/
│   │   └── UrlAnalyzer.tsx
│   ├── media/
│   │   ├── MediaInfo.tsx
│   │   ├── QualityBadge.tsx
│   │   └── SaveDialog.tsx
│   ├── library/
│   │   ├── LibraryGrid.tsx
│   │   ├── LibraryCard.tsx
│   │   └── LibraryFilters.tsx
│   └── layout/
│       ├── Header.tsx
│       └── MobileNav.tsx
├── hooks/
│   ├── use-ingest.ts
│   ├── use-media.ts
│   ├── use-library.ts
│   ├── use-save.ts
│   └── use-hls.ts
├── lib/
│   ├── api/
│   │   ├── client.ts                  # fetch wrapper (auth, errors, types)
│   │   ├── ingest.ts
│   │   ├── media.ts
│   │   ├── library.ts
│   │   └── save.ts
│   ├── store/
│   │   ├── player.store.ts
│   │   └── ingest.store.ts
│   └── utils/
│       ├── format.ts
│       └── cn.ts
└── types/
    └── api.ts                          # shared with backend via codegen later
```

### 6.3 Component Hierarchy

```
RootLayout
├── Header                    (sticky, minimal: logo + library link)
├── (page)
│   ├── LandingPage
│   │   ├── Hero
│   │   ├── UrlAnalyzer       (Zustand: ingest.store)
│   │   └── RecentMediaStrip  (TanStack Query)
│   │
│   ├── MediaPreviewPage
│   │   ├── MediaHeader       (thumb, name, size)
│   │   ├── HlsPlayer         (Zustand: player.store)
│   │   │   ├── PlayerControls
│   │   │   └── QualitySelector
│   │   ├── ActionBar         (Save / Download)
│   │   └── SaveDialog
│   │
│   └── LibraryPage
│       ├── LibraryFilters    (search, quality)
│       └── LibraryGrid
│           └── LibraryCard*
└── MobileNav                 (bottom tab bar on small screens)
```

Async boundaries:

- Page-level `loading.tsx` for route shell skeletons.
- Player has its own skeleton (16:9 placeholder) — shows immediately while
  the media JSON loads.
- Library uses `Suspense` + streamed RSC for fast first paint, then
  hydrates filters as Client.

### 6.4 State Management

Zustand stores are **scoped**, not global:

- `player.store` — current variantId, quality, isPlaying, level, errors.
- `ingest.store` — URL input, analyzing state, last error.
- Library filters are URL-state (search params), not Zustand.

Server state is owned by TanStack Query. We do not duplicate server data in
Zustand. The player store is purely UI/playback control.

### 6.5 API Client

Single `apiFetch` wrapper:

- Adds bearer token from cookie.
- Throws typed `ApiError` on non-2xx.
- AbortSignal pass-through for cancellation on route changes.
- Request/response types live in `types/api.ts`.

### 6.6 HLS Player Strategy

- Native HLS on Safari (iOS, macOS) — no hls.js needed.
- hls.js everywhere else.
- Quality switching is **manual** in the UI (`hls.currentLevel = n`)
  combined with adaptive (default `hls.autoLevelEnabled`).
- The player binds to the **playlist URL** returned by `/media/:id`. Quality
  switching uses hls.js levels parsed from that one playlist (TeraBox
  returns separate per-quality manifests, so we expose them as levels by
  building a synthetic master playlist server-side; see §7).
- Errors:
  - `MEDIA_ERR_NETWORK` → retry with exp backoff up to 3.
  - `MEDIA_ERR_DECODE` → `hls.recoverMediaError()`.
  - Fatal → user-facing error UI with retry button.
- Buffering:
  - `maxBufferLength: 30`
  - `maxMaxBufferLength: 60`
  - `lowLatencyMode: false` (VoD)

### 6.7 Mobile-First UI Strategy

- Tailwind breakpoints: design at `375px`, scale up.
- Bottom-anchored navigation on `< md`. Top nav appears on `md+`.
- Player chrome:
  - Tap toggles controls.
  - Double-tap left/right seeks ±10s (frame-perfect on iOS by avoiding
    React re-render during seek).
  - Quality button is part of the bottom-right control cluster, opens a
    bottom sheet on mobile, popover on desktop.
  - Fullscreen via the Fullscreen API; on iOS Safari we use
    `webkitEnterFullscreen` on the underlying `<video>`.
- Touch targets ≥ 44px.
- `prefers-reduced-motion` honored: no parallax, no auto-playing previews.

### 6.8 Performance Budget

- LCP < 2.0s on 4G mid-tier Android.
- TTI < 3.0s on the same.
- Player code-split: `dynamic(() => import('@/components/player/HlsPlayer'),
  { ssr: false })`. hls.js is ~120KB gz; keep it off the landing page.
- Library images: `next/image`, served via thumbnails endpoint.
- No client-side analytics on the critical path.

---

## 7. Synthetic HLS Master

Some TeraBox responses give us **per-quality** media playlists, not a single
master. To expose adaptive switching to hls.js with one URL, the API returns
a synthetic master playlist:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360
/api/v1/stream/<varId-360>/playlist.m3u8?t=...&exp=...
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480
/api/v1/stream/<varId-480>/playlist.m3u8?t=...&exp=...
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
/api/v1/stream/<varId-720>/playlist.m3u8?t=...&exp=...
```

`/media/:id` exposes one `masterPlaylistUrl`. The player loads it; hls.js
sees three levels and the user can switch via `hls.currentLevel`.

For saved media, the master is generated identically but points at
`PERSISTED` variants — the same component, the same URL shape.

---

## 8. Security

- All upstream-sourced URLs are server-side only. Frontend never sees them.
- Signed URLs everywhere on stream routes; HMAC key in env, rotated by
  appending a key version (`v1`, `v2`) and verifying both during rollover.
- `Content-Security-Policy: default-src 'self'; media-src 'self'; ...` —
  the player only loads from our origin, blocking any injected ad/redirect.
- `Referrer-Policy: no-referrer`.
- Strict `cors` allowlist for the web origin.
- Rate limits + per-token budgets for streaming abuse.
- Save quotas per anonymous user (e.g., 5 GB / 30 days), unlimited for
  logged-in users (configurable).
- Source URL hash never exposed to clients; we expose only `mediaId`.
- Logs scrub URLs and tokens.

---

## 9. Deployment

### 9.1 Initial (single VPS)

- One VPS with NVMe (e.g., 8 vCPU / 32 GB / 1 TB NVMe).
- Docker Compose orchestrates: `api`, `worker`, `postgres`, `redis`,
  `caddy` (TLS + reverse proxy).
- Storage volumes:
  - `/var/lib/fyphost/cache` — NVMe (or a partition reserved for cache).
  - `/var/lib/fyphost/permanent` — separate disk or LVM.
- Backups: nightly `pg_dump` + rsync of `permanent/` to off-box.

### 9.2 Process Topology

```
caddy ─┬─ api  (4 instances behind round-robin, optional)
       └─ web  (Next.js standalone)

worker (1+ instances)
postgres
redis
```

API and worker are **the same Docker image** with different commands:
`node dist/server.js` vs `node dist/worker.js`. Same code, same migrations,
no drift.

### 9.3 Future Scaling

- **CDN.** Cloudflare in front of `/stream/*`. Cache key includes signed
  token's exp+sig; we set `Cache-Control: public, max-age=...` only for
  ranges that are full-segment fetches (HLS segments). Master playlists
  remain `private, no-store` because URLs are signed per-session.
- **Object storage.** Swap `LocalDiskBackend` for `S3Backend`. Signed S3
  URLs replace proxy reads for `PERSISTED` variants when behind CDN.
- **Horizontal API.** API is stateless. Scale by replicas; Redis + Postgres
  remain shared. Sticky sessions not required.
- **Sharded workers.** Add per-queue worker fleets when save throughput
  bottlenecks. BullMQ already supports horizontal consumers.
- **Read replicas.** Library list reads can route to a Postgres replica.

---

## 10. Streaming Optimization

- `pipeline()` from `node:stream/promises` everywhere bytes flow. No
  `await response.arrayBuffer()` ever.
- undici `Agent` with `keepAliveTimeout` and `pipelining` tuned for upstream.
- HTTP/2 enabled at the edge (Caddy). Browsers reuse one connection across
  segments → fewer TLS handshakes, faster startup.
- Send `Accept-Ranges: bytes` and respond `206` with correct
  `Content-Range`/`Content-Length`.
- For HLS, prefer **progressive fetch + small segments** (already given by
  TeraBox). Start time ≈ time-to-first-segment.
- For MP4 (non-HLS), enable byte-range; players can seek without buffering
  the whole file.
- Set `X-Accel-Buffering: no` on streamed responses behind reverse proxies
  that buffer.
- Compression off for media; on for JSON responses.
- `Cache-Control` per route:
  - Master playlists: `private, no-store` (signed).
  - Segments served from cache: `public, max-age=86400, immutable`.
  - Segments served from upstream proxy (uncached): `private, max-age=60`.

---

## 11. Future Work (Explicitly Out of Scope Now)

- Transcoding (we may add ffmpeg-based remuxing later only if upstream
  formats need normalization).
- DRM.
- Subtitle ingestion / generation.
- Recommendations / discovery surfaces.
- Sharing / public links.
- Offline downloads in the PWA shell.
- Per-user storage quotas with billing.
- Multi-region replication.

---

## 12. Repo Layout

```
.
├── ARCHITECTURE.md                # this file
├── backend/
│   ├── src/...
│   ├── prisma/...
│   └── package.json
└── web/
    ├── app/...
    ├── components/...
    └── package.json
```

`backend/` and `web/` are independent npm packages. No monorepo tooling
required for v1 — keep it boring.
