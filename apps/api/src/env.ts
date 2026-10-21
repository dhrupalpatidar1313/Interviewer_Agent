import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseSecretKey } from './crypto.js';

// Repo root is three levels up from apps/api/src (and from apps/api/dist).
export const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
loadDotenv({ path: `${rootDir}.env`, quiet: true });

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // How many reverse proxies sit in front of the API: a number of hops, or "loopback" locally. Hosts differ, so measure it (GET /internal/whoami).
  // This decides which address rate limiting sees as the caller, so it must match the real topology.
  TRUST_PROXY: z.string().default('loopback'),
  INTERNAL_API_KEY: z.string().min(16, 'INTERNAL_API_KEY must be at least 16 characters'),

  // Supabase: accounts (Supabase Auth) and data (Postgres through the admin client). @supabase/server reads the
  // URL, the secret key and the JWKS from the environment itself; they are validated here so a typo fails at boot.
  SUPABASE_URL: z.url('SUPABASE_URL must be your project URL, e.g. https://<ref>.supabase.co'),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  // Encrypts candidates' own provider keys at rest (AES-256-GCM): `openssl rand -base64 32`. Back it up; without it
  // every stored key is unreadable. Required in production; in development the key-saving feature stays off without it.
  KEY_ENCRYPTION_SECRET: z.string().optional(),

  // The free demo interview that runs on the platform's own model keys (configured on the agent).
  DEMO_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  DEMO_MAX_MINUTES: z.coerce.number().int().min(3).max(30).default(8),
  // Demo interviews started per UTC day across all users (a spend guard; 0 = no limit) and per user.
  DEMO_DAILY_LIMIT: z.coerce.number().int().min(0).default(30),
  DEMO_ATTEMPTS_PER_DAY: z.coerce.number().int().min(1).default(3),

  // 'memory' exists for automated tests only and is refused in production.
  STORE_BACKEND: z.enum(['supabase', 'memory']).default('supabase'),
  LIVEKIT_URL: z.string().min(1, 'LIVEKIT_URL is required'),
  // Optional: URL the browser should use when it differs from the one the servers use (e.g. docker networking).
  LIVEKIT_PUBLIC_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().min(1, 'LIVEKIT_API_KEY is required'),
  LIVEKIT_API_SECRET: z.string().min(1, 'LIVEKIT_API_SECRET is required'),
  AGENT_NAME: z.string().default('ai-interviewer'),
  INTERVIEW_MAX_MINUTES: z.coerce.number().int().min(5).max(90).default(25),
  // Minimum gap between join tokens for one interview; stops two tabs racing for the same seat.
  TOKEN_REISSUE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
});

const parsed = schema
  .superRefine((value, ctx) => {
    if (value.STORE_BACKEND === 'supabase' && !value.SUPABASE_SECRET_KEY) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_SECRET_KEY'], message: 'SUPABASE_SECRET_KEY is required (sb_secret_...)' });
    }
    if (value.KEY_ENCRYPTION_SECRET) {
      try {
        parseSecretKey(value.KEY_ENCRYPTION_SECRET);
      } catch (err) {
        ctx.addIssue({ code: 'custom', path: ['KEY_ENCRYPTION_SECRET'], message: (err as Error).message });
      }
    } else if (value.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['KEY_ENCRYPTION_SECRET'], message: 'KEY_ENCRYPTION_SECRET is required in production' });
    }
    if (value.STORE_BACKEND === 'memory' && value.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['STORE_BACKEND'], message: 'The in-memory store is for tests and cannot run in production' });
    }
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example to .env in the repository root and fill it in.');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
