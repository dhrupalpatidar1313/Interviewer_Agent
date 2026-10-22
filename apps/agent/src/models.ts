import { inference, llm } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import * as openai from '@livekit/agents-plugin-openai';
import { cfg } from './env.js';
import type { UserModels, UserStageModel } from './types.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Enough for a spoken reply, a tool call, or the closing summary, and well inside small free-tier output limits. */
const MAX_OUTPUT_TOKENS = 700;

function requireKey(name: string, value: string): string {
  if (!value) throw new Error(`${name} is required for the provider you selected`);
  return value;
}

// ---- speech to text -------------------------------------------------------------------------------------------------

/** `user` is the candidate's own choice (their key, their model); without it the platform's settings apply. */
function buildStt(user?: UserStageModel) {
  const provider = user?.provider ?? cfg.sttProvider;
  const apiKey = user?.apiKey;
  switch (provider) {
    case 'inference':
      return new inference.STT({ model: cfg.inferenceSttModel as inference.STTModels, language: 'en' });
    case 'deepgram':
      return new deepgram.STT({ model: (user?.model ?? 'nova-3') as deepgram.STTModels, language: 'en', ...(apiKey ? { apiKey } : {}) });
    case 'groq':
      return openai.STT.withGroq({
        apiKey: apiKey ?? requireKey('GROQ_API_KEY', cfg.groqApiKey),
        model: user?.model ?? cfg.groqSttModel,
        language: 'en',
      });
    case 'google':
      return new google.beta.GeminiSTT({
        model: user?.model ?? cfg.geminiSttModel,
        language: 'en-US',
        apiKey: apiKey ?? requireKey('GOOGLE_API_KEY', cfg.googleApiKey),
      });
    case 'openai':
      return new openai.STT({ model: user?.model ?? 'gpt-4o-transcribe', language: 'en', ...(apiKey ? { apiKey } : {}) });
    default:
      throw new Error(`Unsupported speech-to-text provider: ${provider}`);
  }
}

// ---- the interviewer's language model -------------------------------------------------------------------------------

function buildSingleLlm(provider: string, user?: UserStageModel) {
  const apiKey = user?.apiKey;
  switch (provider) {
    case 'inference':
      return new inference.LLM({ model: cfg.inferenceLlmModel as inference.LLMModels });
    case 'groq':
      // Built directly rather than with withGroq() so the output cap can be set. Without one Groq assumes up to 2048
      // output tokens per request, which its free tier (about 1000 output tokens a minute for some models) rejects
      // outright with "429 Request too large", even though the interviewer's replies are only a few sentences.
      return new openai.LLM({
        model: user?.model ?? cfg.groqLlmModel,
        baseURL: GROQ_BASE_URL,
        apiKey: apiKey ?? requireKey('GROQ_API_KEY', cfg.groqApiKey),
        maxCompletionTokens: MAX_OUTPUT_TOKENS,
      });
    case 'openrouter':
      // OpenRouter speaks the OpenAI API and routes to hundreds of models.
      return new openai.LLM({
        model: user?.model ?? cfg.openrouterLlmModel,
        baseURL: OPENROUTER_BASE_URL,
        apiKey: apiKey ?? requireKey('OPENROUTER_API_KEY', cfg.openrouterApiKey),
        maxCompletionTokens: MAX_OUTPUT_TOKENS,
      });
    case 'google':
      return new google.LLM({
        model: user?.model ?? cfg.geminiLlmModel,
        apiKey: apiKey ?? requireKey('GOOGLE_API_KEY', cfg.googleApiKey),
      });
    case 'openai':
      return new openai.LLM({ model: user?.model ?? cfg.openaiLlmModel, ...(apiKey ? { apiKey } : {}) });
    default:
      throw new Error(`Unsupported language-model provider: ${provider}`);
  }
}

/**
 * The platform's model (the free demo) can have a backup: if the first provider fails, for example with a rate limit,
 * the same request goes to the second, so a provider hiccup does not leave the interviewer silent. A candidate's own
 * model is used as chosen, with no substitution, because it runs on their key and their terms.
 */
export function buildLlm(user?: UserStageModel) {
  const primary = buildSingleLlm(user?.provider ?? cfg.llmProvider, user);
  if (user || cfg.llmFallbackProvider === 'none') return primary;
  const backup = buildSingleLlm(cfg.llmFallbackProvider);
  return new llm.FallbackAdapter({ llms: [primary, backup], attemptTimeout: 8, maxRetryPerLLM: 0 });
}

// ---- the interviewer's voice ----------------------------------------------------------------------------------------

function buildTts(user?: UserStageModel) {
  const provider = user?.provider ?? cfg.ttsProvider;
  const apiKey = user?.apiKey;
  switch (provider) {
    case 'inference':
      return new inference.TTS({ model: cfg.inferenceTtsModel as inference.TTSModels, voice: cfg.inferenceTtsVoice });
    case 'google':
      return new google.beta.TTS({
        model: user?.model ?? cfg.geminiTtsModel,
        voiceName: user?.voice ?? cfg.geminiTtsVoice,
        apiKey: apiKey ?? requireKey('GOOGLE_API_KEY', cfg.googleApiKey),
      });
    case 'elevenlabs':
      return new elevenlabs.TTS({
        apiKey: requireKey('an ElevenLabs key', apiKey ?? ''),
        model: user?.model,
        ...(user?.voice ? { voiceId: user.voice } : {}),
      });
    case 'cartesia':
      return new cartesia.TTS({
        apiKey: requireKey('a Cartesia key', apiKey ?? ''),
        ...(user?.model ? { model: user.model } : {}),
        ...(user?.voice ? { voice: user.voice } : {}),
      });
    case 'openai':
      return new openai.TTS({
        model: user?.model ?? cfg.openaiTtsModel,
        voice: (user?.voice ?? cfg.openaiTtsVoice) as openai.TTSVoices,
        ...(apiKey ? { apiKey } : {}),
      });
    default:
      throw new Error(`Unsupported voice provider: ${provider}`);
  }
}

/**
 * Builds the STT -> LLM -> TTS pipeline for one interview.
 *  - `models` given (a candidate-keyed interview): each stage uses that candidate's provider, model and key.
 *  - `models` null (the free demo): the platform's own models, chosen by STT_PROVIDER / LLM_PROVIDER / TTS_PROVIDER.
 *    "inference" is the LiveKit Inference gateway (LIVEKIT_INFERENCE_API_KEY / _SECRET), "google" is Gemini
 *    (GOOGLE_API_KEY), and so on; unset, they follow MODEL_PROVIDER.
 */
export function buildModels(models: UserModels | null) {
  return { stt: buildStt(models?.stt), llm: buildLlm(models?.llm), tts: buildTts(models?.tts) };
}
