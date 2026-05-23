/**
 * PM2 ecosystem for Fyphost.
 *
 * Three long-running processes:
 *   - fyphost-api      : Fastify API
 *   - fyphost-worker   : BullMQ workers (save / cleanup)
 *   - fyphost-web      : Next.js standalone server
 *
 * Usage:
 *   pm2 start ops/ecosystem.config.cjs
 *   pm2 reload fyphost-api          # zero-downtime reload
 *   pm2 logs fyphost-worker --lines 200
 *   pm2 save && pm2 startup         # persist on reboot
 */

module.exports = {
  apps: [
    {
      name: 'fyphost-api',
      cwd: __dirname + '/../backend',
      script: 'dist/server.js',
      // Cluster mode for horizontal scaling on multi-core boxes.
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      kill_timeout: 10_000,
      listen_timeout: 10_000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production',
      },
      out_file: '/var/log/fyphost/api.out.log',
      error_file: '/var/log/fyphost/api.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'fyphost-worker',
      cwd: __dirname + '/../backend',
      script: 'dist/worker.js',
      // Workers should run as a single process so BullMQ concurrency settings
      // apply predictably; horizontally scale by adding more boxes / replicas.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '768M',
      kill_timeout: 30_000,
      env: {
        NODE_ENV: 'production',
      },
      out_file: '/var/log/fyphost/worker.out.log',
      error_file: '/var/log/fyphost/worker.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'fyphost-web',
      cwd: __dirname + '/../web',
      // Next 15 standalone build. If you don't use standalone, swap to:
      //   script: 'node_modules/next/dist/bin/next', args: 'start -p 3000'
      script: '.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
      },
      out_file: '/var/log/fyphost/web.out.log',
      error_file: '/var/log/fyphost/web.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
