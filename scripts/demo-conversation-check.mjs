// A real spoken free-demo interview, end to end, with a scripted candidate:
//
//   npm run test:demo               starts its own API and agent worker locally
//   npm run test:demo -- --deployed uses the API already running on :4000 and the agent deployed to LiveKit Cloud
//                                   (so it tests exactly what a candidate in the browser would get)
//
// It starts the real API (real Supabase) and the real agent worker on this machine, against the LiveKit project in
// .env, creates a throwaway user, and joins the room as that user. The candidate "speaks" synthesized audio, so this
// exercises the whole path: speech to text, the language model, text to speech, turn detection, the stage tools, the
// saved transcript and report, and the one-demo rule. It spends a little LiveKit Inference and Groq quota.
//
// Needs: the Supabase migration applied, LIVEKIT_* pointing at a Cloud project (or a running local server), and the
// demo models configured (STT_PROVIDER / LLM_PROVIDER / TTS_PROVIDER). Cleans up after itself.
import { initializeLogger, inference } from '@livekit/agents';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
initializeLogger({ pretty: false, level: 'error' });
// The LiveKit client logs every ignored data stream at debug level; hide those JSON lines so the PASS/FAIL list reads.
const writeOut = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => (/^\{"level":/.test(String(chunk)) ? true : writeOut(chunk, ...rest));

const E = process.env;
for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'INTERNAL_API_KEY']) {
  if (!E[name]) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
}

