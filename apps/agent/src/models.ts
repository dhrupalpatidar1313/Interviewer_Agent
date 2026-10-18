import { inference } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import { cfg } from './env.js';

/**
 * Builds the STT -> LLM -> TTS pipeline.
 *  - "plugins":   your own OpenAI / Deepgram keys. Works with any LiveKit server (local or cloud).
 *  - "inference": LiveKit Inference gateway. No provider keys, but requires LiveKit Cloud.
 */
export function buildModels() {
  if (cfg.modelProvider === 'inference') {
    return {
      stt: new inference.STT({ model: cfg.inferenceSttModel as inference.STTModels, language: 'en' }),
      llm: new inference.LLM({ model: cfg.inferenceLlmModel as inference.LLMModels }),
      tts: new inference.TTS({
        model: cfg.inferenceTtsModel as inference.TTSModels,
        voice: cfg.inferenceTtsVoice,
      }),
    };
  }

  return {
    stt: cfg.deepgramKey
      ? new deepgram.STT({ model: 'nova-3', language: 'en' })
      : new openai.STT({ model: 'gpt-4o-transcribe', language: 'en' }),
    llm: new openai.LLM({ model: cfg.openaiLlmModel }),
    tts: new openai.TTS({ model: cfg.openaiTtsModel, voice: cfg.openaiTtsVoice as openai.TTSVoices }),
  };
}
