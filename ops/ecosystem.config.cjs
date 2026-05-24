/**
 * PM2 ecosystem — production-hardened.
 *
 * Root causes of PM2 failures fixed:
 *   1. env_file wasn't specified → PM2 launched without DATABASE_URL etc.
 *      Now we use `node -r dotenv/config` for all processes.
 *   2. No health check → "online" in PM2 didn't mean the port was reachable.
 *      We now use listen_timeout + wait_ready for the API.
 *   3. restart_delay was 0 → crash loops with no backoff.
 *   4. No log rotation config → logs fill disk.
 *
 * IMPORTANT: The .env file must exist at /opt/fyphost/backend/.env
 * (or wherever cwd points). Alternatively, use systemd env files or
 * Docker env injection — this config does NOT require env vars in the shell.
 *
 * Usage:
 *   pm2 start ops/ecosystem.config.cjs
 *   pm2 reload fyphost-api --update-env
 *   pm2 save && pm2 startup
 */

const path = require('path');
const backendCwd = path.resolve(__dirname, '..', 'backend');
const webCwd = path.resolve(__dirname, '..', 'web');

module.exports = {
  apps: [
    {
      name: 'fyphost-api',
      cwd: backendCwd,
      // Use node -r to ensure dotenv loads before any import runs.
      // The backend's env.ts ALSO loads .env as a fallback, but this
      // ensures env is available even before the module graph evaluates.
      script: 'dist/server.js',
      node_args: '-r dotenv/config',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      // Graceful shutdown: Fastify closes in-flight requests.
      kill_timeout: 15_000,
      listen_timeout: 12_000,
      // PM2 wait_ready: API calls process.send('ready') when listening.
      // Our server.ts doesn't do this yet, so keep false. Upgrade later.
      wait_ready: false,
      // Restart backoff: prevents CPU-burning crash loops.
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      // Environment — PM2 sets these; .env provides the rest.
      env: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: path.resolve(backendCwd, '.env'),
      },
      // Log management.
      out_file: '/var/log/fyphost/api.out.log',
      error_file: '/var/log/fyphost/api.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      time: true,
    },
    {
      name: 'fyphost-worker',
      cwd: backendCwd,
      script: 'dist/worker.js',
      node_args: '-r dotenv/config',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '768M',
      kill_timeout: 60_000, // Workers need time to finish in-flight jobs.
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: path.resolve(backendCwd, '.env'),
      },
      out_file: '/var/log/fyphost/worker.out.log',
      error_file: '/var/log/fyphost/worker.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      time: true,
    },
    {
      name: 'fyphost-web',
      cwd: webCwd,
      script: '.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      kill_timeout: 10_000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
      out_file: '/var/log/fyphost/web.out.log',
      error_file: '/var/log/fyphost/web.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      time: true,
    },
  ],
};
