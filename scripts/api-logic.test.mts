// Checks the pieces of the API that handle candidates' own provider keys, without a server, a database or any
// network: encryption, and provider key validation / model lists against a mocked fetch.
//
//   npm run test:api-units
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createSecretBox, last4, parseSecretKey } from '../apps/api/src/crypto.ts';
import {
  checkKeyFormat,
  classifyGoogle,
  classifyGroq,
  classifyOpenAI,
  PROVIDERS,
  providerSupports,
  validateKey,
  type ProviderId,
} from '../apps/api/src/providers.ts';

// ---- encryption
const key = randomBytes(32);
const box = createSecretBox(key);
const secret = 'sk-test-0123456789abcdef';
const enc = box.encrypt(secret, 'user-1:openai');
assert.notEqual(enc.ciphertext, Buffer.from(secret).toString('base64'));
assert.ok(!JSON.stringify(enc).includes(secret), 'the key is not stored in the clear');
assert.equal(box.decrypt(enc, 'user-1:openai'), secret);
assert.notEqual(box.encrypt(secret, 'user-1:openai').iv, enc.iv, 'a fresh IV every time');
console.log('PASS  secrets round-trip and are not stored in the clear');

assert.throws(() => box.decrypt(enc, 'user-2:openai'), 'another user cannot use this ciphertext');
assert.throws(() => box.decrypt(enc, 'user-1:groq'), 'another provider row cannot use this ciphertext');
const flipped = Buffer.from(enc.ciphertext, 'base64');
flipped[0] ^= 1;
assert.throws(() => box.decrypt({ ...enc, ciphertext: flipped.toString('base64') }, 'user-1:openai'), 'tampering is detected');
assert.throws(() => createSecretBox(randomBytes(32)).decrypt(enc, 'user-1:openai'), 'a different master key cannot read it');
console.log('PASS  ciphertext is bound to its owner and provider, and tampering is detected');

assert.throws(() => parseSecretKey('too-short'));
assert.throws(() => parseSecretKey(randomBytes(16).toString('base64')));
assert.equal(parseSecretKey(key.toString('base64')).length, 32);
assert.equal(last4('sk-abcdef1234'), '1234');
assert.equal(last4('  sk-abcdef1234 \n'), '1234');
console.log('PASS  secret key parsing and last-4 display');

// ---- catalog
assert.ok(providerSupports('groq', 'llm') && !providerSupports('groq', 'tts'));
assert.ok(providerSupports('elevenlabs', 'tts') && !providerSupports('elevenlabs', 'llm'));
assert.ok(providerSupports('deepgram', 'stt') && !providerSupports('deepgram', 'tts'));
assert.ok(providerSupports('openrouter', 'llm') && !providerSupports('openrouter', 'stt') && !providerSupports('openrouter', 'tts'));
for (const p of Object.values(PROVIDERS)) {
  for (const stage of p.stages) assert.ok(p.defaults[stage]?.model, `${p.id} has a default ${stage} model`);
  assert.ok(p.keyUrl.startsWith('https://'));
}
console.log('PASS  every provider has defaults for the stages it serves');

// ---- turning provider model lists into per-stage lists
const openai = classifyOpenAI([
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-transcribe', 'gpt-4o-mini-tts', 'whisper-1', 'text-embedding-3-small',
  'gpt-4o-realtime-preview', 'gpt-image-1', 'o3-mini', 'dall-e-3', 'gpt-4o-audio-preview',
]);
assert.deepEqual(openai.llm.sort(), ['gpt-4.1', 'gpt-4.1-mini', 'o3-mini']);
assert.deepEqual(openai.stt.sort(), ['gpt-4o-transcribe', 'whisper-1']);
assert.deepEqual(openai.tts, ['gpt-4o-mini-tts']);
const groq = classifyGroq(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'whisper-large-v3', 'canopylabs/orpheus-v1-english', 'meta-llama/llama-prompt-guard-2-22m']);
assert.deepEqual(groq.llm, ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']);
assert.deepEqual(groq.stt, ['whisper-large-v3']);
const google = classifyGoogle([
  { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-3.5-transcribe-live', supportedGenerationMethods: ['generateContent'] },
]);
assert.deepEqual(google.llm, ['gemini-3.5-flash']);
assert.deepEqual(google.tts, ['gemini-3.8-flash-tts']);
assert.deepEqual(google.stt, ['gemini-3.5-transcribe-live']);
console.log('PASS  provider model lists are sorted into speech-to-text, language and voice models');

// ---- validating a pasted key, against a mocked provider
const calls: { url: string; headers: Record<string, string> }[] = [];
function mockFetch(status: number, body: unknown): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const good = await validateKey('groq', 'gsk_abcdefghijkl', mockFetch(200, { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }] }));
assert.ok(good.ok && good.models.llm.includes('openai/gpt-oss-120b') && good.models.stt.includes('whisper-large-v3'));
assert.equal(calls.at(-1)!.url, 'https://api.groq.com/openai/v1/models');
assert.equal(calls.at(-1)!.headers.authorization, 'Bearer gsk_abcdefghijkl');
console.log('PASS  a good key is confirmed and the provider\'s models come back');

