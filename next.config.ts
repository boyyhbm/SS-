import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '32kb' } },
  serverExternalPackages: ['@prisma/client', 'emailjs'],
  async headers() {
    return [
      {
        source:
          '/game-assets/:pack(vehicles|track-props)/:file([a-zA-Z0-9_-]+-[a-f0-9]{10}\\.[a-z0-9]+)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/game-assets/:pack(district-ultra-[a-f0-9]{10})/:file',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/game-assets/basis-r186/:file',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; object-src 'none'",
          },
        ],
      },
      {
        source: '/game-assets/:file([a-zA-Z0-9-]+-[a-f0-9]{10}\\.[a-z0-9]+)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
