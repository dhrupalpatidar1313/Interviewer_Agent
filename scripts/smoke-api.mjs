// End-to-end smoke test of the HTTP API: auth, profile, resume upload, interviews, LiveKit tokens, and the
// agent-only /internal endpoints. Starts its own API instance with a throwaway database.
//
//   npm run test:api
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'voice-interviewer-smoke-'));
const port = 4710;
const base = `http://localhost:${port}`;
const INTERNAL_KEY = 'internal-key-internal-key-1234';

// Accounts are Supabase Auth users, so the tests sign their own access tokens with a throwaway ES256 key and hand
// the API the matching public key through SUPABASE_JWKS. Data goes to the in-memory store: no network, no project.
const SUPABASE_URL = 'https://smoke-test.supabase.co';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'smoke-key', alg: 'ES256', use: 'sig' };
const other = await generateKeyPair('ES256');

async function tokenFor(userId, { email, name, key = privateKey, issuer = `${SUPABASE_URL}/auth/v1`, expiresIn = '1h' } = {}) {
  return new SignJWT({
    role: 'authenticated',
    email,
    user_metadata: { name },
    app_metadata: {},
    is_anonymous: false,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'smoke-key', typ: 'JWT' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

const JORDAN = randomUUID();
const OTHER = randomUUID();
const UNVERIFIED = randomUUID();
const CAPPED = randomUUID();
const LATE = randomUUID();

const server = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: path.join(root, 'apps/api'),
  env: {
    ...process.env,
    API_PORT: String(port),
    INTERNAL_API_KEY: INTERNAL_KEY,
    STORE_BACKEND: 'memory',
    SUPABASE_URL,
    SUPABASE_JWKS: JSON.stringify({ keys: [jwk] }),
    SUPABASE_JWKS_URL: '',
    MEMORY_UNCONFIRMED_USER_IDS: UNVERIFIED,
    // Two origins, one with a trailing slash and spaces, as it might be typed into a host's settings page.
    WEB_ORIGIN: 'http://localhost:3000 , https://app.example.com/',
    KEY_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
    DEMO_ATTEMPTS_PER_DAY: '3',
    DEMO_DAILY_LIMIT: '4',
    // Padded on purpose: pasted values often carry a trailing space, and the API must trim it.
    LIVEKIT_URL: 'ws://localhost:7880 ',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secretsecretsecretsecretsecret12',
    AGENT_NAME: 'ai-interviewer',
    TOKEN_REISSUE_SECONDS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  // Own process group, so cleanup can stop npx *and* the node server it starts (killing npx alone leaves it running).
  detached: true,
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Holds the current caller's access token; '' calls without credentials (the agent-only /internal routes).
let cookie = '';

async function call(method, route, body, headers = {}) {
  const h = { ...(cookie ? { authorization: `Bearer ${cookie}` } : {}), ...headers };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + route, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

const RESUME_TEXT = [
  'Jordan Rivera, Senior Backend Engineer',
  'Acme Payments 2021-2025: staff engineer. Led the migration of a monolith to event-driven services using Kafka and PostgreSQL.',
  'Reduced p99 latency by 40 percent and mentored five engineers.',
  'Globex 2018-2021: backend engineer building REST and gRPC APIs in Node.js and Go.',
].join('\n');

/** Gives a signed-in user a profile and resume so they can start interviews. */
async function onboard() {
  await call('PUT', '/api/profile', {
    fullName: 'Test Person',
    targetRole: 'Backend Engineer',
    experienceLevel: 'mid',
    yearsExperience: 4,
    skills: ['TypeScript'],
  });
  const form = new FormData();
  form.append('resume', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt');
  await call('POST', '/api/profile/resume', form);
}

try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await sleep(250);
  }

  let r = await call('GET', '/api/auth/me');
  check('me without a token -> 401', r.status === 401, r);

  cookie = 'not.a.jwt';
  r = await call('GET', '/api/auth/me');
  check('garbage token -> 401', r.status === 401, r);

  cookie = await tokenFor(JORDAN, { email: 'jordan@example.com', name: 'Jordan Rivera', key: other.privateKey });
  r = await call('GET', '/api/auth/me');
  check('token signed by a different key -> 401', r.status === 401, r);

  cookie = await tokenFor(JORDAN, { email: 'jordan@example.com', name: 'Jordan Rivera', issuer: 'https://evil.supabase.co/auth/v1' });
  r = await call('GET', '/api/auth/me');
  check('token from another project (wrong issuer) -> 401', r.status === 401, r);

  cookie = await tokenFor(JORDAN, { email: 'jordan@example.com', name: 'Jordan Rivera', expiresIn: '-1m' });
  r = await call('GET', '/api/auth/me');
  check('expired token -> 401', r.status === 401, r);

  cookie = await tokenFor(JORDAN, { email: 'jordan@example.com', name: 'Jordan Rivera' });
  r = await call('GET', '/api/auth/me');
  check(
    'valid token -> user from the token, onboarding not complete',
    r.status === 200 && r.json.user.id === JORDAN && r.json.user.name === 'Jordan Rivera' && r.json.onboarding.complete === false,
    r,
  );

  // ---- CORS: the browser calls the API directly in production
  for (const origin of ['http://localhost:3000', 'https://app.example.com']) {
    const pre = await fetch(base + '/api/auth/me', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    });
    check(
      `CORS preflight from ${origin} is allowed, including the Authorization header`,
      pre.status === 204 && pre.headers.get('access-control-allow-origin') === origin && /authorization/i.test(pre.headers.get('access-control-allow-headers') ?? ''),
      { status: pre.status, allow: pre.headers.get('access-control-allow-origin') },
    );
  }
  const evil = await fetch(base + '/api/auth/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  check('CORS preflight from an unknown origin gets no allow header', !evil.headers.get('access-control-allow-origin'), evil.headers.get('access-control-allow-origin'));

  for (const route of ['/api/auth/signup', '/api/auth/login']) {
    r = await call('POST', route, { email: 'x@example.com', password: 'correct-horse-battery' });
    check(`${route} is gone (Supabase handles it) -> 404`, r.status === 404, r);
  }

  r = await call('POST', '/api/interviews');
  check('interview before onboarding -> 409', r.status === 409 && r.json.code === 'ONBOARDING_INCOMPLETE', r);

  r = await call('PUT', '/api/profile', { fullName: 'Jordan Rivera', targetRole: '', experienceLevel: 'senior', yearsExperience: 8, skills: [] });
  check('invalid profile -> 400', r.status === 400, r);

  r = await call('PUT', '/api/profile', {
    fullName: 'Jordan Rivera',
    targetRole: 'Senior Backend Engineer',
    experienceLevel: 'senior',
    yearsExperience: 8,
    skills: ['TypeScript', 'node.js', 'typescript', 'PostgreSQL'],
    focusAreas: ['System design'],
    githubUrl: 'https://github.com/jrivera',
    about: 'Looking for a staff-level role.',
  });
  check('save profile (skills de-duplicated)', r.status === 200 && r.json.profile.skills.length === 3, r);

  let fd = new FormData();
  fd.append('resume', new Blob([RESUME_TEXT], { type: 'text/plain' }), 'resume.txt');
  r = await call('POST', '/api/profile/resume', fd);
  check('upload text resume -> extracted', r.status === 201 && r.json.resume.preview.includes('Kafka'), r);

  fd = new FormData();
  fd.append('resume', new Blob(['MZ binary'], { type: 'application/octet-stream' }), 'evil.exe');
  r = await call('POST', '/api/profile/resume', fd);
  check('upload .exe rejected -> 415', r.status === 415, r);

  fd = new FormData();
  fd.append('resume', new Blob(['not really a pdf at all'], { type: 'application/pdf' }), 'fake.pdf');
  r = await call('POST', '/api/profile/resume', fd);
  check('fake PDF rejected -> 422', r.status === 422, r);

  r = await call('GET', '/api/auth/me');
  check('onboarding complete', r.json.onboarding?.complete === true, r);

  r = await call('POST', '/api/interviews');
  check(
    'first interview is the free demo (platform keys, short)',
    r.status === 201 && r.json.interview.status === 'created' && r.json.interview.mode === 'demo' && r.json.interview.maxMinutes === 8,
    r,
  );
  const id = r.json.interview.id;

  r = await call('POST', `/api/interviews/${id}/token`);
  check('LiveKit token issued', r.status === 200 && typeof r.json.token === 'string' && r.json.serverUrl === 'ws://localhost:7880', r);
  const payload = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString());
  check('token grants the interview room only', payload.video?.room === `interview-${id}` && payload.video?.roomJoin === true, payload);
  const dispatch = payload.roomConfig?.agents?.[0];
  check('token dispatches the agent with the interview id', dispatch?.agentName === 'ai-interviewer' && JSON.parse(dispatch.metadata).interviewId === id, payload.roomConfig);

  r = await call('GET', `/internal/interviews/${id}/context`);
  check('internal endpoint without key -> 401', r.status === 401, r);

  const ik = { 'x-internal-key': INTERNAL_KEY };
  {
    const saved = cookie;
    cookie = '';
    let who = await call('GET', '/internal/whoami');
    check('/internal/whoami needs the internal key -> 401', who.status === 401, who);
    who = await call('GET', '/internal/whoami', undefined, ik);
    check('whoami with no forwarded header reports the direct (loopback) caller', who.status === 200 && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(who.json.ip) && who.json.trustProxy === 'loopback', who);
    // The test client is loopback, which TRUST_PROXY=loopback trusts, so its forwarded address is honoured. On a host
    // the same request from the internet must NOT be honoured: that is what the hop count in TRUST_PROXY decides.
    who = await call('GET', '/internal/whoami', undefined, { ...ik, 'x-forwarded-for': '203.0.113.9' });
    check('whoami shows the forwarded address a trusted proxy supplied', who.status === 200 && who.json.ip === '203.0.113.9' && who.json.forwardedFor === '203.0.113.9', who);
    cookie = saved;
  }
  const session = cookie;
  cookie = '';
  r = await call('GET', `/internal/interviews/${id}/context`, undefined, ik);
  check(
    'agent context has profile + resume text',
    r.status === 200 &&
      r.json.candidate.profile.targetRole === 'Senior Backend Engineer' &&
      r.json.candidate.resume.text.includes('Kafka') &&
      r.json.participantIdentity.startsWith('user-') &&
      r.json.mode === 'demo' &&
      r.json.models === null,
    r,
  );
  r = await call('POST', `/internal/interviews/${id}/started`, {}, ik);
  check('agent marks interview started', r.status === 200, r);
  cookie = session;

  r = await call('GET', `/api/interviews/${id}`);
  check('status is in_progress', r.json.interview.status === 'in_progress', r);
  r = await call('POST', `/api/interviews/${id}/token`);
  check('second token while in progress -> 409', r.status === 409, r);

  cookie = '';
  r = await call(
    'POST',
    `/internal/interviews/${id}/complete`,
    {
      endedBy: 'agent_completed',
      transcript: [
        { role: 'assistant', text: 'Hi Jordan!', at: Date.now() },
        { role: 'user', text: 'Hello.', at: Date.now() },
      ],
      assessments: [{ stage: 'fundamentals', topic: 'SQL', question: 'What is an index?', rating: 4, notes: 'Solid.' }],
      report: { overallRating: 4, summary: 'Strong.', strengths: ['Depth'], improvements: ['Brevity'] },
    },
    ik,
  );
  check('agent reports completion', r.status === 200, r);
  r = await call('POST', `/internal/interviews/${id}/complete`, { endedBy: 'again' }, ik);
  check('completion is idempotent', r.status === 200 && r.json.alreadyFinalized === true, r);
  cookie = session;

  r = await call('GET', `/api/interviews/${id}`);
  check('detail has transcript and report', r.json.interview.status === 'completed' && r.json.interview.transcript.length === 2 && r.json.interview.report.overallRating === 4, r);
  r = await call('GET', '/api/interviews');
  check('list shows the rating', r.json.interviews.length === 1 && r.json.interviews[0].overallRating === 4, r);

  // ---- the free demo is one-shot; after that, the candidate's own keys
  r = await call('GET', '/api/providers');
  check(
    'providers: all six listed, demo already used, saving keys is available',
    r.status === 200 &&
      r.json.providers.length === 6 &&
      r.json.entitlement.kind === 'blocked' &&
      r.json.entitlement.code === 'PROVIDER_KEYS_REQUIRED' &&
      r.json.canSaveKeys === true,
    r,
  );
  r = await call('POST', '/api/interviews');
  check('second interview without keys -> 409 PROVIDER_KEYS_REQUIRED', r.status === 409 && r.json.code === 'PROVIDER_KEYS_REQUIRED', r);

  r = await call('PUT', '/api/providers/keys/nope', { apiKey: 'good-key-1234567' });
  check('unknown provider -> 404', r.status === 404, r);
  r = await call('PUT', '/api/providers/keys/groq', { apiKey: 'invalid-key-1234' });
  check('provider rejects the key -> 422 KEY_INVALID', r.status === 422 && r.json.code === 'KEY_INVALID', r);
  r = await call('PUT', '/api/providers/keys/groq', { apiKey: 'unreachable-key-1234' });
  check('provider outage -> 502, key not saved', r.status === 502, r);
  r = await call('PUT', '/api/providers/keys/groq', { apiKey: 'has spaces in it' });
  check('key with spaces -> 422', r.status === 422, r);

  const GROQ_KEY = 'good-groq-key-AAAA1111';
  const ELEVEN_KEY = 'good-eleven-key-BBBB2222';
  r = await call('PUT', '/api/providers/keys/groq', { apiKey: GROQ_KEY });
  check('valid Groq key saved: only the last 4 come back', r.status === 200 && r.json.last4 === '1111' && !JSON.stringify(r.json).includes(GROQ_KEY), r);
  r = await call('PUT', '/api/providers/keys/elevenlabs', { apiKey: ELEVEN_KEY });
  check('valid ElevenLabs key saved', r.status === 200 && r.json.last4 === '2222', r);

  r = await call('GET', '/api/providers');
  const groq = r.json.providers.find((p) => p.id === 'groq');
  check(
    'listing shows configured + last4 but never the key',
    groq.configured === true && groq.last4 === '1111' && !JSON.stringify(r.json).includes('good-groq-key') && !JSON.stringify(r.json).includes('ciphertext'),
    r,
  );

  r = await call('PUT', '/api/providers/selection', { tts: { provider: 'groq', model: 'x' } });
  check('Groq cannot do text to speech -> 400', r.status === 400 && r.json.code === 'PROVIDER_STAGE_MISMATCH', r);
  r = await call('PUT', '/api/providers/selection', { stt: { provider: 'deepgram', model: 'nova-3' } });
  check('choosing a provider without a saved key -> 400', r.status === 400 && r.json.code === 'KEY_REQUIRED', r);
  r = await call('PUT', '/api/providers/selection', {
    stt: { provider: 'groq', model: 'whisper-large-v3-turbo' },
    llm: { provider: 'groq', model: 'openai/gpt-oss-120b' },
  });
  check('two of three stages chosen: still not enough', r.status === 200 && r.json.entitlement.kind === 'blocked', r);
  r = await call('PUT', '/api/providers/selection', { tts: { provider: 'elevenlabs', model: 'eleven_turbo_v2_5' } });
  check('all three stages chosen -> entitlement byok', r.status === 200 && r.json.entitlement.kind === 'byok' && r.json.selection.tts.voice, r);

  // ---- disconnect, rejoin and oversized-save edge cases
  r = await call('POST', '/api/interviews');
  const id2 = r.json.interview.id;
  check('with keys saved the next interview is byok and full length', r.status === 201 && r.json.interview.mode === 'byok' && r.json.interview.maxMinutes === 25, r);
  check('the interview response carries no key material', !JSON.stringify(r.json).includes('good-groq-key') && !JSON.stringify(r.json).includes('good-eleven-key'), r);
  {
    const saved = cookie;
    cookie = '';
    const ctx = await call('GET', `/internal/interviews/${id2}/context`, undefined, ik);
    check(
      'agent context carries the decrypted keys, per stage',
      ctx.status === 200 &&
        ctx.json.mode === 'byok' &&
        ctx.json.models.stt.apiKey === GROQ_KEY &&
        ctx.json.models.llm.apiKey === GROQ_KEY &&
        ctx.json.models.tts.apiKey === ELEVEN_KEY &&
        ctx.json.models.tts.provider === 'elevenlabs',
      { status: ctx.status, mode: ctx.json.mode },
    );
    cookie = saved;
  }
  r = await call('POST', `/api/interviews/${id2}/token`);
  check('new interview: first token -> 200', r.status === 200, r);
  r = await call('POST', `/api/interviews/${id2}/token`);
  check('two tabs: immediate second token -> 409', r.status === 409 && r.json.code === 'TOKEN_RECENTLY_ISSUED', r);

  cookie = '';
  await call('POST', `/internal/interviews/${id2}/started`, {}, ik);
  cookie = session;
  r = await call('POST', `/api/interviews/${id2}/token`);
  check('in progress with no rejoin window -> 409', r.status === 409 && r.json.code === 'INTERVIEW_NOT_JOINABLE', r);

  cookie = '';
  r = await call('POST', `/internal/interviews/${id2}/presence`, { rejoinUntil: Date.now() + 60_000 }, ik);
  check('agent reports a disconnect with a deadline', r.status === 200, r);
  cookie = session;
  r = await call('GET', `/api/interviews/${id2}`);
  check('detail reports canRejoin', r.json.interview.canRejoin === true, r);

  await sleep(1200);
  r = await call('POST', `/api/interviews/${id2}/token`);
  check('rejoin token while the agent holds the place -> 200', r.status === 200, r);
  const rejoinClaims = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString());
  check('rejoin token does not dispatch a second interviewer', !rejoinClaims.roomConfig?.agents?.length, rejoinClaims.roomConfig);

  cookie = '';
  await call('POST', `/internal/interviews/${id2}/presence`, { rejoinUntil: null }, ik);
  cookie = session;
  r = await call('POST', `/api/interviews/${id2}/token`);
  check('rejoin window closed again -> 409', r.status === 409 && r.json.code === 'INTERVIEW_NOT_JOINABLE', r);

  cookie = '';
  r = await call(
    'POST',
    `/internal/interviews/${id2}/complete`,
    {
      endedBy: 'candidate_ended',
      transcript: [{ role: 'user', text: 'x'.repeat(20_000), at: Date.now() }],
      assessments: [{ stage: 'warmup', topic: 't'.repeat(500), question: 'q', rating: 9, notes: 'n'.repeat(5000) }],
      report: { overallRating: 7, summary: 's', strengths: [], improvements: [] },
    },
    ik,
  );
  check('oversized completion is trimmed, not rejected', r.status === 200 && !r.json.alreadyFinalized, r);
  cookie = session;
  r = await call('GET', `/api/interviews/${id2}`);
  const iv2 = r.json.interview;
  check(
    'trimmed values stored, ratings clamped, rejoin cleared',
    iv2.status === 'completed' &&
      iv2.transcript[0].text.length === 8000 &&
      iv2.assessments[0].topic.length === 200 &&
      iv2.assessments[0].rating === 5 &&
      iv2.report.overallRating === 5 &&
      iv2.canRejoin === false,
    iv2,
  );

  // ---- removing a key un-selects it; the demo does not come back
  cookie = await tokenFor(JORDAN, { email: 'jordan@example.com', name: 'Jordan Rivera' });
  r = await call('DELETE', '/api/providers/keys/groq');
  check('deleting a key clears the stages that used it', r.status === 200 && r.json.selection.stt === null && r.json.selection.llm === null && r.json.selection.tts !== null, r);
  r = await call('POST', '/api/interviews');
  check('without a complete selection the next interview is blocked again', r.status === 409 && r.json.code === 'PROVIDER_KEYS_REQUIRED', r);
  r = await call('GET', '/api/interviews');
  check('no list response ever contains a key', !JSON.stringify(r.json).includes('good-'), r);

  // ---- the demo is capped per person per day, and across the platform
  cookie = await tokenFor(CAPPED, { email: 'capped@example.com', name: 'Capped' });
  await onboard();
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = await call('POST', '/api/interviews');
    const demoId = r.json.interview?.id;
    check(`capped user, demo attempt ${attempt} is allowed`, r.status === 201 && r.json.interview.mode === 'demo', r);
    const who = cookie;
    cookie = '';
    await call('POST', `/internal/interviews/${demoId}/started`, {}, ik);
    await call('POST', `/internal/interviews/${demoId}/complete`, { endedBy: 'no_response', failed: true }, ik);
    cookie = who;
  }
  r = await call('POST', '/api/interviews');
  check('capped user, 4th demo today -> 409 DEMO_CAPACITY', r.status === 409 && r.json.code === 'DEMO_CAPACITY' && /several times/.test(r.json.error), r);

  cookie = await tokenFor(LATE, { email: 'late@example.com', name: 'Late' });
  await onboard();
  r = await call('POST', '/api/interviews');
  check('platform-wide daily demo limit reached -> 409 DEMO_CAPACITY', r.status === 409 && r.json.code === 'DEMO_CAPACITY' && /limit for today/.test(r.json.error), r);

  // ---- an unconfirmed email cannot start anything
  cookie = await tokenFor(UNVERIFIED, { email: 'unverified@example.com', name: 'Unverified' });
  await onboard();
  r = await call('POST', '/api/interviews');
  check('unconfirmed email -> 403 EMAIL_NOT_CONFIRMED', r.status === 403 && r.json.code === 'EMAIL_NOT_CONFIRMED', r);

  cookie = await tokenFor(OTHER, { email: 'other@example.com', name: 'Other' });
  r = await call('GET', `/api/interviews/${id}`);
  check("another user cannot read this interview -> 404", r.status === 404, r);
  r = await call('GET', '/api/interviews');
  check("another user's list is empty", r.status === 200 && r.json.interviews.length === 0, r);
} catch (err) {
  console.error('Smoke test crashed:', err);
  failures++;
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
  if (failures) console.log('\n--- server log ---\n' + serverLog);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
