import { cfg } from './env.js';
// ^ keep first: loads .env before the LiveKit SDK reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.

import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  log,
  voice,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { fetchInterviewContext, markInterviewStarted, reportInterviewComplete, reportPresence } from './api.js';
import { CANDIDATE_JOINED_MARKER, InterviewerAgent, InterviewState } from './interviewer.js';
import { buildLlm, buildModels } from './models.js';
import { ENDED_BY, clampPayload } from './payload.js';
import { buildEarlyReport } from './summary.js';
import type { Assessment, InterviewReport, TranscriptTurn } from './types.js';

/** The browser publishes `{ "type": "end" }` here when the candidate presses End, as opposed to a dropped connection. */
const CONTROL_TOPIC = 'interview.control';
/** After a non-recoverable provider error, leave this long for the browser to show why before closing. */
const PROVIDER_ERROR_CLOSE_DELAY_MS = 4000;
/** Below this many spoken words there is nothing worth summarising, so the interview is saved without a report. */
const MIN_WORDS_FOR_SUMMARY = 20;

/**
 * What the browser is told when a model provider fails for good, so the candidate can act on it:
 * a rejected key (fix it in Settings), a rate limit (wait, or the demo is out of capacity), a retired model.
 */
function describeProviderError(error: unknown, mode: 'demo' | 'byok'): string {
  const status = (error as { error?: { statusCode?: number } } | undefined)?.error?.statusCode;
  if (status === 401 || status === 403) return mode === 'demo' ? 'provider_error' : 'key_rejected';
  if (status === 429) return mode === 'demo' ? 'demo_capacity' : 'rate_limited';
  if (status === 404) return mode === 'demo' ? 'provider_error' : 'model_unavailable';
  return ENDED_BY.providerError;
}

/** Enough to diagnose a provider failure, and nothing that could carry a key or a candidate's words. */
function summarizeError(error: unknown) {
  const e = error as { type?: string; label?: string; recoverable?: boolean; error?: { statusCode?: number; name?: string; body?: { code?: string } } };
  return { type: e?.type, label: e?.label, recoverable: e?.recoverable, status: e?.error?.statusCode, name: e?.error?.name, code: e?.error?.body?.code };
}

function parseInterviewId(metadata: string): string | null {
  try {
    const parsed = JSON.parse(metadata) as { interviewId?: unknown };
    return typeof parsed.interviewId === 'string' && parsed.interviewId ? parsed.interviewId : null;
  } catch {
    return null;
  }
}

function collectTranscript(session: voice.AgentSession): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const item of session.history.items) {
    if (item.type !== 'message' || (item.role !== 'user' && item.role !== 'assistant')) continue;
    const text = (item.textContent ?? '').trim();
    if (item.role === 'user' && text === CANDIDATE_JOINED_MARKER) continue; // synthetic opening turn, not speech
    if (text) turns.push({ role: item.role, text, at: item.createdAt });
  }
  return turns;
}

