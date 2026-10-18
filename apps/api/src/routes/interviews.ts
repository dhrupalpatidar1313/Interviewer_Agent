import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { buildCandidateContext, toIso } from '../candidate.js';
import { all, one, parseJson, run } from '../db.js';
import { env } from '../env.js';
import { HttpError } from '../http.js';
import { clientServerUrl, createCandidateToken, participantIdentity } from '../livekit.js';
import type { Assessment, CandidateContext, InterviewReport, TranscriptTurn } from '../types.js';

export interface InterviewRow {
  id: string;
  user_id: string;
  room_name: string;
  status: string;
  snapshot: string;
  transcript: string | null;
  assessments: string | null;
  report: string | null;
  ended_by: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

/** An interview that never reported back (agent crashed, worker offline) should not stay "in progress" forever. */
function reapIfStale(row: InterviewRow): InterviewRow {
  if (row.status !== 'in_progress' || !row.started_at) return row;
  const startedMs = Date.parse(toIso(row.started_at) ?? '');
  const maxMs = (env.INTERVIEW_MAX_MINUTES + 15) * 60_000;
  if (Number.isFinite(startedMs) && Date.now() - startedMs > maxMs) {
    run("UPDATE interviews SET status = 'failed', ended_at = datetime('now'), ended_by = 'timeout' WHERE id = ?", row.id);
    return { ...row, status: 'failed', ended_by: 'timeout' };
  }
  return row;
}

function getOwned(id: string, userId: string): InterviewRow {
  const row = one<InterviewRow>('SELECT * FROM interviews WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw new HttpError(404, 'Interview not found.');
  return reapIfStale(row);
}

function serialize(row: InterviewRow, detail: boolean) {
  const snapshot = parseJson<CandidateContext | null>(row.snapshot, null);
  const report = parseJson<InterviewReport | null>(row.report, null);
  const base = {
    id: row.id,
    status: row.status,
    targetRole: snapshot?.profile.targetRole ?? null,
    experienceLevel: snapshot?.profile.experienceLevel ?? null,
    createdAt: toIso(row.created_at),
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    endedBy: row.ended_by,
    overallRating: report?.overallRating ?? null,
  };
  if (!detail) return base;
  return {
    ...base,
    maxMinutes: env.INTERVIEW_MAX_MINUTES,
    report,
    transcript: parseJson<TranscriptTurn[]>(row.transcript, []),
    assessments: parseJson<Assessment[]>(row.assessments, []),
  };
}

export const interviewsRouter = Router();
interviewsRouter.use(requireAuth);

interviewsRouter.get('/', (req, res) => {
  const rows = all<InterviewRow>(
    'SELECT * FROM interviews WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    req.user!.id,
  );
  res.json({ interviews: rows.map((row) => serialize(reapIfStale(row), false)) });
});

interviewsRouter.post('/', (req, res) => {
  const userId = req.user!.id;
  const context = buildCandidateContext(userId);
  if (!context) {
    throw new HttpError(
      409,
      'Complete your profile and upload your resume before starting an interview.',
      'ONBOARDING_INCOMPLETE',
    );
  }
  const id = randomUUID();
  run(
    'INSERT INTO interviews (id, user_id, room_name, snapshot) VALUES (?, ?, ?, ?)',
    id,
    userId,
    `interview-${id}`,
    JSON.stringify(context),
  );
  res.status(201).json({ interview: serialize(getOwned(id, userId), true) });
});

interviewsRouter.get('/:id', (req, res) => {
  res.json({ interview: serialize(getOwned(String(req.params.id), req.user!.id), true) });
});

/** Issues the LiveKit join token. Joining creates the room, which dispatches the interviewer agent. */
interviewsRouter.post('/:id/token', async (req, res) => {
  const user = req.user!;
  const row = getOwned(String(req.params.id), user.id);
  if (row.status !== 'created') {
    const message =
      row.status === 'in_progress'
        ? 'This interview is already in progress.'
        : 'This interview has already ended. Start a new one from your dashboard.';
    throw new HttpError(409, message, 'INTERVIEW_NOT_JOINABLE');
  }
  const snapshot = parseJson<CandidateContext | null>(row.snapshot, null);
  const token = await createCandidateToken({
    userId: user.id,
    displayName: snapshot?.profile.fullName ?? user.name,
    roomName: row.room_name,
    interviewId: row.id,
  });
  res.json({
    token,
    serverUrl: clientServerUrl(),
    roomName: row.room_name,
    identity: participantIdentity(user.id),
  });
});