const DEPLOYED = process.argv.includes('--deployed');
// Locally the agent gets a distinct name, so this can never take a real interview's job.
const AGENT_NAME = DEPLOYED ? E.AGENT_NAME || 'ai-interviewer' : 'ai-interviewer-localtest';
const PORT = DEPLOYED ? Number(E.API_PORT || 4000) : 4740;
const API = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const email = `demo-check+${stamp}@example.com`;
const password = `Check-${randomBytes(9).toString('base64url')}`;
const admin = createClient(E.SUPABASE_URL, E.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const children = [];
let userId = null;
let room = null;
const logs = { api: '', agent: '' };

function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(extra)}`);
  if (!ok) failures++;
}

function start(label, cwd, args, env) {
  const child = spawn('npx', args, { cwd: path.join(root, cwd), env: { ...E, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const strip = (d) => String(d).replace(/\x1b\[[0-9;]*m/g, '');
  child.stdout.on('data', (d) => (logs[label] += strip(d)));
  child.stderr.on('data', (d) => (logs[label] += strip(d)));
  children.push(child);
  return child;
}

async function until(label, fn, ms, every = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  console.log(`      (timed out waiting for: ${label})`);
  return null;
}

async function call(token, method, route, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + route, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const agentState = () => {
  const agent = room && [...room.remoteParticipants.values()][0];
  return agent?.attributes?.['lk.agent.state'] ?? null;
};

try {
  // 1. The real API and the real agent: started here on spare names/ports, or (--deployed) already running.
  if (!DEPLOYED) {
    start('api', 'apps/api', ['tsx', 'src/server.ts'], { API_PORT: String(PORT), AGENT_NAME, TOKEN_REISSUE_SECONDS: '1' });
    start('agent', 'apps/agent', ['tsx', 'src/main.ts', 'start'], { AGENT_NAME, API_URL: API, NO_RESPONSE_SECONDS: '150' });
  }
  const apiUp = await until('API', async () => (await fetch(API + '/api/health').then((r) => r.ok).catch(() => false)), 40_000);
  check(DEPLOYED ? `the API is running on ${API}` : 'API is up against the real Supabase project', !!apiUp);
  if (!apiUp) throw new Error('the API is not reachable');
  if (!DEPLOYED) {
    const agentUp = await until('agent worker to register', async () => /registered worker/.test(logs.agent), 60_000);
    check('agent worker registered with LiveKit', !!agentUp, logs.agent.slice(-400));
    if (!agentUp) throw new Error('the agent did not start');
  }

  // 2. A throwaway, already-confirmed user who signs in like the browser does.
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: 'Demo Check' } });
  if (createError) throw new Error(`could not create the test user: ${createError.message}`);
  userId = created.user.id;
  const browser = createClient(E.SUPABASE_URL, E.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInError } = await browser.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);
  const token = session.session.access_token;

  await call(token, 'PUT', '/api/profile', {
    fullName: 'Demo Check',
    targetRole: 'Backend Engineer',
    experienceLevel: 'mid',
    yearsExperience: 4,
    skills: ['TypeScript', 'PostgreSQL', 'Node.js'],
    focusAreas: ['System design'],
  });
  const form = new FormData();
  form.append(
    'resume',
    new Blob(
      [
        'Demo Check, backend engineer.\nAcme Payments 2021-2025: built REST and gRPC APIs in Node.js and PostgreSQL, owned the payments service and cut p99 latency by 40 percent.\nGlobex 2019-2021: backend engineer on an event-driven platform using Kafka; mentored two junior engineers.',
      ],
      { type: 'text/plain' },
    ),
    'resume.txt',
  );
  await call(token, 'POST', '/api/profile/resume', form);

  // 3. Start the free demo.
  let r = await call(token, 'POST', '/api/interviews');
  const interview = r.json.interview;
  check('the first interview is the free demo (8 minutes)', r.status === 201 && interview?.mode === 'demo' && interview.maxMinutes === 8, r);
  r = await call(token, 'POST', `/api/interviews/${interview.id}/token`);
  check('join token issued', r.status === 200, r);

  // 4. Join the room and wait for the interviewer to greet.
  room = new Room();
  await room.connect(r.json.serverUrl, r.json.token, { autoSubscribe: true, dynacast: false });

  const source = new AudioSource(24000, 1);
  const mic = LocalAudioTrack.createAudioTrack('mic', source);
  await room.localParticipant.publishTrack(mic, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));

  const joined = await until('interviewer to join', async () => room.remoteParticipants.size > 0, 45_000);
  check('the interviewer joined the room', !!joined, logs.agent.slice(-600));
  if (!joined) throw new Error('no interviewer');
  const started = await until('interview in progress', async () => (await call(token, 'GET', `/api/interviews/${interview.id}`)).json.interview?.status === 'in_progress', 20_000, 500);
  check('the agent marked the interview started', !!started);

  const spoke = await until('interviewer greeting', async () => ['speaking'].includes(agentState()), 40_000);
  check('the interviewer speaks first (greeting works with the demo LLM and TTS)', !!spoke, logs.agent.slice(-800));
  const listening = await until('interviewer to finish greeting', async () => agentState() === 'listening', 60_000);
  check('the interviewer finishes and listens', !!listening);
  if (!listening) throw new Error('greeting never finished');

  // 5. The candidate answers out loud.
  const answer = 'Hi Alex, nice to meet you. I am doing well, thank you. I have about four years of experience building backend services with TypeScript and PostgreSQL.';
  const tts = new inference.TTS({ model: E.INFERENCE_TTS_MODEL || 'cartesia/sonic-3', voice: E.INFERENCE_TTS_VOICE || '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc' });
  const frames = [];
  const synth = tts.stream();
  synth.pushText(answer);
  synth.flush();
  synth.endInput();
  for await (const item of synth) if (typeof item === 'object' && item?.frame) frames.push(item.frame);
  const rate = frames[0]?.sampleRate ?? 24000;
  const speechSeconds = frames.reduce((n, f) => n + f.samplesPerChannel / f.sampleRate, 0);
  check('synthesized the candidate\'s spoken answer', frames.length > 0, { frames: frames.length });

  const speechSource = rate === 24000 ? source : new AudioSource(rate, 1);
  if (speechSource !== source) {
    await room.localParticipant.unpublishTrack(mic.sid);
    const mic2 = LocalAudioTrack.createAudioTrack('mic', speechSource);
    await room.localParticipant.publishTrack(mic2, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    await sleep(500);
  }
  for (const frame of frames) await speechSource.captureFrame(frame);
  // Two seconds of silence so the turn detector decides the candidate has finished.
  for (let i = 0; i < 200; i++) await speechSource.captureFrame(AudioFrame.create(rate, 1, Math.round(rate / 100)));
  await speechSource.waitForPlayout();
  console.log(`      candidate spoke ${speechSeconds.toFixed(1)}s of audio`);

  // 6. The interviewer should hear it and answer.
  const thinking = await until('interviewer to react', async () => ['thinking', 'speaking'].includes(agentState()), 30_000);
  check('the interviewer heard the candidate and started replying', !!thinking, logs.agent.slice(-800));
  const replied = await until('interviewer to finish replying', async () => agentState() === 'listening', 60_000);
  check('the interviewer finished its reply and is listening again', !!replied);

  // 7. End like the browser's End button does.
  await room.localParticipant.publishData(Buffer.from(JSON.stringify({ type: 'end' })), { reliable: true, topic: 'interview.control' });
  await sleep(300);
  await room.disconnect();
  room = null;
  const done = await until('results saved', async () => ['completed', 'failed'].includes((await call(token, 'GET', `/api/interviews/${interview.id}`)).json.interview?.status), 90_000, 1000);
  check('the interview was saved after the candidate ended it', !!done, logs.agent.slice(-800));

  r = await call(token, 'GET', `/api/interviews/${interview.id}`);
  const saved = r.json.interview;
  const turns = saved.transcript ?? [];
  const mine = turns.filter((t) => t.role === 'user');
  const theirs = turns.filter((t) => t.role === 'assistant');
  console.log('      transcript:');
  for (const t of turns) console.log(`        ${t.role === 'user' ? 'Candidate  ' : 'Interviewer'}: ${t.text.slice(0, 140)}`);
  check('status completed, ended by the candidate', saved.status === 'completed' && saved.endedBy === 'candidate_ended', { status: saved.status, endedBy: saved.endedBy });
  check('the candidate\'s speech was transcribed (speech to text works)', mine.length >= 1 && /typescript|postgres|four years|experience|alex/i.test(mine.map((t) => t.text).join(' ')), mine.map((t) => t.text));
  check('the interviewer said more than the greeting', theirs.length >= 2, theirs.length);
  check('a report was written for the early end', !!saved.report && saved.report.summary.length > 20, saved.report);
  check('the synthetic opening message is not in the transcript', !turns.some((t) => /candidate has just joined/i.test(t.text)), turns.length);

  // 8. The one-demo rule.
  r = await call(token, 'POST', '/api/interviews');
  check('the demo is now used: the next interview asks for the candidate\'s own keys', r.status === 409 && r.json.code === 'PROVIDER_KEYS_REQUIRED', r);

  const leaked = /sb_secret_|gsk_[A-Za-z0-9]{20}/.test(logs.api + logs.agent);
  check('no keys in the API or agent logs', !leaked);
} catch (err) {
  console.error('Demo check crashed:', err);
  failures++;
} finally {
  try {
    await room?.disconnect();
  } catch {}
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`Could not delete the test user ${userId}: ${error.message}`);
  }
  if (failures) {
    console.log('\n--- agent log (tail) ---\n' + logs.agent.split('\n').slice(-40).join('\n'));
    console.log('\n--- API log (tail) ---\n' + logs.api.split('\n').slice(-15).join('\n'));
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nThe free demo works end to end.');
  process.exit(failures ? 1 : 0);
}
