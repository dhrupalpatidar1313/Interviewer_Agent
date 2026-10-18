import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { one, run } from './db.js';
import { env, isProd } from './env.js';
import { HttpError, rateLimit } from './http.js';

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

const COOKIE_NAME = 'vi_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

function issueSession(res: Response, user: AuthUser) {
  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = req.cookies?.[COOKIE_NAME] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!token) throw new HttpError(401, 'Please sign in to continue.');

  let userId: string;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
    userId = payload.sub;
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }

  const row = one<UserRow>('SELECT id, email, name, password_hash FROM users WHERE id = ?', userId);
  if (!row) throw new HttpError(401, 'Account not found.');
  req.user = { id: row.id, email: row.email, name: row.name };
  next();
}

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.email('Enter a valid email address').max(200).transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.email('Enter a valid email address').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
});

// Compared against when the email is unknown so login timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export const authRouter = Router();
const limiter = rateLimit(20, 15 * 60 * 1000);

authRouter.post('/signup', limiter, async (req, res) => {
  const { name, email, password } = signupSchema.parse(req.body);
  if (one('SELECT id FROM users WHERE email = ?', email)) {
    throw new HttpError(409, 'An account with this email already exists.');
  }
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 12);
  run('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)', id, email, name, hash);
  const user: AuthUser = { id, email, name };
  issueSession(res, user);
  res.status(201).json({ user });
});

authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const row = one<UserRow>('SELECT id, email, name, password_hash FROM users WHERE email = ?', email);
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'Invalid email or password.');
  const user: AuthUser = { id: row.id, email: row.email, name: row.name };
  issueSession(res, user);
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const hasProfile = !!one('SELECT user_id FROM profiles WHERE user_id = ?', userId);
  const hasResume = !!one('SELECT user_id FROM resumes WHERE user_id = ?', userId);
  res.json({
    user: req.user,
    onboarding: { hasProfile, hasResume, complete: hasProfile && hasResume },
  });
});
