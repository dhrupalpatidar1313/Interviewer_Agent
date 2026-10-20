import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { buildCandidateContext, toIso } from '../candidate.js';
import { env } from '../env.js';
import { resolveEntitlement } from '../entitlement.js';
import { HttpError, rateLimit } from '../http.js';
import { clientServerUrl, createCandidateToken, participantIdentity } from '../livekit.js';
import { store, type InterviewRecord } from '../store/index.js';

/** True while the agent is holding the candidate's place after a disconnect. */
export function canRejoin(row: InterviewRecord): boolean {
  if (row.status !== 'in_progress' || !row.rejoinUntil) return false;
  return Date.parse(row.rejoinUntil) > Date.now();
}

/** An interview that never reported back (agent crashed, worker offline) should not stay "in progress" forever. */
export async function reapIfStale(row: InterviewRecord): Promise<InterviewRecord> {
  if (row.status !== 'in_progress' || !row.startedAt) return row;
  const startedMs = Date.parse(row.startedAt);
  // The agent force-closes at max + 4 minutes; anything still open well past that never reported back.
  const maxMs = (row.maxMinutes + 8) * 60_000;
  if (Number.isFinite(startedMs) && Date.now() - startedMs > maxMs) {
    await store.failStale(row.id);
    return { ...row, status: 'failed', endedBy: 'timeout', rejoinUntil: null };
  }
  return row;
}

async function getOwned(id: string, userId: string): Promise<InterviewRecord> {
  const row = await store.getInterview(id);
  // A malformed id and someone else's interview look the same from outside.
  if (!row || row.userId !== userId) throw new HttpError(404, 'Interview not found.');
  return reapIfStale(row);
}

function serialize(row: InterviewRecord, detail: boolean) {
  const base = {
    id: row.id,
    status: row.status,
    mode: row.mode,
    targetRole: row.snapshot?.profile.targetRole ?? null,
    experienceLevel: row.snapshot?.profile.experienceLevel ?? null,
    createdAt: toIso(row.createdAt),
    startedAt: toIso(row.startedAt),
    endedAt: toIso(row.endedAt),
    endedBy: row.endedBy,
    overallRating: row.report?.overallRating ?? null,
    canRejoin: canRejoin(row),
  };
  if (!detail) return base;
  return {
    ...base,
    maxMinutes: row.maxMinutes,
    report: row.report,
    transcript: row.transcript ?? [],
    assessments: row.assessments ?? [],
  };
}

export const interviewsRouter = Router();
interviewsRouter.use(requireAuth);

interviewsRouter.get('/', async (req, res) => {
  const rows = await store.listInterviews(req.user!.id, 50);
  const fresh = await Promise.all(rows.map(reapIfStale));
  res.json({ interviews: fresh.map((row) => serialize(row, false)) });
});

// Creating an interview can start a paid demo, so cap how often one person can ask.
const createLimiter = rateLimit(30, 15 * 60 * 1000, (req) => req.user?.id);

interviewsRouter.post('/', createLimiter, async (req, res) => {
  const userId = req.user!.id;
  // Supabase already refuses to sign in an unconfirmed address when "Confirm email" is on; this guards the demo
  // (which costs real money) against that setting ever being switched off.
  if (!(await store.isEmailConfirmed(userId))) {
    throw new HttpError(403, 'Confirm your email address first. We sent you a link when you signed up.', 'EMAIL_NOT_CONFIRMED');
  }
  const context = await buildCandidateContext(userId);
  if (!context) {
    throw new HttpError(
      409,
      'Complete your profile and upload your resume before starting an interview.',
      'ONBOARDING_INCOMPLETE',
    );
  }
  const entitlement = await resolveEntitlement(userId);
  if (entitlement.kind === 'blocked') throw new HttpError(409, entitlement.message, entitlement.code);

  // providerConfig records which providers ran this interview (never any key), and is what the agent reads later.
  const row = await store.createInterview(
    entitlement.kind === 'demo'
      ? { userId, snapshot: context, mode: 'demo', maxMinutes: entitlement.maxMinutes, providerConfig: { platform: true } }
      : {
          userId,
          snapshot: context,
          mode: 'byok',
          maxMinutes: env.INTERVIEW_MAX_MINUTES,
          providerConfig: { ...entitlement.selection },
        },
  );
  res.status(201).json({ interview: serialize(row, true) });
});

interviewsRouter.get('/:id', async (req, res) => {
  res.json({ interview: serialize(await getOwned(String(req.params.id), req.user!.id), true) });
});

/** Issues the LiveKit join token. Joining creates the room, which dispatches the interviewer agent. */
interviewsRouter.post('/:id/token', async (req, res) => {
  const user = req.user!;
  const row = await getOwned(String(req.params.id), user.id);
  const rejoining = canRejoin(row);
  if (row.status !== 'created' && !rejoining) {
    const message =
      row.status === 'in_progress'
        ? 'This interview is already in progress.'
        : 'This interview has already ended. Start a new one from your dashboard.';
    throw new HttpError(409, message, 'INTERVIEW_NOT_JOINABLE');
  }
  // One token per few seconds: a second tab or a double click would otherwise join with the same identity
  // and kick the first connection out.
  if (!(await store.claimToken(row.id, env.TOKEN_REISSUE_SECONDS))) {
    throw new HttpError(409, 'This interview is already starting. Wait a few seconds and try again.', 'TOKEN_RECENTLY_ISSUED');
  }
  const token = await createCandidateToken({
    userId: user.id,
    displayName: row.snapshot?.profile.fullName ?? user.name,
    roomName: row.roomName,
    interviewId: row.id,
    dispatch: !rejoining,
  });
  res.json({
    token,
    serverUrl: clientServerUrl(),
    roomName: row.roomName,
    identity: participantIdentity(user.id),
  });
});
