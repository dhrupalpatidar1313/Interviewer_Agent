import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Repo root is three levels up from apps/api/src (and from apps/api/dist).
export const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
loadDotenv({ path: `${rootDir}.env`, quiet: true });

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  INTERNAL_API_KEY: z.string().min(16, 'INTERNAL_API_KEY must be at least 16 characters'),
  DATABASE_PATH: z.string().default('./data/interviewer.db'),
  LIVEKIT_URL: z.string().min(1, 'LIVEKIT_URL is required'),
  // Optional: URL the browser should use when it differs from the one the servers use (e.g. docker networking).
  LIVEKIT_PUBLIC_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().min(1, 'LIVEKIT_API_KEY is required'),
  LIVEKIT_API_SECRET: z.string().min(1, 'LIVEKIT_API_SECRET is required'),
  AGENT_NAME: z.string().default('ai-interviewer'),
  INTERVIEW_MAX_MINUTES: z.coerce.number().int().min(5).max(90).default(25),
});

const parsed = schema.safeParse(process.env);
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
