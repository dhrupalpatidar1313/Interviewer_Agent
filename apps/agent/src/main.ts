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
import { fetchInterviewContext, markInterviewStarted, reportInterviewComplete } from './api.js';
import { InterviewerAgent, InterviewState } from './interviewer.js';
import { buildModels } from './models.js';
import type { Assessment, InterviewReport, TranscriptTurn } from './types.js';

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

    const state = new InterviewState(interview.candidate, interview.maxMinutes || cfg.defaultMaxMinutes);
    const agent = new InterviewerAgent(state);
    const { stt, llm, tts } = buildModels();

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

    // 2. Save results exactly once, whether the interview ends naturally, the candidate leaves, or time runs out.
    let finalized = false;
    const finalize = async (closeReason: string) => {
      if (finalized) return;
      finalized = true;
      agent.dispose();

      const transcript = collectTranscript(session);
      const spoke = transcript.some((turn) => turn.role === 'user');
      const report = state.report ?? fallbackReport(state.assessments);
      try {
        await reportInterviewComplete(interviewId, {
          endedBy: state.endedBy ?? closeReason,
          failed: !spoke,
          transcript,
          assessments: state.assessments,
          report,
        });
        logger.info({ interviewId, turns: transcript.length, rated: state.assessments.length }, 'interview saved');
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
      if (ev.newState !== 'away' || state.report) return;
      if (Date.now() - lastNudge < 45_000) return;
      lastNudge = Date.now();
      session.generateReply({
        instructions:
          'The candidate has been quiet for a while. In one short, kind sentence, check whether they need more time, want the question repeated, or would like to move on.',
      });
    });

    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      logger.error({ error: ev.error, interviewId }, 'agent session error');
    });

    // Publish stage + interviewer name as participant attributes; the web app renders them (stage rail, labels).
    const publish = (attrs: Record<string, string>) => {
      void ctx.room.localParticipant?.setAttributes(attrs).catch((err: unknown) => {
        logger.warn({ err }, 'could not publish participant attributes');
      });
    };
    state.onStageChange = (stage) => publish({ interview_stage: stage });

    // 4. Start. Restricting to the expected identity keeps stray participants out of the interview.
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: { participantIdentity: interview.participantIdentity },
    });
    publish({ interview_stage: state.stage, interviewer_name: cfg.interviewerName });

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
