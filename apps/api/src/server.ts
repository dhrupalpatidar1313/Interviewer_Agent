import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { z } from 'zod';
import { authRouter } from './auth.js';
import { env } from './env.js';
import { HttpError, rateLimit } from './http.js';
import { internalRouter } from './routes/internal.js';
import { interviewsRouter } from './routes/interviews.js';
import { profileRouter } from './routes/profile.js';
import { providersRouter } from './routes/providers.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './swagger.js';

const app = express();
app.disable('x-powered-by');
// A JSON API: no CSP (it would break the Swagger UI page and protects nothing here). CORS decides who may call it, so
// the resource policy must not block the web origin.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Behind a platform proxy the client address comes from X-Forwarded-For, counted from the right; locally the Next.js dev proxy
// runs on loopback. Get this wrong in production and every caller shares one rate-limit bucket.
app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);

// Sign-in is a Supabase access token in the Authorization header, so there are no cookies to allow.
// WEB_ORIGIN may list several origins, comma-separated (for example the production domain and the *.vercel.app alias).
const webOrigins = env.WEB_ORIGIN.split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(cors({ origin: webOrigins, allowedHeaders: ['authorization', 'content-type'] }));

// Agent-only routes bring their own (larger) JSON parser.
// The agent is the only legitimate caller and makes a handful of requests per interview, so a generous per-IP cap
// still shuts down anyone guessing the shared key.
app.use('/internal', rateLimit(600, 60 * 1000), internalRouter);

app.use(express.json({ limit: '100kb' }));

// The first argument sets the custom URL path
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/interviews', interviewsRouter);
app.use('/api/providers', providersRouter);

app.use((_req, _res, next) => {
  next(new HttpError(404, 'Not found'));
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message ?? 'Invalid input',
      issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'That file is larger than 5 MB.' : err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON.' });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
};
app.use(errorHandler);

app.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});
