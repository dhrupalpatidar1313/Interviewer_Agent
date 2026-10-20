import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Must be imported before anything from @livekit/agents so LIVEKIT_URL / keys are in process.env.
// Repo root is three levels up from apps/agent/src (and from apps/agent/dist).
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

type SttProvider = 'inference' | 'deepgram' | 'openai' | 'groq' | 'google';
type LlmProvider = 'inference' | 'openai' | 'groq' | 'google';
type TtsProvider = 'inference' | 'openai' | 'google';

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = (process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name}=${value} is not valid; use one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

const modelProvider = (process.env.MODEL_PROVIDER ?? 'plugins') as 'plugins' | 'inference';
const deepgramKey = process.env.DEEPGRAM_API_KEY ?? '';

export const cfg = {
  apiUrl: (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  internalKey: process.env.INTERNAL_API_KEY ?? '',
  agentName: process.env.AGENT_NAME ?? 'ai-interviewer',
  interviewerName: process.env.INTERVIEWER_NAME ?? 'Alex',

  modelProvider,
  /** Each stage can be picked on its own; unset, it follows MODEL_PROVIDER (the original all-or-nothing switch). */
  sttProvider: pick<SttProvider>(
    'STT_PROVIDER',
    ['inference', 'deepgram', 'openai', 'groq', 'google'],
    modelProvider === 'inference' ? 'inference' : deepgramKey ? 'deepgram' : 'openai',
  ),
  llmProvider: pick<LlmProvider>(
    'LLM_PROVIDER',
    ['inference', 'openai', 'groq', 'google'],
    modelProvider === 'inference' ? 'inference' : 'openai',
  ),
  ttsProvider: pick<TtsProvider>('TTS_PROVIDER', ['inference', 'openai', 'google'], modelProvider === 'inference' ? 'inference' : 'openai'),

  openaiLlmModel: process.env.OPENAI_LLM_MODEL ?? 'gpt-4.1-mini',
  openaiTtsModel: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
  deepgramKey,
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqLlmModel: process.env.GROQ_LLM_MODEL ?? 'qwen/qwen3.8-27b',
  groqSttModel: process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo',
  googleApiKey: process.env.GOOGLE_API_KEY ?? '',
  geminiLlmModel: process.env.GEMINI_LLM_MODEL ?? 'gemini-3.5-flash',
  geminiSttModel: process.env.GEMINI_STT_MODEL ?? 'gemini-3.5-transcribe-live',
  geminiTtsModel: process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-tts',
  geminiTtsVoice: process.env.GEMINI_TTS_VOICE ?? 'Kore',
  inferenceSttModel: process.env.INFERENCE_STT_MODEL ?? 'deepgram/nova-3',
  inferenceLlmModel: process.env.INFERENCE_LLM_MODEL ?? 'openai/gpt-4.1-mini',
  inferenceTtsModel: process.env.INFERENCE_TTS_MODEL ?? 'cartesia/sonic-3',
  inferenceTtsVoice: process.env.INFERENCE_TTS_VOICE ?? '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',

  /** Set TURN_DETECTOR=off to skip the end-of-turn model and rely on VAD-only endpointing. */
  useTurnDetector: (process.env.TURN_DETECTOR ?? 'on').toLowerCase() !== 'off',
  /** How long the interviewer holds a disconnected candidate's place before ending and saving. */
  rejoinGraceSeconds: num('REJOIN_GRACE_SECONDS', 120),
  /** End the interview as "no response" when the candidate has said nothing at all for this long. */
  noResponseSeconds: num('NO_RESPONSE_SECONDS', 180),
  /** Fallback only: the API normally supplies this per interview. */
  defaultMaxMinutes: num('INTERVIEW_MAX_MINUTES', 25),
};
