import type { NextConfig } from 'next';

const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async rewrites() {
    return [
      // Proxy API calls in dev so the browser stays on one origin.
      { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
    ];
  },
};

export default config;
