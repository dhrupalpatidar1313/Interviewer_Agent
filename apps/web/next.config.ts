import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

// Share the repo-root .env with the API and agent.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The browser signs in with Supabase directly, so it needs the project URL and the publishable key (safe to expose;
  // the secret key never leaves the API). They are read from the shared root .env under their server-side names.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  },
  // Same-origin proxy: the browser only ever talks to Next for the API, so no CORS setup is needed.
  // The agent-only /internal routes are deliberately NOT proxied.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
