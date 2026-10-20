import express, { Router } from 'express';
import { z } from 'zod';
import { HttpError, requireInternalKey } from '../http.js';
import { getSecretBox, keyContext } from '../keys.js';
import { participantIdentity } from '../livekit.js';
import { isProviderId, PROVIDERS, STAGES, type Stage } from '../providers.js';
import { store, type InterviewRecord, type StageSelection } from '../store/index.js';

/**
 * Endpoints used only by the agent worker, authenticated with INTERNAL_API_KEY.
 * Never expose these through the public proxy.
 */
export const internalRouter = Router();
internalRouter.use(requireInternalKey);
internalRouter.use(express.json({ limit: '10mb' }));

async function getInterview(id: string): Promise<InterviewRecord> {
  const row = await store.getInterview(id);
  if (!row) throw new HttpError(404, 'Interview not found.');
  return row;
}

/** One stage of the candidate's own models, with the key decrypted. Only this endpoint ever returns key material. */
interface StageModel {
  provider: string;
  model: string;
  voice?: string;
  apiKey: string;
}

/**
 * For a candidate-keyed (byok) interview: the providers chosen when it was created, with their keys decrypted now.
 * Demo interviews return null and the agent uses the platform's own models.
 */
async function resolveModels(row: InterviewRecord): Promise<Record<Stage, StageModel> | null> {
  if (row.mode !== 'byok') return null;
  const config = (row.providerConfig ?? {}) as Partial<Record<Stage, StageSelection>>;
  const box = getSecretBox();
  const out: Partial<Record<Stage, StageModel>> = {};
  for (const stage of STAGES) {
    const chosen = config[stage];
    if (!chosen || !isProviderId(chosen.provider)) {
      throw new HttpError(409, `This interview has no ${stage} provider.`, 'NO_PROVIDER');
    }
    const stored = await store.getProviderKey(row.userId, chosen.provider);
    if (!stored) {
      throw new HttpError(409, `The ${PROVIDERS[chosen.provider].label} key was removed.`, 'KEY_REMOVED');
    }
    out[stage] = {
      provider: chosen.provider,
      model: chosen.model,
      ...(chosen.voice ? { voice: chosen.voice } : {}),
      apiKey: box.decrypt(stored, keyContext(row.userId, chosen.provider)),
    };
  }
  return out as Record<Stage, StageModel>;
}

internalRouter.get('/interviews/:id/context', async (req, res) => {
  const row = await getInterview(String(req.params.id));
  if (row.status !== 'created' && row.status !== 'in_progress') {
    throw new HttpError(409, `Interview is ${row.status}.`);
  }
  const models = await resolveModels(row);
  res.set('cache-control', 'no-store');
  res.json({
    interviewId: row.id,
    userId: row.userId,
    participantIdentity: participantIdentity(row.userId),
    status: row.status,
    mode: row.mode,
    maxMinutes: row.maxMinutes,
    candidate: row.snapshot,
    models,
  });
});

internalRouter.post('/interviews/:id/started', async (req, res) => {
  const row = await getInterview(String(req.params.id));
  if (row.status === 'created') await store.markStarted(row.id);
  res.json({ ok: true });
});

/**
 * The agent's payload is model-written text, so an over-long field must never cost the candidate the whole
 * interview: trim to the limit instead of rejecting.
 */
const clip = (max: number) => z.string().transform((value) => value.slice(0, max));
const clipList = (max: number, items: number) =>
  z.array(clip(max)).transform((list) => list.slice(0, items));

const completeSchema = z.object({
  endedBy: clip(60).default('unknown'),
  failed: z.boolean().default(false),
  transcript: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: clip(8000),
        at: z.number(),
      }),
    )
    .default([])
    .transform((turns) => turns.slice(-2000)),
  assessments: z
    .array(
      z.object({
        stage: clip(40),
        topic: clip(200),
        question: clip(600),
        rating: z.number().transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
        notes: clip(1000),
      }),
    )
    .default([])
    .transform((list) => list.slice(0, 100)),
  report: z
    .object({
      overallRating: z.number().transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
      summary: clip(4000),
      strengths: clipList(400, 10),
      improvements: clipList(400, 10),
    })
    .nullable()
    .default(null),
});

/** Idempotent: the agent may report from both its close event and its shutdown hook. */
internalRouter.post('/interviews/:id/complete', async (req, res) => {
  const row = await getInterview(String(req.params.id));
  if (row.status === 'completed' || row.status === 'failed') {
    res.json({ ok: true, alreadyFinalized: true });
    return;
  }
  const body = completeSchema.parse(req.body);
  // The store only lets the first report for an open interview through, so two racing reports cannot both write.
  const written = await store.complete(row.id, {
    status: body.failed ? 'failed' : 'completed',
    endedBy: body.endedBy,
    transcript: body.transcript,
    assessments: body.assessments,
    report: body.report,
  });
  res.json(written ? { ok: true } : { ok: true, alreadyFinalized: true });
});

const presenceSchema = z.object({
  /** Epoch milliseconds until which the agent holds the candidate's place, or null when they are connected. */
  rejoinUntil: z.number().int().nullable(),
});

/** The agent reports a candidate disconnect (with a deadline) or their return (null). */
internalRouter.post('/interviews/:id/presence', async (req, res) => {
  const row = await getInterview(String(req.params.id));
  const { rejoinUntil } = presenceSchema.parse(req.body);
  await store.setRejoinUntil(row.id, rejoinUntil === null ? null : new Date(rejoinUntil));
  res.json({ ok: true });
});
