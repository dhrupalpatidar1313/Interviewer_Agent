import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Must be imported before anything from @livekit/agents so LIVEKIT_URL / keys are in process.env.
// Repo root is three levels up from apps/agent/src (and from apps/agent/dist).
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const cfg = {
  apiUrl: (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  internalKey: process.env.INTERNAL_API_KEY ?? '',
  agentName: process.env.AGENT_NAME ?? 'ai-interviewer',
  interviewerName: process.env.INTERVIEWER_NAME ?? 'Alex',

  modelProvider: (process.env.MODEL_PROVIDER ?? 'plugins') as 'plugins' | 'inference',
  openaiLlmModel: process.env.OPENAI_LLM_MODEL ?? 'gpt-4.1-mini',
  openaiTtsModel: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
  deepgramKey: process.env.DEEPGRAM_API_KEY ?? '',
  inferenceSttModel: process.env.INFERENCE_STT_MODEL ?? 'deepgram/nova-3',
  inferenceLlmModel: process.env.INFERENCE_LLM_MODEL ?? 'openai/gpt-4.1-mini',
  inferenceTtsModel: process.env.INFERENCE_TTS_MODEL ?? 'cartesia/sonic-3',
  inferenceTtsVoice: process.env.INFERENCE_TTS_VOICE ?? '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',

  /** Set TURN_DETECTOR=off to skip the end-of-turn model and rely on VAD-only endpointing. */
  useTurnDetector: (process.env.TURN_DETECTOR ?? 'on').toLowerCase() !== 'off',
  /** Fallback only: the API normally supplies this per interview. */
  defaultMaxMinutes: num('INTERVIEW_MAX_MINUTES', 25),
};
