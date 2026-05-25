# Fyphost

A cloud media ingestion and streaming platform built around an existing TeraBox extractor.
Users paste a TeraBox URL, stream instantly, optionally save selected qualities into Fyphost
storage, and re-stream from their library — without ads, fake download buttons, or throttled
cloud-host UX.

## Repo layout

```
.
├── ARCHITECTURE.md     Senior-engineer architecture document (start here)
├── backend/            Fastify + Prisma + BullMQ + local NVMe storage
└── web/                Next.js 15 + Tailwind + Zustand + hls.js
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design — backend, frontend, DB,
queues, streaming pipeline, storage lifecycle, security, deployment, and scaling.

## Backend

Two processes share one codebase:

- **API** (`npm run dev:api`) — Fastify, serves `/api/v1/*`, signs URLs, proxies HLS,
  honors HTTP ranges.
- **Worker** (`npm run dev:worker`) — BullMQ consumers for save jobs, cache eviction,
  storage cleanup.

Both depend on Postgres + Redis + a storage volume.

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate    # first time
npm run dev:api           # one terminal
npm run dev:worker        # another terminal
```

## Frontend

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

The frontend never sees upstream TeraBox URLs — only signed Fyphost URLs. The synthetic
master playlist served at `/api/v1/media/:id/master.m3u8` exposes all qualities as hls.js
levels for one player URL with adaptive + manual switching.

## Canonical archive model

The canonical *download* artifact is the original file (`source.mp4` / `source.mkv` / …)
stored once per Media at `permanent/media/<mediaId>/source.<ext>`. HLS derivatives are
streaming-only and live alongside it under `permanent/media/<mediaId>/hls/<quality>/`.
Each saved entry mints a permanent share token at `/share/<token>` whose inner playback
URLs are minted fresh on every fetch.

See [`ARCHITECTURE.md` §13](./ARCHITECTURE.md#13-canonical-archive-model) for the full
rationale, storage layout, and deployment runbook (including the migration and
reconciliation steps for upgrading an existing production database).

## Production deploy (PM2)

```bash
cd backend
git pull
npm ci
npm run prisma:generate

# First time only on an existing prod DB whose tables predate the migration history:
npx prisma migrate resolve --applied 20260524000000_baseline

# Apply additive migration (Part 1):
npm run prisma:deploy

# Backfill mediaId/selectedQuality, persist source.mp4, mint share tokens, etc.
npm run reconcile:archive

# Apply tightening migration (Part 2). Will refuse to run if Step 3 left NULLs.
npm run prisma:deploy

# Build clean (no stale dist/) and reload both pm2 processes:
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
```

The same flow applies on subsequent deploys, minus the one-time `migrate resolve` and
`reconcile:archive` steps.
