import type { NextConfig } from 'next';
import path from 'path';

const dev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  transpilePackages: ['@share-me/crypto'],

  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,

  // Standalone server bundle for Docker. Trace from the monorepo root so the
  // @share-me/crypto workspace package and hoisted deps are included.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),

  // Turbopack: set the monorepo root so workspace package files outside
  // apps/web are within the project scope and can be bundled.
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },

  // NOTE: Content-Security-Policy is intentionally NOT set here.
  // It is set per-request in proxy.ts with a fresh nonce so that Next 16's
  // injected RSC-streaming <script> tags are covered by 'nonce-{value}'.
  // A static CSP (no nonce) causes the browser to block those inline scripts
  // → React never hydrates → completely non-interactive UI.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
        ],
      },
    ];
  },

  // Dev-only: proxy /api/* to the Rust API so the client can reach it during
  // local development. In production, Traefik routes /api directly to the API
  // container — no Next.js proxy in the critical blob-streaming path.
  ...(dev && {
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: `${process.env.API_PUBLIC_URL ?? 'http://localhost:8080'}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
