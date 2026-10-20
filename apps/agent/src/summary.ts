import { llm } from '@livekit/agents';
import { z } from 'zod';
import type { Assessment, InterviewReport, TranscriptTurn } from './types.js';

const reportSchema = z.object({
  overallRating: z.number().transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
  summary: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
});

const MAX_TRANSCRIPT_CHARS = 12_000;

/** Pulls the first JSON object out of a model reply, tolerating code fences or a sentence around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseReport(text: string): InterviewReport | null {
  const parsed = reportSchema.safeParse(extractJson(text));
  return parsed.success ? parsed.data : null;
}

/**
 * When a candidate ends the interview early there is no closing summary from the interviewer.
 * Ask the model for one from what was actually said, with a hard time limit. Returns null on any failure so the
 * caller can fall back to the plain average.
 */
export async function buildEarlyReport(
  transcript: TranscriptTurn[],
  assessments: Assessment[],
  /** The model to ask: the candidate's own for a byok interview, so the summary never spends the platform's quota. */
  model: llm.LLM,
  timeoutMs = 12_000,
): Promise<InterviewReport | null> {
  const conversation = transcript
    .map((t) => `${t.role === 'user' ? 'Candidate' : 'Interviewer'}: ${t.text}`)
    .join('\n')
    .slice(-MAX_TRANSCRIPT_CHARS);
  const rated = assessments.map((a) => `- ${a.topic}: ${a.rating}/5 (${a.notes})`).join('\n') || '(none recorded)';

  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({
    role: 'system',
    content:
      'You assess a job interview that ended early. Be honest and specific, base everything only on what the candidate actually said, and do not invent answers. Reply with a single JSON object and nothing else: {"overallRating": 1-5 integer, "summary": "3 to 5 sentences, mention that the interview ended early", "strengths": ["..."], "improvements": ["..."]}.',
  });
  chatCtx.addMessage({
    role: 'user',
    content: `Ratings recorded during the interview:\n${rated}\n\nTranscript:\n${conversation}`,
  });

  const stream = model.chat({ chatCtx });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      stream.collect(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return response ? parseReport(response.text) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try {
      stream.close();
    } catch {
      // Already finished or closed; nothing left to clean up.
    }
  }
}