/** Used only when the candidate leaves before the interviewer could write a closing summary. */
function fallbackReport(assessments: Assessment[]): InterviewReport | null {
  if (assessments.length === 0) return null;
  const avg = assessments.reduce((sum, a) => sum + a.rating, 0) / assessments.length;
  const sorted = [...assessments].sort((a, b) => b.rating - a.rating);
  return {
    overallRating: Math.min(5, Math.max(1, Math.round(avg))),
    summary: `The interview ended before the closing summary was written. This rating is the average of ${assessments.length} assessed answer${assessments.length === 1 ? '' : 's'}.`,
    strengths: sorted.filter((a) => a.rating >= 4).slice(0, 3).map((a) => a.topic),
    improvements: sorted
      .filter((a) => a.rating <= 2)
      .slice(-3)
      .map((a) => a.topic),
  };
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const logger = log();

    const interviewId = parseInterviewId(ctx.job.metadata);
    if (!interviewId) {
      logger.error({ metadata: ctx.job.metadata }, 'dispatch metadata has no interviewId; refusing job');
      ctx.shutdown('missing interview id');
      return;
    }

    // 1. Load the candidate's form details + resume text from the API.
    let interview;
    try {
      interview = await fetchInterviewContext(interviewId);
    } catch (err) {
      logger.error({ err, interviewId }, 'could not load interview context');
      ctx.shutdown('context unavailable');
      return;
    }
    if (!interview.candidate) {
      logger.error({ interviewId }, 'interview has no candidate snapshot');
      ctx.shutdown('no candidate data');
      return;
    }

    const state = new InterviewState(interview.candidate, interview.maxMinutes || cfg.defaultMaxMinutes, interview.mode);
    const agent = new InterviewerAgent(state);

    // A candidate's own keys live only in this job's memory. Never log `interview.models`.
    let pipeline;
    try {
      pipeline = buildModels(interview.models);
    } catch (err) {
      logger.error({ message: (err as Error).message, interviewId, mode: interview.mode }, 'could not set up the interview models');
      // Close the interview as "did not run" so the candidate is told, rather than left waiting for an interviewer.
      await reportInterviewComplete(interviewId, {
        endedBy: ENDED_BY.providerError,
        failed: true,
        transcript: [],
        assessments: [],
        report: null,
      }).catch((reportErr: unknown) => logger.error({ err: reportErr, interviewId }, 'could not report the setup failure'));
      ctx.shutdown('models unavailable');
      return;
    }
    const { stt, llm, tts } = pipeline;

    const session = new voice.AgentSession({
      stt,
      llm,
      tts,
      vad: ctx.proc.userData.vad as silero.VAD,
      // Candidates pause to think, so wait longer than the chat defaults before deciding the turn is over.
      // inference.TurnDetector is an audio end-of-turn model: hosted on LiveKit Cloud, otherwise run on-device.
      turnHandling: {
        turnDetection: cfg.useTurnDetector ? new inference.TurnDetector() : 'vad',
        endpointing: { minDelay: 700, maxDelay: 5000 },
      },
      userAwayTimeout: 25,
    });

    // Publish stage + interviewer name as participant attributes; the web app renders them (stage rail, labels).
    const publish = (attrs: Record<string, string>) => {
      void ctx.room.localParticipant?.setAttributes(attrs).catch((err: unknown) => {
        logger.warn({ err }, 'could not publish participant attributes');
      });
    };
    state.onStageChange = (stage) => publish({ interview_stage: stage });

    const candidateIdentity = interview.participantIdentity;
    let candidatePresent = true;
    let heardCandidate = false;
    let graceTimer: NodeJS.Timeout | undefined;
    let silenceTimer: NodeJS.Timeout | undefined;

    /** Ends the session for a known reason; the Close handler below then saves everything exactly once. */
    const endSession = (endedBy: string, reason: string) => {
      state.endedBy ??= endedBy;
      session.shutdown({ drain: false, reason });
    };

    // 2. Save results exactly once, whether the interview ends naturally, the candidate leaves, or time runs out.
    let finalized = false;
    const finalize = async (closeReason: string) => {
      if (finalized) return;
      finalized = true;
      agent.dispose();
      clearTimeout(graceTimer);
      clearTimeout(silenceTimer);

      const transcript = collectTranscript(session);
      const candidateTurns = transcript.filter((turn) => turn.role === 'user');
      const spoke = candidateTurns.length > 0;
      // How much the candidate actually said, so one long answer counts and a lone "hello" does not.
      const candidateWords = candidateTurns.reduce((n, turn) => n + turn.text.split(/\s+/).filter(Boolean).length, 0);
      const endedBy = state.endedBy ?? closeReason;

      // An early end has no closing summary from the interviewer, so write one from what was actually said.
      // Not after a provider error: the model is the thing that broke.
      let report = state.report;
      if (!report && candidateWords >= MIN_WORDS_FOR_SUMMARY && endedBy !== ENDED_BY.providerError) {
        report = await buildEarlyReport(transcript, state.assessments, buildLlm(interview.models?.llm)).catch(() => null);
      }
      report ??= fallbackReport(state.assessments);

      try {
        await reportInterviewComplete(
          interviewId,
          clampPayload({
            endedBy,
            failed: !spoke,
            transcript,
            assessments: state.assessments,
            report,
          }),
        );
        logger.info({ interviewId, turns: transcript.length, rated: state.assessments.length, endedBy }, 'interview saved');
      } catch (err) {
        logger.error({ err, interviewId }, 'FAILED to save interview results');
      }
    };

    session.on(voice.AgentSessionEventTypes.Close, async (ev) => {
      await finalize(String(ev.reason));
      ctx.shutdown('interview finished');
    });
    ctx.addShutdownCallback(async () => {
      await finalize('job_shutdown');
    });

    // 3. If the candidate goes quiet for a while, check in gently (at most once every 45 seconds).
    let lastNudge = 0;
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState !== 'away' || state.report || !candidatePresent) return;
      if (Date.now() - lastNudge < 45_000) return;
      lastNudge = Date.now();
      session.generateReply({
        instructions:
          'The candidate has been quiet for a while. In one short, kind sentence, check whether they need more time, want the question repeated, or would like to move on.',
      });
    });

    // 4. A candidate who never says anything is not worth a full-length session.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!ev.isFinal || !ev.transcript.trim() || heardCandidate) return;
      heardCandidate = true;
      clearTimeout(silenceTimer);
    });

    // 5. Provider errors: one failure can be a blip, but a broken model leaves the interviewer silent. If the
    //    interviewer has never managed to speak, or a second unrecoverable error follows, say so and stop.
    let fatalErrors = 0;
    let closingOnError = false;
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      logger.error({ error: summarizeError(ev.error), interviewId }, 'agent session error');
      if (ev.error.recoverable !== false || state.report || finalized || closingOnError) return;
      fatalErrors += 1;
      const interviewerHasSpoken = session.history.items.some(
        (item) => item.type === 'message' && item.role === 'assistant',
      );
      if (fatalErrors < 2 && interviewerHasSpoken) return;
      closingOnError = true;
      publish({ interview_error: describeProviderError(ev.error, interview.mode) });
      setTimeout(() => endSession(ENDED_BY.providerError, ENDED_BY.providerError), PROVIDER_ERROR_CLOSE_DELAY_MS);
    });

    // 6. Connection handling. The candidate's browser can refresh or lose its connection; hold their place for a
    //    short time instead of throwing the interview away. A deliberate End arrives as a control message and
    //    skips the wait.
    const reportCandidatePresence = (rejoinUntil: number | null) => {
      void reportPresence(interviewId, rejoinUntil).catch((err: unknown) => {
        logger.warn({ err, interviewId }, 'could not report candidate presence');
      });
    };

    ctx.room.on('participantDisconnected', (participant) => {
      if (participant.identity !== candidateIdentity || finalized || state.report) return;
      candidatePresent = false;
      const graceMs = cfg.rejoinGraceSeconds * 1000;
      logger.info({ interviewId, graceSeconds: cfg.rejoinGraceSeconds }, 'candidate disconnected; holding their place');
      reportCandidatePresence(Date.now() + graceMs);
      clearTimeout(graceTimer);
      graceTimer = setTimeout(() => endSession(ENDED_BY.candidateLeft, ENDED_BY.candidateLeft), graceMs);
    });

    ctx.room.on('participantConnected', (participant) => {
      if (participant.identity !== candidateIdentity || finalized) return;
      candidatePresent = true;
      clearTimeout(graceTimer);
      logger.info({ interviewId }, 'candidate reconnected');
      reportCandidatePresence(null);
    });

    ctx.room.on('dataReceived', (payload, participant, _kind, topic) => {
      if (topic !== CONTROL_TOPIC || participant?.identity !== candidateIdentity || finalized) return;
      let type: unknown;
      try {
        type = (JSON.parse(new TextDecoder().decode(payload)) as { type?: unknown }).type;
      } catch {
        return;
      }
      if (type !== 'end') return;
      logger.info({ interviewId }, 'candidate ended the interview');
      clearTimeout(graceTimer);
      endSession(ENDED_BY.candidateEnded, ENDED_BY.candidateEnded);
    });

    // 7. Start. Restricting to the expected identity keeps stray participants out of the interview.
    //    closeOnDisconnect is off because disconnects are handled above (grace period) rather than closing at once.
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: { participantIdentity: interview.participantIdentity, closeOnDisconnect: false },
    });
    publish({ interview_stage: state.stage, interviewer_name: cfg.interviewerName });

    silenceTimer = setTimeout(() => {
      if (heardCandidate || state.report || finalized) return;
      logger.info({ interviewId, seconds: cfg.noResponseSeconds }, 'no response from the candidate; ending');
      endSession(ENDED_BY.noResponse, ENDED_BY.noResponse);
    }, cfg.noResponseSeconds * 1000);

    try {
      await markInterviewStarted(interviewId);
    } catch (err) {
      logger.warn({ err, interviewId }, 'could not mark interview as started');
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: cfg.agentName,
  }),
);
