import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // API
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BASE_URL: z.string().url(),
  WEB_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

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

  TERABOX_EXTRACTOR_URL: z.string().url(),

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
    // eslint-disable-next-line no-console
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const r = parsed.data;
  return {
    ...r,
    COOKIE_SECURE: coerceBool(r.COOKIE_SECURE, () => r.NODE_ENV === 'production'),
    SMTP_SECURE: coerceBool(r.SMTP_SECURE, () => false),
  };
})();
