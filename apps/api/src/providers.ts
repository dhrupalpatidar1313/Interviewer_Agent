/**
 * The providers a candidate can bring their own key for. This is the single source of truth: which stages each can
 * serve, where to get a key, sensible defaults, and how to check a pasted key. Only these fixed hosts are ever
 * contacted, never an address a user supplies.
 */
export type Stage = 'stt' | 'llm' | 'tts';
export const STAGES: readonly Stage[] = ['stt', 'llm', 'tts'];

export type ProviderId = 'openai' | 'google' | 'groq' | 'deepgram' | 'elevenlabs' | 'cartesia';

export interface StageDefaults {
  model: string;
  /** TTS only: a voice name or id. */
  voice?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  stages: readonly Stage[];
  /** Where the person creates the key. */
  keyUrl: string;
  keyNote?: string;
  defaults: Partial<Record<Stage, StageDefaults>>;
  /** Voices to offer as a dropdown; providers keyed by voice id take free text instead. */
  voices?: readonly string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    stages: ['stt', 'llm', 'tts'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyNote: 'Paid. Usage is billed to your OpenAI account.',
    defaults: {
      stt: { model: 'gpt-4o-transcribe' },
      llm: { model: 'gpt-4.1-mini' },
      tts: { model: 'gpt-4o-mini-tts', voice: 'alloy' },
    },
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    stages: ['stt', 'llm', 'tts'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyNote: 'Has a free tier with low limits. Google may use free-tier prompts to improve its products.',
    defaults: {
      stt: { model: 'gemini-3.5-transcribe-live' },
      llm: { model: 'gemini-3.5-flash' },
      tts: { model: 'gemini-3.8-flash-tts', voice: 'Kore' },
    },
    voices: ['Kore', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Zephyr', 'Sulafat', 'Achird'],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    stages: ['stt', 'llm'],
    keyUrl: 'https://console.groq.com/keys',
    keyNote: 'Has a free tier. Speech to text and the language model only; pair it with a voice provider.',
    defaults: {
      stt: { model: 'whisper-large-v3-turbo' },
      llm: { model: 'openai/gpt-oss-120b' },
    },
  },
  deepgram: {
    id: 'deepgram',
    label: 'Deepgram',
    stages: ['stt'],
    keyUrl: 'https://console.deepgram.com/',
    keyNote: 'Speech to text only. New accounts get free credit.',
    defaults: { stt: { model: 'nova-3' } },
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    stages: ['tts'],
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    keyNote: 'Voice only. The key needs permission to generate speech.',
    defaults: { tts: { model: 'eleven_turbo_v2_5', voice: 'bIHbv24MWmeRgasZH58o' } },
  },
  cartesia: {
    id: 'cartesia',
    label: 'Cartesia',
    stages: ['tts'],
    keyUrl: 'https://play.cartesia.ai/keys',
    keyNote: 'Voice only.',
    defaults: { tts: { model: 'sonic-3', voice: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc' } },
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.hasOwn(PROVIDERS, value);
}

export function providerSupports(provider: ProviderId, stage: Stage): boolean {
  return PROVIDERS[provider].stages.includes(stage);
}

export interface ModelLists {
  stt: string[];
  llm: string[];
  tts: string[];
}

export type ValidationResult =
  | { ok: true; models: ModelLists }
  | { ok: false; reason: 'invalid' | 'unreachable'; message: string };

const EMPTY: ModelLists = { stt: [], llm: [], tts: [] };

/** Static fallbacks, used when a provider's own list is unavailable or has nothing for a stage. */
const FALLBACK_MODELS: Record<ProviderId, ModelLists> = {
  openai: { stt: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe'], llm: ['gpt-4.1-mini', 'gpt-4.1'], tts: ['gpt-4o-mini-tts'] },
  google: { stt: ['gemini-3.5-transcribe-live'], llm: ['gemini-3.5-flash'], tts: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] },
  groq: { stt: ['whisper-large-v3-turbo', 'whisper-large-v3'], llm: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'], tts: [] },
  deepgram: { stt: ['nova-3', 'nova-2'], llm: [], tts: [] },
  elevenlabs: { stt: [], llm: [], tts: ['eleven_turbo_v2_5', 'eleven_flash_v2_5', 'eleven_multilingual_v2'] },
  cartesia: { stt: [], llm: [], tts: ['sonic-3', 'sonic-2', 'sonic-turbo'] },
};

// --- turning each provider's model list into per-stage lists -------------------------------------------------------

export function classifyOpenAI(ids: string[]): ModelLists {
  const llm = ids.filter(
    (id) =>
      /^(gpt-|o\d|chatgpt-)/.test(id) &&
      !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|whisper|instruct|codex|diarize)/.test(id),
  );
  return {
    stt: ids.filter((id) => /(transcribe|whisper)/.test(id)),
    llm,
    tts: ids.filter((id) => /tts/.test(id)),
  };
}

export function classifyGoogle(models: { name?: string; supportedGenerationMethods?: string[] }[]): ModelLists {
  const ids = models
    .filter((m) => m.name && (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''));
  return {
    stt: ids.filter((id) => /transcribe/.test(id)),
    llm: ids.filter((id) => /^gemini-/.test(id) && !/(tts|image|live|embedding|transcribe|robotics|computer-use|audio)/.test(id)),
    tts: ids.filter((id) => /tts/.test(id)),
  };
}

export function classifyGroq(ids: string[]): ModelLists {
  return {
    stt: ids.filter((id) => /whisper/.test(id)),
    llm: ids.filter((id) => !/(whisper|orpheus|guard|safeguard|tts|allam)/.test(id)),
    tts: [],
  };
}

/** Keeps the provider's order, puts the stage default first when it is available, and falls back when empty. */
function finalize(provider: ProviderId, live: ModelLists): ModelLists {
  const out: ModelLists = { stt: [], llm: [], tts: [] };
  for (const stage of STAGES) {
    if (!providerSupports(provider, stage)) continue;
    const list = [...new Set(live[stage].length ? live[stage] : FALLBACK_MODELS[provider][stage])].sort();
    const preferred = PROVIDERS[provider].defaults[stage]?.model;
    out[stage] = preferred && list.includes(preferred) ? [preferred, ...list.filter((m) => m !== preferred)] : list;
  }
  return out;
}

// --- checking a pasted key -----------------------------------------------------------------------------------------

type FetchLike = typeof fetch;
const TIMEOUT_MS = 8000;

interface Probe {
  url: string;
  headers: Record<string, string>;
  /** Pulls model lists out of the response body. May return empty lists; the caller falls back to static ones. */
  parse(body: unknown): ModelLists;
  /** Extra check on a 401/403 body: some providers use 401 for "valid key, missing permission". */
  acceptDenied?(body: unknown): boolean;
}

function probeFor(provider: ProviderId, key: string): Probe {
  switch (provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/models',
        headers: { authorization: `Bearer ${key}` },
        parse: (b) => classifyOpenAI(asArray((b as { data?: unknown })?.data).map((m) => String((m as { id?: string }).id ?? ''))),
      };
    case 'google':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
        headers: { 'x-goog-api-key': key },
        parse: (b) => classifyGoogle(asArray((b as { models?: unknown })?.models) as never),
      };
    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/models',
        headers: { authorization: `Bearer ${key}` },
        parse: (b) => classifyGroq(asArray((b as { data?: unknown })?.data).map((m) => String((m as { id?: string }).id ?? ''))),
      };
    case 'deepgram':
      return {
        url: 'https://api.deepgram.com/v1/projects',
        headers: { authorization: `Token ${key}` },
        parse: () => EMPTY,
      };
    case 'elevenlabs':
      return {
        url: 'https://api.elevenlabs.io/v1/models',
        headers: { 'xi-api-key': key },
        parse: (b) => ({
          ...EMPTY,
          tts: asArray(b)
            .filter((m) => (m as { can_do_text_to_speech?: boolean }).can_do_text_to_speech !== false)
            .map((m) => String((m as { model_id?: string }).model_id ?? ''))
            .filter(Boolean),
        }),
        // A restricted key without the models permission is still a real key; speech generation may work.
        acceptDenied: (b) => JSON.stringify(b ?? '').includes('missing_permissions'),
      };
    case 'cartesia':
      return {
        url: 'https://api.cartesia.ai/voices?limit=1',
        headers: { 'x-api-key': key, 'cartesia-version': '2025-04-16' },
        parse: () => EMPTY,
      };
  }
}

/** Cheap sanity check before bothering a provider: keys are one unbroken token of reasonable length. */
export function checkKeyFormat(key: string): ValidationResult | null {
  if (key.length < 8 || key.length > 400 || /\s/.test(key)) {
    return { ok: false, reason: 'invalid', message: 'That does not look like an API key. Copy the whole key with no spaces.' };
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Asks the provider about the key with one cheap, read-only call. Success means the key is real; the response also
 * feeds the model dropdown. Only a clear 401/403 marks a key invalid: a rate limit or an outage must not make a
 * good key look bad.
 */
export async function validateKey(provider: ProviderId, rawKey: string, fetchImpl: FetchLike = fetch): Promise<ValidationResult> {
  const key = rawKey.trim();
  const malformed = checkKeyFormat(key);
  if (malformed) return malformed;
  const probe = probeFor(provider, key);
  try {
    const res = await fetchImpl(probe.url, { headers: probe.headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, models: finalize(provider, probe.parse(body)) };
    if ((res.status === 401 || res.status === 403) && probe.acceptDenied?.(body)) {
      return { ok: true, models: finalize(provider, EMPTY) };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'invalid', message: `${PROVIDERS[provider].label} did not accept that key. Check that you copied it correctly and that it is active.` };
    }
    if (res.status === 429) return { ok: true, models: finalize(provider, EMPTY) };
    return { ok: false, reason: 'unreachable', message: `${PROVIDERS[provider].label} could not be reached right now (${res.status}). Try again in a minute.` };
  } catch {
    return { ok: false, reason: 'unreachable', message: `We could not reach ${PROVIDERS[provider].label}. Check your connection and try again.` };
  }
}

/**
 * Network-free stand-in for validateKey, used only by the in-memory test backend so tests never call real providers:
 * a key starting "invalid" is rejected, "unreachable" simulates an outage, anything else is accepted.
 */
export async function validateKeyForTests(provider: ProviderId, rawKey: string): Promise<ValidationResult> {
  const key = rawKey.trim();
  const malformed = checkKeyFormat(key);
  if (malformed) return malformed;
  if (key.startsWith('invalid')) return { ok: false, reason: 'invalid', message: 'did not accept that key' };
  if (key.startsWith('unreachable')) return { ok: false, reason: 'unreachable', message: 'could not be reached' };
  return { ok: true, models: finalize(provider, EMPTY) };
}
