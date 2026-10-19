import { inference } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import { cfg } from './env.js';

function requireGroqKey(): string {
  if (!cfg.groqApiKey) throw new Error('GROQ_API_KEY is required when STT_PROVIDER or LLM_PROVIDER is "groq"');
  return cfg.groqApiKey;
}

function buildStt() {
  switch (cfg.sttProvider) {
    case 'inference':
      return new inference.STT({ model: cfg.inferenceSttModel as inference.STTModels, language: 'en' });
    case 'deepgram':
      return new deepgram.STT({ model: 'nova-3', language: 'en' });
    case 'groq':
      return openai.STT.withGroq({ apiKey: requireGroqKey(), model: cfg.groqSttModel, language: 'en' });
    default:
      return new openai.STT({ model: 'gpt-4o-transcribe', language: 'en' });
  }
}

function buildLlm() {
  switch (cfg.llmProvider) {
    case 'inference':
      return new inference.LLM({ model: cfg.inferenceLlmModel as inference.LLMModels });
    case 'groq':
      return openai.LLM.withGroq({ apiKey: requireGroqKey(), model: cfg.groqLlmModel });
    default:
      return new openai.LLM({ model: cfg.openaiLlmModel });
  }
}

function buildTts() {
  if (cfg.ttsProvider === 'inference') {
    return new inference.TTS({ model: cfg.inferenceTtsModel as inference.TTSModels, voice: cfg.inferenceTtsVoice });
  }
  return new openai.TTS({ model: cfg.openaiTtsModel, voice: cfg.openaiTtsVoice as openai.TTSVoices });
}

/**
 * Builds the STT -> LLM -> TTS pipeline. Each stage has its own provider (STT_PROVIDER, LLM_PROVIDER, TTS_PROVIDER):
 *  - "inference": LiveKit Inference gateway (LiveKit Cloud). It authenticates with LIVEKIT_INFERENCE_API_KEY /
 *                 LIVEKIT_INFERENCE_API_SECRET (falling back to LIVEKIT_API_KEY / SECRET), so the room server can be a
 *                 local one while the models come from a Cloud project.
 *  - "groq":      Groq's OpenAI-compatible API (GROQ_API_KEY). STT and LLM only.
 *  - "deepgram" / "openai": your own provider keys. Work with any LiveKit server.
 * Unset, the providers follow MODEL_PROVIDER ("plugins" or "inference").
 */
export function buildModels() {
  return { stt: buildStt(), llm: buildLlm(), tts: buildTts() };
}
