import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Guards /internal routes, which are only meant for the agent worker. */
export function requireInternalKey(req: Request, _res: Response, next: NextFunction) {
  const key = req.header('x-internal-key') ?? '';
  if (!safeEqual(key, env.INTERNAL_API_KEY)) {
    throw new HttpError(401, 'Invalid internal key');
  }
  next();
}

/** Minimal fixed-window rate limiter keyed by client IP. Fine for a single instance. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count += 1;
      if (entry.count > max) {
        throw new HttpError(429, 'Too many attempts. Please try again later.');
      }
    }
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    }
    next();
  };
}
