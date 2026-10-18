// End-to-end smoke test of the HTTP API: auth, profile, resume upload, interviews, LiveKit tokens, and the
// agent-only /internal endpoints. Starts its own API instance with a throwaway database.
//
//   npm run test:api
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'voice-interviewer-smoke-'));
const port = 4710;
const base = `http://localhost:${port}`;
const INTERNAL_KEY = 'internal-key-internal-key-1234';

const server = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: path.join(root, 'apps/api'),
  env: {
    ...process.env,
    API_PORT: String(port),
    JWT_SECRET: 'test-secret-test-secret-123456',
    INTERNAL_API_KEY: INTERNAL_KEY,
    DATABASE_PATH: path.join(tmp, 'smoke.db'),
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secretsecretsecretsecretsecret12',
    AGENT_NAME: 'ai-interviewer',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';

async function call(method, route, body, headers = {}) {
  const h = { ...(cookie ? { cookie } : {}), ...headers };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + route, { method, headers: h, body: payload });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
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

try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await sleep(250);
  }

  let r = await call('GET', '/api/auth/me');
  check('me without session -> 401', r.status === 401, r);

  r = await call('POST', '/api/auth/signup', { name: 'Jordan Rivera', email: 'Jordan@Example.com', password: 'short' });
  check('signup rejects short password -> 400', r.status === 400, r);

  r = await call('POST', '/api/auth/signup', { name: 'Jordan Rivera', email: 'Jordan@Example.com', password: 'correct-horse-battery' });
  check('signup -> 201 + cookie, email normalised', r.status === 201 && !!cookie && r.json.user.email === 'jordan@example.com', r);

  r = await call('POST', '/api/auth/signup', { name: 'Dup', email: 'jordan@example.com', password: 'correct-horse-battery' });
  check('duplicate signup -> 409', r.status === 409, r);

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
  check('create interview -> 201', r.status === 201 && r.json.interview.status === 'created', r);
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
  const session = cookie;
  cookie = '';
  r = await call('GET', `/internal/interviews/${id}/context`, undefined, ik);
  check(
    'agent context has profile + resume text',
    r.status === 200 &&
      r.json.candidate.profile.targetRole === 'Senior Backend Engineer' &&
      r.json.candidate.resume.text.includes('Kafka') &&
      r.json.participantIdentity.startsWith('user-'),
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

  cookie = '';
  await call('POST', '/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'another-password-1' });
  r = await call('GET', `/api/interviews/${id}`);
  check("another user cannot read this interview -> 404", r.status === 404, r);

  r = await call('POST', '/api/auth/login', { email: 'jordan@example.com', password: 'wrong-password-1' });
  check('bad login -> 401', r.status === 401, r);
  r = await call('POST', '/api/auth/login', { email: 'jordan@example.com', password: 'correct-horse-battery' });
  check('good login -> 200', r.status === 200, r);
} catch (err) {
  console.error('Smoke test crashed:', err);
  failures++;
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
  if (failures) console.log('\n--- server log ---\n' + serverLog);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
