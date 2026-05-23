import type { NextConfig } from 'next';

const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PM2 runs `.next/standalone/server.js` in production.
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async rewrites() {
    return [
      // Proxy API calls to the Fastify backend so the browser stays on one origin.
      // In production with the supplied Nginx config, Nginx terminates this and
      // forwards directly — this rewrite is the in-process dev fallback.
      { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
    ];
  },
};

export default config;
