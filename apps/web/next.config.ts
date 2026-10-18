import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

// Share the repo-root .env with the API and agent.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Same-origin proxy: the browser only ever talks to Next, so the httpOnly auth cookie needs no CORS setup.
  // The agent-only /internal routes are deliberately NOT proxied.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
