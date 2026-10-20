import { inference } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import * as openai from '@livekit/agents-plugin-openai';
import { cfg } from './env.js';
import type { UserModels, UserStageModel } from './types.js';

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

export function buildLlm(user?: UserStageModel) {
  const provider = user?.provider ?? cfg.llmProvider;
  const apiKey = user?.apiKey;
  switch (provider) {
    case 'inference':
      return new inference.LLM({ model: cfg.inferenceLlmModel as inference.LLMModels });
    case 'groq':
      return openai.LLM.withGroq({
        apiKey: apiKey ?? requireKey('GROQ_API_KEY', cfg.groqApiKey),
        model: user?.model ?? cfg.groqLlmModel,
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
