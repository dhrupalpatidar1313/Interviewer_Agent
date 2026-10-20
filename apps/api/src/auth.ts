import { fromSupabaseUrl } from '@supabase/server';
import { verifyCredentials } from '@supabase/server/core';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { env } from './env.js';
import { HttpError } from './http.js';
import { store } from './store/index.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

// Accounts are Supabase Auth users. The browser signs in with Supabase directly and sends its access token as
// "Authorization: Bearer <jwt>"; the API only verifies it. Pinning issuer and audience means a token from any other
// project or service that happens to share a JWKS is refused.
const ISSUER = fromSupabaseUrl(env.SUPABASE_URL);
const AUDIENCE = 'authenticated';

function readBearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  if (!/^Bearer\s+/i.test(header)) return null;
  return header.replace(/^Bearer\s+/i, '').trim() || null;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearer(req);
  if (!token) throw new HttpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED');

  const { data: auth, error } = await verifyCredentials(
    { token, apikey: null },
    { auth: 'user', issuer: ISSUER, audience: AUDIENCE },
  );
  if (error) {
    // 500 means we could not verify at all (for example the JWKS could not be fetched); the session may be fine.
    if (error.status >= 500) {
      console.error('Token verification unavailable:', error.code, error.message);
      throw new HttpError(503, 'Sign-in is temporarily unavailable. Please try again in a moment.', 'AUTH_UNAVAILABLE');
    }
    throw new HttpError(401, 'Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  }

  const claims = auth?.userClaims;
  if (!claims?.id || auth?.jwtClaims?.is_anonymous) {
    throw new HttpError(401, 'Please sign in with an account to continue.', 'UNAUTHENTICATED');
  }

  const metaName = claims.userMetadata?.name ?? claims.userMetadata?.full_name;
  const email = claims.email ?? '';
  req.user = {
    id: claims.id,
    email,
    name: typeof metaName === 'string' && metaName.trim() ? metaName.trim() : email.split('@')[0] || 'there',
  };
  next();
}

export const authRouter = Router();

authRouter.get('/me', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const [profile, resume] = await Promise.all([store.getProfile(userId), store.getResume(userId)]);
  const hasProfile = !!profile;
  const hasResume = !!resume;
  res.json({
    user: req.user,
    onboarding: { hasProfile, hasResume, complete: hasProfile && hasResume },
  });
});
