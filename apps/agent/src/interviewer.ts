import { llm, voice } from '@livekit/agents';
import { z } from 'zod';
import { cfg } from './env.js';
import { buildInstructions, STAGES, type Stage } from './prompts.js';
import type { Assessment, CandidateContext, InterviewReport } from './types.js';

/**
 * Stand-in user message for the opening turn. Some chat templates (Qwen on Groq) reject a conversation with no
 * user message at all, which silently broke the greeting. It is dropped from the saved transcript.
 */
export const CANDIDATE_JOINED_MARKER = '[The candidate has just joined the call.]';

/** Mutable interview progress shared between the agent, its tools, and the worker's finalizer. */
export class InterviewState {
  stage: Stage = 'warmup';
  assessments: Assessment[] = [];
  report: InterviewReport | null = null;
  endedBy: string | null = null;
  timeNotice: 'soft' | 'hard' | null = null;
  /** Lets the worker publish the stage to the browser (shown as the progress rail). */
  onStageChange?: (stage: Stage) => void;
  readonly startedAt = Date.now();

  constructor(
    readonly candidate: CandidateContext,
    readonly maxMinutes: number,
    /** 'demo' is the free short interview: it never goes beyond the intermediate stage. */
    readonly mode: 'demo' | 'byok' = 'byok',
  ) {}

  elapsedMinutes(): number {
    return Math.round((Date.now() - this.startedAt) / 60_000);
  }

  instructions(): string {
    return buildInstructions(this.candidate, cfg.interviewerName, {
      stage: this.stage,
      assessments: this.assessments,
      elapsedMinutes: this.elapsedMinutes(),
      maxMinutes: this.maxMinutes,
      timeNotice: this.timeNotice,
      demo: this.mode === 'demo',
    });
  }

  /** Stages only move forward. Returns an explanation for the model when the move is not allowed. */
  advance(next: Stage): { ok: true } | { ok: false; message: string } {
    if (this.mode === 'demo' && next === 'advanced') {
      return {
        ok: false,
        message: 'This is a short demo interview, so there is no advanced stage. Stay in the intermediate stage, then move to wrapup.',
      };
    }
    if (STAGES.indexOf(next) <= STAGES.indexOf(this.stage)) {
      return { ok: false, message: `You are already in the ${this.stage} stage; stages only move forward. Carry on.` };
    }
    this.stage = next;
    this.onStageChange?.(next);
    return { ok: true };
  }
}

type AgentHolder = { agent?: InterviewerAgent };

function buildTools(state: InterviewState, holder: AgentHolder) {
  const refreshInstructions = async () => {
    await holder.agent?.updateInstructions(state.instructions());
  };

  return {
    record_assessment: llm.tool({
      description:
        'Silently record your assessment of the candidate\'s last substantive answer. Call it after each answered question. Never mention it to the candidate.',
      parameters: z.object({
        topic: z.string().describe('Short topic label, for example "SQL indexing" or "Leading the migration project"'),
        question: z.string().describe('The question you asked, in one short sentence'),
        rating: z
          .number()
          .int()
          .min(1)
          .max(5)
          .describe('1 = no relevant knowledge, 2 = weak, 3 = adequate, 4 = strong, 5 = excellent and deep'),
        notes: z.string().describe('One or two sentences of concrete evidence from their answer'),
      }),
      execute: async ({ topic, question, rating, notes }) => {
        state.assessments.push({ stage: state.stage, topic, question, rating, notes });
        await refreshInstructions();
        return 'Recorded. Do not mention this to the candidate. Continue the interview.';
      },
    }),

    advance_stage: llm.tool({
      description:
        'Move the interview to the next stage once the current stage is complete. Stages only move forward: warmup, fundamentals, intermediate, advanced, wrapup.',
      parameters: z.object({
        nextStage: z.enum(STAGES).describe('The stage to move to'),
        reason: z.string().describe('One sentence on why it is time to move on'),
      }),
      execute: async ({ nextStage }) => {
        const result = state.advance(nextStage);
        if (!result.ok) return result.message;
        await refreshInstructions();
        return `You are now in the ${nextStage} stage (about ${state.elapsedMinutes()} of ${state.maxMinutes} minutes used). Follow the guidance for this stage and continue naturally.`;
      },
    }),

    end_interview: llm.tool({
      description:
        'End the interview and save the summary. Call this only after you have said goodbye out loud, or if the candidate clearly asks to stop. After calling it, say nothing more.',
      parameters: z.object({
        overallRating: z.number().int().min(1).max(5).describe('Overall performance from 1 (weak) to 5 (excellent)'),
        summary: z.string().describe('Three to five sentences summarizing the candidate\'s performance, honest and specific'),
        strengths: z.array(z.string()).max(5).describe('Specific strengths observed'),
        improvements: z.array(z.string()).max(5).describe('Specific, actionable areas to improve'),
      }),
      execute: async ({ overallRating, summary, strengths, improvements }, { ctx }) => {
        if (state.report) return 'The interview has already been ended. Say nothing more.';
        state.report = { overallRating, summary, strengths, improvements };
        state.endedBy = 'agent_completed';
        // Drain lets any closing words that are still playing finish before the session closes.
        setTimeout(() => ctx.session.shutdown({ drain: true, reason: 'interview_completed' }), 0);
        return 'Saved. The interview will close on its own once your last words finish. Say nothing more.';
      },
    }),
  };
}

export class InterviewerAgent extends voice.Agent {
  private readonly state: InterviewState;
  private timers: NodeJS.Timeout[] = [];

  constructor(state: InterviewState) {
    const holder: AgentHolder = {};
    super({ instructions: state.instructions(), tools: buildTools(state, holder) });
    holder.agent = this;
    this.state = state;
  }

  override async onEnter(): Promise<void> {
    this.scheduleTimeChecks();
    this.session.generateReply({
      userInput: CANDIDATE_JOINED_MARKER,
      instructions:
        'Begin the interview now. Follow the warm-up stage guidance: greet the candidate by first name, introduce yourself, and ask your first easy question.',
    });
  }

  override async onExit(): Promise<void> {
    this.dispose();
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /**
   * Time pressure is applied through the instructions (no spoken interruption) at three minutes before the target,
   * then with an explicit closing turn two minutes past it, and a forced shutdown shortly after that.
   */
  private scheduleTimeChecks(): void {
    const minute = 60_000;
    const max = this.state.maxMinutes;

    this.timers.push(
      setTimeout(() => {
        if (this.state.report) return;
        this.state.timeNotice = 'soft';
        void this.updateInstructions(this.state.instructions());
      }, Math.max(max - 3, 1) * minute),
    );

    this.timers.push(
      setTimeout(() => {
        if (this.state.report) return;
        this.state.timeNotice = 'hard';
        void this.updateInstructions(this.state.instructions());
        this.session.generateReply({
          instructions: 'Time is up. Thank the candidate, say goodbye, and call end_interview.',
        });
      }, (max + 2) * minute),
    );

    this.timers.push(
      setTimeout(() => {
        if (this.state.report) return;
        this.state.endedBy = 'time_limit';
        this.session.shutdown({ drain: false, reason: 'time_limit' });
      }, (max + 4) * minute),
    );
  }
}
