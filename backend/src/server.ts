/**
 * API process entrypoint.
 *
 * Startup order:
 *   1. env.ts loads .env files and validates all required vars (fail-fast).
 *   2. Redis connectivity is validated BEFORE Fastify starts listening.
 *   3. Fastify builds the app (plugins + routes).
 *   4. app.listen() binds the port.
 *
 * If any step fails, the process exits with code 1 and a structured log
 * entry — PM2 captures this in error_file and applies restart_delay.
 */

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { disconnectRedis, validateRedis } from './config/redis.js';

async function main(): Promise<void> {
  // Validate infrastructure connectivity before building the app.
  try {
    await validateRedis();
  } catch (err) {
    logger.fatal({ err }, 'redis startup check failed');
    process.exit(1);
  }

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down api');
    try {
      await app.close();
      await disconnectPrisma();
      await disconnectRedis();
    } catch (err) {
      logger.error({ err }, 'shutdown error');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Catch unhandled rejections — log and let PM2 restart.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection — process will exit');
    process.exit(1);
  });

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'fyphost api listening');
}

main().catch((err) => {
  logger.fatal({ err }, 'api boot failure');
  process.exit(1);
});
