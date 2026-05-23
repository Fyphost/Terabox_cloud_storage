import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(16),
  SIGNING_SECRET: z.string().min(16),
  SIGNING_KEY_VERSION: z.string().default('v1'),

  STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
  STORAGE_CACHE_DIR: z.string().default('./storage/cache'),
  STORAGE_PERMANENT_DIR: z.string().default('./storage/permanent'),
  CACHE_HIGH_WATERMARK_BYTES: z.coerce.number().int().positive().default(50 * 1024 ** 3),
  CACHE_LOW_WATERMARK_BYTES: z.coerce.number().int().positive().default(40 * 1024 ** 3),

  TERABOX_EXTRACTOR_URL: z.string().url(),

  CORS_ORIGIN: z.string().default('*'),
  SIGNED_URL_TTL_SEC: z.coerce.number().int().positive().default(6 * 3600),
});

export type Env = z.infer<typeof schema>;

export const env: Env = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
})();
