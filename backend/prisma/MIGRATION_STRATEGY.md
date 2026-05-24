# Prisma Migration Strategy — Production Reconciliation

## Problem

The production database was created manually or by an earlier Prisma schema
version. Running `prisma migrate dev` fails because:

1. The DB is "not managed by Prisma Migrate" (no `_prisma_migrations` table).
2. `prisma migrate dev` tries to create a shadow database — denied on managed Postgres.
3. Schema drift: the DB may lack columns added in v3 (e.g., `Media.storageKey`).

## Safe Production Rollout Strategy

### Step 1: Baseline the existing database

This tells Prisma "the DB already matches a known migration" without running SQL.

```bash
# Generate a baseline migration from the current schema:
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0001_baseline/migration.sql

# Mark it as already applied (no SQL runs):
npx prisma migrate resolve --applied 0001_baseline
```

### Step 2: Detect and apply drift

After baselining, compare the live DB to the schema:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

If output is non-empty, it shows the ALTER statements needed. Review them
manually, then apply as a named migration:

```bash
npx prisma migrate dev --name reconcile_v3 --create-only
# Review the generated SQL, then:
npx prisma migrate deploy
```

### Step 3: Shadow database workaround

For managed Postgres (Neon, Supabase, etc.) that denies CREATE DATABASE:

```bash
# Use a local Postgres for shadow DB only:
export SHADOW_DATABASE_URL="postgresql://localhost:5432/fyphost_shadow"
npx prisma migrate dev --name reconcile_v3
```

Or in `schema.prisma`:
```prisma
datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}
```

### Step 4: Ongoing safety

- NEVER run `prisma migrate dev` directly on production.
- ALWAYS run `prisma migrate deploy` in production (applies pending migrations only).
- Add `npx prisma migrate deploy` to the PM2 pre-start script or CI/CD pipeline.
- Schema changes go through: `migrate dev` locally → commit migration → `migrate deploy` in prod.

### Step 5: Prevent future drift

Add to CI:
```bash
npx prisma migrate diff \
  --from-migrations-directory prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

This exits non-zero if the schema has uncommitted drift.
