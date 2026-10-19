import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authRouter } from './auth.js';
import './db.js';
import { env } from './env.js';
import { HttpError } from './http.js';
import { internalRouter } from './routes/internal.js';
import { interviewsRouter } from './routes/interviews.js';
import { profileRouter } from './routes/profile.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './swagger.js';

const app = express();
app.disable('x-powered-by');
// The Next.js dev proxy runs on loopback and forwards the client IP.
app.set('trust proxy', 'loopback');

app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(cookieParser());

// Agent-only routes bring their own (larger) JSON parser.
app.use('/internal', internalRouter);

app.use(express.json({ limit: '100kb' }));

// The first argument sets the custom URL path
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/interviews', interviewsRouter);

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
