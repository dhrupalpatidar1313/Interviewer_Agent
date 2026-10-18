import express, { Router } from 'express';
import { z } from 'zod';
import { one, parseJson, run } from '../db.js';
import { env } from '../env.js';
import { HttpError, requireInternalKey } from '../http.js';
import { participantIdentity } from '../livekit.js';
import type { CandidateContext } from '../types.js';
import type { InterviewRow } from './interviews.js';

/**
 * Endpoints used only by the agent worker, authenticated with INTERNAL_API_KEY.
 * Never expose these through the public proxy.
 */
export const internalRouter = Router();
internalRouter.use(requireInternalKey);
internalRouter.use(express.json({ limit: '2mb' }));

function getInterview(id: string): InterviewRow {
  const row = one<InterviewRow>('SELECT * FROM interviews WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Interview not found.');
  return row;
}

internalRouter.get('/interviews/:id/context', (req, res) => {
  const row = getInterview(String(req.params.id));
  if (row.status !== 'created' && row.status !== 'in_progress') {
    throw new HttpError(409, `Interview is ${row.status}.`);
  }
  res.json({
    interviewId: row.id,
    userId: row.user_id,
    participantIdentity: participantIdentity(row.user_id),
    status: row.status,
    maxMinutes: env.INTERVIEW_MAX_MINUTES,
    candidate: parseJson<CandidateContext | null>(row.snapshot, null),
  });
});

internalRouter.post('/interviews/:id/started', (req, res) => {
  const row = getInterview(String(req.params.id));
  if (row.status === 'created') {
    run("UPDATE interviews SET status = 'in_progress', started_at = datetime('now') WHERE id = ?", row.id);
  }
  res.json({ ok: true });
});

const completeSchema = z.object({
  endedBy: z.string().max(60).default('unknown'),
  failed: z.boolean().default(false),
  transcript: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(8000),
        at: z.number(),
      }),
    )
    .max(2000)
    .default([]),
  assessments: z
    .array(
      z.object({
        stage: z.string().max(40),
        topic: z.string().max(200),
        question: z.string().max(600),
        rating: z.number().int().min(1).max(5),
        notes: z.string().max(1000),
      }),
    )
    .max(100)
    .default([]),
  report: z
    .object({
      overallRating: z.number().int().min(1).max(5),
      summary: z.string().max(4000),
      strengths: z.array(z.string().max(400)).max(10),
      improvements: z.array(z.string().max(400)).max(10),
    })
    .nullable()
    .default(null),
});

/** Idempotent: the agent may report from both its close event and its shutdown hook. */
internalRouter.post('/interviews/:id/complete', (req, res) => {
  const row = getInterview(String(req.params.id));
  if (row.status === 'completed' || row.status === 'failed') {
    res.json({ ok: true, alreadyFinalized: true });
    return;
  }
  const body = completeSchema.parse(req.body);
  run(
    `UPDATE interviews
        SET status = ?, transcript = ?, assessments = ?, report = ?, ended_by = ?,
            started_at = COALESCE(started_at, datetime('now')), ended_at = datetime('now')
      WHERE id = ?`,
    body.failed ? 'failed' : 'completed',
    JSON.stringify(body.transcript),
    JSON.stringify(body.assessments),
    body.report ? JSON.stringify(body.report) : null,
    body.endedBy,
    row.id,
  );
  res.json({ ok: true });
});
