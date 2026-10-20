// Checks a Gemini API key before you make Gemini the platform's demo provider (STT/LLM/TTS_PROVIDER=google):
// are the configured model ids real for this key, and how fast are one language-model call and one voice call?
//
//   npm run probe:gemini        (reads GOOGLE_API_KEY and the GEMINI_* model ids from .env)
//
// It makes three small requests. It does NOT test the live speech-to-text model the agent uses
// (gemini-3.5-transcribe-live runs over a streaming socket); the transcription step below only shows that the key
// can take audio input at all. Run a real spoken interview after switching.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = process.env.GOOGLE_API_KEY;
if (!key) {
  console.error('Set GOOGLE_API_KEY in .env first (https://aistudio.google.com/apikey).');
  process.exit(1);
}
const llmModel = process.env.GEMINI_LLM_MODEL || 'gemini-3.5-flash';
const sttModel = process.env.GEMINI_STT_MODEL || 'gemini-3.5-transcribe-live';
const ttsModel = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const voice = process.env.GEMINI_TTS_VOICE || 'Kore';
const api = 'https://generativelanguage.googleapis.com/v1beta';
const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };

let failures = 0;
const ok = (name, detail = '') => console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`);
const bad = (name, detail) => {
  failures++;
  console.log(`FAIL  ${name}  ${detail}`);
};

async function post(model, body) {
  const t0 = performance.now();
  const res = await fetch(`${api}/models/${model}:generateContent`, { method: 'POST', headers, body: JSON.stringify(body) });
  const ms = Math.round(performance.now() - t0);
  const json = await res.json().catch(() => ({}));
  return { res, json, ms };
}

// 1. Which models does this key see?
const list = await fetch(`${api}/models?pageSize=200`, { headers });
if (!list.ok) {
  const reason = (await list.json().catch(() => ({}))).error?.message ?? '';
  bad('the key is accepted by Google', `HTTP ${list.status} ${reason}`);
  if (list.status === 400 && /API key not valid|API_KEY_INVALID/i.test(reason)) {
    console.log(`      The key in .env is ${key.length} characters and starts "${key.slice(0, 4)}". Gemini keys from AI Studio start "AIza" and are about 39 characters; check for extra text, quotes or a line break pasted with it.`);
  }
  process.exit(1);
}
ok('the key is accepted by Google');
const names = ((await list.json()).models ?? []).map((m) => String(m.name).replace(/^models\//, ''));
for (const [label, id] of [['language model', llmModel], ['text to speech', ttsModel], ['speech to text (live)', sttModel]]) {
  names.includes(id) ? ok(`${label} model exists for this key`, id) : bad(`${label} model exists for this key`, `${id} is not in the list. Gemini models seen: ${names.filter((n) => n.startsWith('gemini')).slice(0, 12).join(', ')}`);
}

// 2. One language-model call.
{
  const { res, json, ms } = await post(llmModel, { contents: [{ parts: [{ text: 'You are a friendly interviewer. Say hello to Jordan in one short sentence.' }] }] });
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  res.ok && text ? ok('language model replies', `${ms} ms: "${text.trim().slice(0, 70)}"`) : bad('language model replies', `HTTP ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 200)}`);
}

// 3. One voice call: how long until we have audio?
let pcm = null;
{
  const { res, json, ms } = await post(ttsModel, {
    contents: [{ parts: [{ text: 'Hi Jordan, welcome to your interview. Let us start with an easy question.' }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (res.ok && data) {
    pcm = Buffer.from(data, 'base64');
    ok('voice model returns audio', `${ms} ms for ${(pcm.length / 48000).toFixed(1)} s of speech (this call is not streamed; the agent's first sentence waits for it)`);
    if (ms > 2500) console.log('WARN  over 2.5 s to the first audio: candidates will notice the pause before each reply. Compare with the current demo pipeline before switching.');
  } else {
    bad('voice model returns audio', `HTTP ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 200)}`);
  }
}

// 4. Can the key take audio in? (Round-trips the speech from step 3 through the language model.)
if (pcm) {
  const wav = Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0]),
    Buffer.from(new Uint32Array([24000]).buffer), Buffer.from(new Uint32Array([48000]).buffer), Buffer.from([2, 0, 16, 0]),
    Buffer.from('data'), Buffer.from(new Uint32Array([pcm.length]).buffer), pcm,
  ]);
  wav.writeUInt32LE(wav.length - 8, 4);
  const { res, json, ms } = await post(llmModel, {
    contents: [{ parts: [{ text: 'Transcribe this audio exactly.' }, { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] }],
  });
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  res.ok && /welcome|interview|Jordan/i.test(text) ? ok('audio in works (language model transcribes the voice output)', `${ms} ms: "${text.trim().slice(0, 70)}"`) : bad('audio in works', `HTTP ${res.status} ${text.slice(0, 120) || JSON.stringify(json.error ?? '').slice(0, 160)}`);
}

console.log('\nFree-tier limits are per project and low; check the live numbers at https://aistudio.google.com/rate-limit');
console.log(failures ? `${failures} check(s) failed. Do not switch the demo to Gemini yet.` : 'Looks good. Set STT_PROVIDER, LLM_PROVIDER and TTS_PROVIDER to google, restart the agent, and run a real spoken interview.');
process.exit(failures ? 1 : 0);
