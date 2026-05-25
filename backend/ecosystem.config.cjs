/**
 * PM2 ecosystem for Fyphost.
 *
 * Two long-lived processes from the same compiled source:
 *   - fyphost-api    → `node dist/server.js`
 *   - fyphost-worker → `node dist/worker.js`
 *
 * Both read NODE_ENV/DATABASE_URL/REDIS_URL/etc from the environment;
 * pm2 inherits them (or pass `--env production` and define here in `env_production`).
 *
 * Recommended workflow:
 *   pm2 startOrReload ecosystem.config.cjs --update-env
 *
 * Notes:
 *   - The worker MUST run in fork mode and at most one instance per node.
 *     The cron schedules (cleanup-cache, cleanup-storage) are deduplicated by
 *     BullMQ repeatable-job IDs, so even if you scale workers across boxes
 *     they remain safe — but per-box a single worker process minimizes
 *     surprise.
 *   - The API can be scaled with `instances: 'max'` + `exec_mode: 'cluster'`
 *     once you confirm Fastify+Prisma+ioredis are happy under the cluster
 *     master. The defaults below stay conservative.
 *   - `wait_ready: true` makes pm2 wait for `process.send('ready')` before
 *     marking the process online during reload. The current code does not
 *     yet emit ready; until then we use min_uptime + listen_timeout for
 *     reload safety.
 */

module.exports = {
  apps: [
    {
      name: 'fyphost-api',
      cwd: __dirname,
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '768M',
      min_uptime: '10s',
      listen_timeout: 8000,
      kill_timeout: 8000,
      out_file: 'logs/api.out.log',
      error_file: 'logs/api.err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'fyphost-worker',
      cwd: __dirname,
      script: 'dist/worker.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1024M',
      min_uptime: '10s',
      kill_timeout: 30000,
      out_file: 'logs/worker.out.log',
      error_file: 'logs/worker.err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
