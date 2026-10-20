import type { Assessment, CompletionPayload, InterviewReport, TranscriptTurn } from './types.js';

/**
 * What we send to the API on completion is partly model-written text. These caps sit at or below the API's own
 * limits (apps/api/src/routes/internal.ts), so a verbose answer can never make the whole save fail.
 */
export const LIMITS = {
  endedBy: 60,
  turns: 1500,
  turnText: 4000,
  assessments: 100,
  stage: 40,
  topic: 200,
  question: 600,
  notes: 1000,
  summary: 4000,
  listItem: 400,
  listItems: 10,
} as const;

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

function clampReport(report: InterviewReport): InterviewReport {
  return {
    overallRating: Math.min(5, Math.max(1, Math.round(report.overallRating))),
    summary: clip(report.summary, LIMITS.summary),
    strengths: report.strengths.slice(0, LIMITS.listItems).map((s) => clip(s, LIMITS.listItem)),
    improvements: report.improvements.slice(0, LIMITS.listItems).map((s) => clip(s, LIMITS.listItem)),
  };
}

export function clampPayload(payload: CompletionPayload): CompletionPayload {
  const transcript: TranscriptTurn[] = payload.transcript
    .slice(-LIMITS.turns)
    .map((turn) => ({ ...turn, text: clip(turn.text, LIMITS.turnText) }));
  const assessments: Assessment[] = payload.assessments.slice(0, LIMITS.assessments).map((a) => ({
    stage: clip(a.stage, LIMITS.stage),
    topic: clip(a.topic, LIMITS.topic),
    question: clip(a.question, LIMITS.question),
    rating: Math.min(5, Math.max(1, Math.round(a.rating))),
    notes: clip(a.notes, LIMITS.notes),
  }));
  return {
    endedBy: clip(payload.endedBy, LIMITS.endedBy),
    failed: payload.failed,
    transcript,
    assessments,
    report: payload.report ? clampReport(payload.report) : null,
  };
}

/** The reason strings the agent can end an interview with; the web app has a label for each. */
export const ENDED_BY = {
  completed: 'agent_completed',
  candidateEnded: 'candidate_ended',
  candidateLeft: 'candidate_left',
  noResponse: 'no_response',
  providerError: 'provider_error',
  timeLimit: 'time_limit',
} as const;
