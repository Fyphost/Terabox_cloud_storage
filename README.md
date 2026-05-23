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
