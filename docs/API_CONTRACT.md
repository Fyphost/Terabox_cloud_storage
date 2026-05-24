# API Route Contract — Frontend ↔ Backend

This document is the canonical reference for all API routes. Any mismatch
between this file, the backend routes, and the frontend API client is a bug.

## Convention

- All routes are prefixed with `/api/v1/`.
- Frontend calls relative paths (e.g., `/api/v1/ingest`).
- In dev, Next.js rewrites proxy these to `http://localhost:4000`.
- In prod, Nginx routes `/api/v1/*` directly to the Fastify upstream.

## Auth Routes (`/api/v1/auth`)

| Method | Path                      | Auth    | Frontend calls | Purpose                  |
|--------|---------------------------|---------|----------------|--------------------------|
| POST   | `/auth/anon`              | none    | ✓ (on mount)   | Issue anonymous session  |
| POST   | `/auth/signup`            | none    | ✓              | Register new account     |
| POST   | `/auth/login`             | none    | ✓              | Authenticate             |
| POST   | `/auth/refresh`           | cookie  | ✓ (auto)       | Rotate access token      |
| POST   | `/auth/logout`            | cookie  | ✓              | Revoke session           |
| POST   | `/auth/verify-email`      | none    | ✓              | Verify email token       |
| POST   | `/auth/resend-verification`| none   | ✓              | Resend verify email      |
| POST   | `/auth/forgot-password`   | none    | ✓              | Request password reset   |
| POST   | `/auth/reset-password`    | none    | ✓              | Apply password reset     |
| GET    | `/auth/me`                | cookie  | ✓              | Current user             |

## Ingest (`/api/v1/ingest`)

| Method | Path       | Auth | Frontend calls | Purpose                    |
|--------|------------|------|----------------|----------------------------|
| POST   | `/ingest`  | opt  | ✓              | Analyze TeraBox URL        |

**Body:** `{ url: string, forceRefresh?: boolean }`

> **IMPORTANT:** There is NO `/media/analyze` route. The frontend MUST call
> `POST /api/v1/ingest`. The earlier `/media/analyze` name was from a design
> doc that was never implemented. If you see it anywhere, it's a bug.

## Media (`/api/v1/media`)

| Method | Path                          | Auth | Purpose                     |
|--------|-------------------------------|------|-----------------------------|
| GET    | `/media/:id`                  | opt  | Get media + variants        |
| GET    | `/media/:id/master.m3u8`      | opt  | Synthetic HLS master        |

## Stream (`/api/v1/stream`) — live/cached upstream proxy

| Method | Path                                    | Auth   | Purpose              |
|--------|-----------------------------------------|--------|----------------------|
| GET    | `/stream/:variantId/playlist.m3u8`      | signed | HLS media playlist   |
| GET    | `/stream/:variantId/segment/:index`     | signed | HLS segment          |
| GET    | `/stream/:variantId/file`               | signed | Direct MP4           |
| GET    | `/stream/:variantId/download`           | signed | Download w/ filename |

## Save (`/api/v1/save`)

| Method | Path                                  | Auth       | Purpose              |
|--------|---------------------------------------|------------|----------------------|
| POST   | `/save`                               | registered | Enqueue save job     |
| GET    | `/save/:savedMediaId`                 | registered | Save progress        |
| POST   | `/save/variant/:savedVariantId/retry` | registered | Retry failed variant |

## Library (`/api/v1/library`) — saved-only playback

| Method | Path                                                        | Auth       | Purpose              |
|--------|-------------------------------------------------------------|------------|----------------------|
| GET    | `/library`                                                  | registered | List saved media     |
| GET    | `/library/:savedMediaId`                                    | registered | Saved media detail   |
| DELETE | `/library/:savedMediaId`                                    | registered | Delete from library  |
| POST   | `/library/bulk-delete`                                      | registered | Bulk delete          |
| GET    | `/library/:savedMediaId/master.m3u8`                        | signed     | Local HLS master     |
| GET    | `/library/:savedMediaId/variant/:variantId/playlist.m3u8`   | signed     | Local variant playlist|
| GET    | `/library/:savedMediaId/variant/:variantId/segment/:index`  | signed     | Local segment        |
| GET    | `/library/:savedMediaId/variant/:variantId/download`        | signed     | Download from library|
| GET    | `/library/:savedMediaId/thumb.jpg`                          | signed     | Thumbnail            |

## Admin (`/api/v1/admin`)

| Method | Path               | Auth  | Purpose       |
|--------|--------------------|-------|---------------|
| GET    | `/admin/stats`     | admin | KPI stats     |
| GET    | `/admin/users`     | admin | User list     |
| GET    | `/admin/jobs/failed`| admin | Failed jobs  |

## Health (`/api/v1/health`)

| Method | Path             | Auth | Purpose          |
|--------|------------------|------|------------------|
| GET    | `/health/live`   | none | Liveness probe   |
| GET    | `/health/ready`  | none | Readiness probe  |
