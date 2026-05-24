/**
 * Environment configuration — single source of truth.
 *
 * Root causes fixed:
 *   1. PM2 does NOT load .env files. We must call dotenv.config() ourselves
 *      BEFORE zod validation runs.
 *   2. The previous implementation called process.exit(1) with only a
 *      console.error — invisible in PM2 logs. We now log the full error
 *      to stderr with a structured prefix so PM2 error_file captures it.
 *   3. Missing env vars produced a cryptic zod error. We now list each
 *      missing/invalid field explicitly.
 *
 * Loading order:
 *   - .env.local (highest priority, gitignored, for dev overrides)
 *   - .env       (committed defaults)
 *   - process.env (runtime overrides from PM2/systemd/docker always win)
 *
 * This module is imported at the top of server.ts and worker.ts — it MUST
 * be the first import so that all downstream modules see a validated env.
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// Resolve backend package root from this module's location.
// In dist/, this file lives at dist/config/env.js → backendRoot = dist/..
const moduleDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(moduleDir, '..', '..');
dotenvConfig({ path: resolve(backendRoot, '.env.local'), override: true });
dotenvConfig({ path: resolve(backendRoot, '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // API
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BASE_URL: z.string().url(),
  WEB_BASE_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Auth
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(15 * 60),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(30 * 24 * 3600),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(8),
  EMAIL_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(24 * 3600),

  SIGNING_SECRET: z.string().min(16),
  SIGNING_KEY_VERSION: z.string().default('v1'),
  SIGNED_URL_TTL_SEC: z.coerce.number().int().positive().default(6 * 3600),

  COOKIE_SECURE: z
    .union([z.boolean(), z.enum(['true', 'false', 'auto'])])
    .default('auto'),
  COOKIE_DOMAIN: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Fyphost <no-reply@fyphost.local>'),
  SMTP_SECURE: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default('false'),

  // Storage
  STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
  STORAGE_CACHE_DIR: z.string().default('./storage/cache'),
  STORAGE_PERMANENT_DIR: z.string().default('./storage/permanent'),
  CACHE_HIGH_WATERMARK_BYTES: z.coerce.number().int().positive().default(50 * 1024 ** 3),
  CACHE_LOW_WATERMARK_BYTES: z.coerce.number().int().positive().default(40 * 1024 ** 3),

  // Extractor
  TERABOX_EXTRACTOR_URL: z.string().url(),

  // CORS
  CORS_ORIGIN: z.string().default('*'),
});

export type RawEnv = z.infer<typeof schema>;
export interface Env extends Omit<RawEnv, 'COOKIE_SECURE' | 'SMTP_SECURE'> {
  COOKIE_SECURE: boolean;
  SMTP_SECURE: boolean;
}

function coerceBool(v: boolean | 'true' | 'false' | 'auto', fallback: () => boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback();
}

export const env: Env = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    const lines = Object.entries(fields).map(
      ([key, errs]) => `  ${key}: ${(errs ?? []).join(', ')}`,
    );
    // Write to stderr so PM2 error_file always captures this.
    process.stderr.write(
      `[FATAL] Environment validation failed:\n${lines.join('\n')}\n\n` +
        `Ensure all required variables are set in .env or the process environment.\n` +
        `Required: PUBLIC_BASE_URL, WEB_BASE_URL, DATABASE_URL, REDIS_URL, JWT_SECRET, SIGNING_SECRET, TERABOX_EXTRACTOR_URL\n`,
    );
    process.exit(1);
  }
  const r = parsed.data;
  return {
    ...r,
    COOKIE_SECURE: coerceBool(r.COOKIE_SECURE, () => r.NODE_ENV === 'production'),
    SMTP_SECURE: coerceBool(r.SMTP_SECURE, () => false),
  };
})();