const orOk = await validateKey('openrouter', 'sk-or-v1-abcdefghijkl', mockFetch(200, { data: { label: 'k' } }));
assert.ok(orOk.ok && orOk.models.llm[0] === 'openai/gpt-4o-mini', 'OpenRouter: a valid key, default model first');
assert.equal(calls.at(-1)!.url, 'https://openrouter.ai/api/v1/auth/key');
const orBad = await validateKey('openrouter', 'sk-or-v1-wrongwrongwrong', mockFetch(401, { error: { message: 'No auth credentials found' } }));
assert.ok(!orBad.ok && orBad.reason === 'invalid', 'OpenRouter: a bad key is rejected');

const rejected = await validateKey('openai', 'sk-wrong-key-12345', mockFetch(401, { error: 'bad key' }));
assert.ok(!rejected.ok && rejected.reason === 'invalid');
const forbidden = await validateKey('google', 'AIza-wrong-key-12345', mockFetch(403, {}));
assert.ok(!forbidden.ok && forbidden.reason === 'invalid');
const limited = await validateKey('openai', 'sk-real-but-busy-1234', mockFetch(429, {}));
assert.ok(limited.ok, 'a rate limit does not make a real key look wrong');
assert.ok(limited.ok && limited.models.llm.length > 0, 'falls back to the default models');
const outage = await validateKey('deepgram', 'dg-key-1234567890', mockFetch(503, {}));
assert.ok(!outage.ok && outage.reason === 'unreachable');
const offline = await validateKey('cartesia', 'cart-key-1234567890', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
assert.ok(!offline.ok && offline.reason === 'unreachable');
const restricted = await validateKey('elevenlabs', 'xi-restricted-key-1', mockFetch(401, { detail: { status: 'missing_permissions' } }));
assert.ok(restricted.ok, 'a restricted ElevenLabs key without the models permission is still a real key');
console.log('PASS  only a clear 401/403 marks a key invalid; outages and rate limits do not');

for (const bad of ['', 'short', 'has a space inside it', 'x'.repeat(401)]) {
  const res = await validateKey('openai', bad, mockFetch(200, { data: [] }));
  assert.ok(!res.ok && res.reason === 'invalid', `rejects ${JSON.stringify(bad.slice(0, 12))}`);
  assert.notEqual(checkKeyFormat(bad.trim()), null);
}
console.log('PASS  malformed keys are refused before any provider is called');

// Only fixed provider hosts are ever contacted.
const allowed = new Set(['api.openai.com', 'generativelanguage.googleapis.com', 'api.groq.com', 'openrouter.ai', 'api.deepgram.com', 'api.elevenlabs.io', 'api.cartesia.ai']);
for (const id of Object.keys(PROVIDERS) as ProviderId[]) await validateKey(id, 'a-key-for-host-check-1', mockFetch(200, {}));
for (const c of calls) assert.ok(allowed.has(new URL(c.url).host), `unexpected host ${c.url}`);
assert.equal(new Set(calls.map((c) => new URL(c.url).host)).size >= 7, true);
console.log('PASS  only the seven fixed provider hosts are contacted');
