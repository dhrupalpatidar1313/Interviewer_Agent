// End-to-end check of the REAL Supabase project from .env: real JWT verification against the project's JWKS, the
// Postgres-backed store, row level security, and the encrypted provider-key flow.
//
//   npm run test:supabase
//
// Prerequisite: supabase/migrations/0001_init.sql has been run in the project (Dashboard -> SQL Editor).
// It creates two throwaway users (already email-confirmed, so no mail is sent), runs the real API against the real
// database, and deletes the users afterwards. Their rows go with them (ON DELETE CASCADE).
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env without overriding anything already exported.
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY, INTERNAL_API_KEY, GROQ_API_KEY } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY, INTERNAL_API_KEY })) {
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const port = 4730;
const base = `http://localhost:${port}`;
const password = `Check-${randomBytes(9).toString('base64url')}`;
const stamp = Date.now();
const created = [];
let server;
let serverLog = '';
let failures = 0;

function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(extra)}`);
  if (!ok) failures++;
}

async function call(token, method, route, body, headers = {}) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
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

async function newUser(label) {
  const email = `live-check+${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Live Check ${label}` },
  });
  if (error) throw new Error(`could not create a test user: ${error.message}`);
  created.push(data.user.id);
  // Sign in the way the browser does, to get a genuine Supabase access token.
  const browser = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInError } = await browser.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`could not sign in the test user: ${signInError.message}`);
  return { id: data.user.id, email, token: session.session.access_token, browser };
}

const RESUME = [
  'Live Check, backend engineer.',
  'Acme 2021-2025: built REST and gRPC APIs in Node.js and PostgreSQL, owned the payments service and cut p99 latency by 40 percent.',
  'Globex 2019-2021: backend engineer on an event-driven platform using Kafka; mentored two junior engineers.',
].join('\n');

async function onboard(token) {
  await call(token, 'PUT', '/api/profile', {
    fullName: 'Live Check',
    targetRole: 'Backend Engineer',
    experienceLevel: 'mid',
    yearsExperience: 4,
    skills: ['TypeScript', 'PostgreSQL'],
  });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'resume.txt');
  return call(token, 'POST', '/api/profile/resume', form);
}

try {
  // 0. The migration has been applied?
  const missing = [];
  for (const table of ['profiles', 'resumes', 'interviews', 'user_provider_keys', 'user_model_selection']) {
    // A plain read, not HEAD: a HEAD response has no body, so PostgREST's "table not found" error never reaches us.
    const { error } = await admin.from(table).select('*').limit(1);
    if (error) missing.push(`${table} (${error.message})`);
  }
  if (missing.length) {
    console.error('The database tables are not there yet:\n  - ' + missing.join('\n  - '));
    console.error('\nRun supabase/migrations/0001_init.sql in the Supabase SQL Editor, then run this again.');
    process.exit(2);
  }
  check('all five tables exist', true);

  // 1. Start the real API (Supabase store, real JWKS), on a spare port.
  server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, API_PORT: String(port), TOKEN_REISSUE_SECONDS: '1', STORE_BACKEND: 'supabase' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const alice = await newUser('alice');
  const bob = await newUser('bob');

  // 2. Real tokens, verified against the project's real JWKS.
  let r = await call(null, 'GET', '/api/auth/me');
  check('no token -> 401', r.status === 401, r);
  r = await call('garbage.token.value', 'GET', '/api/auth/me');
  check('garbage token -> 401', r.status === 401, r);
  r = await call(alice.token, 'GET', '/api/auth/me');
  check(
    'a real Supabase access token is accepted',
    r.status === 200 && r.json.user.id === alice.id && r.json.user.email === alice.email && r.json.user.name === 'Live Check alice',
    r,
  );

  // 3. Profile + resume really land in Postgres.
  r = await onboard(alice.token);
  check('resume stored in Postgres', r.status === 201, r);
  r = await call(alice.token, 'GET', '/api/profile');
  check('profile round-trips (jsonb skills)', r.status === 200 && r.json.profile.skills.join() === 'TypeScript,PostgreSQL' && r.json.resume.filename === 'resume.txt', r);
  r = await call(alice.token, 'GET', '/api/auth/me');
  check('onboarding complete', r.json.onboarding.complete === true, r);

  // 4. A full interview lifecycle through the store, including the atomic operations.
  r = await call(alice.token, 'POST', '/api/interviews');
  check('first interview is the free demo', r.status === 201 && r.json.interview.mode === 'demo', r);
  const id = r.json.interview.id;
  r = await call(alice.token, 'POST', `/api/interviews/${id}/token`);
  check('join token issued', r.status === 200 && typeof r.json.token === 'string', r);
  r = await call(alice.token, 'POST', `/api/interviews/${id}/token`);
  check('second token within the gap refused (atomic claim works in Postgres)', r.status === 409 && r.json.code === 'TOKEN_RECENTLY_ISSUED', r);

  const ik = { 'x-internal-key': INTERNAL_API_KEY };
  r = await call(null, 'GET', `/internal/interviews/${id}/context`, undefined, ik);
  check('agent context for a demo has no keys', r.status === 200 && r.json.mode === 'demo' && r.json.models === null && r.json.candidate.profile.targetRole === 'Backend Engineer', r);
  await call(null, 'POST', `/internal/interviews/${id}/started`, {}, ik);
  r = await call(alice.token, 'GET', `/api/interviews/${id}`);
  check('status moved to in_progress', r.json.interview.status === 'in_progress', r);

  await call(null, 'POST', `/internal/interviews/${id}/presence`, { rejoinUntil: Date.now() + 60_000 }, ik);
  r = await call(alice.token, 'GET', `/api/interviews/${id}`);
  check('rejoin window stored', r.json.interview.canRejoin === true, r);

  r = await call(null, 'POST', `/internal/interviews/${id}/complete`, {
    endedBy: 'agent_completed',
    transcript: [{ role: 'user', text: 'Hello', at: Date.now() }],
    assessments: [{ stage: 'warmup', topic: 'Intro', question: 'q', rating: 4, notes: 'ok' }],
    report: { overallRating: 4, summary: 'Good.', strengths: ['a'], improvements: ['b'] },
  }, ik);
  check('completion saved', r.status === 200 && !r.json.alreadyFinalized, r);
  r = await call(null, 'POST', `/internal/interviews/${id}/complete`, { endedBy: 'again' }, ik);
  check('second completion is a no-op (first writer wins)', r.status === 200 && r.json.alreadyFinalized === true, r);
  r = await call(alice.token, 'GET', `/api/interviews/${id}`);
  check(
    'results read back from Postgres',
    r.json.interview.status === 'completed' && r.json.interview.report.overallRating === 4 && r.json.interview.transcript.length === 1 && r.json.interview.canRejoin === false,
    r.json,
  );

  r = await call(alice.token, 'POST', '/api/interviews');
  check('the demo is one-shot: next interview needs keys', r.status === 409 && r.json.code === 'PROVIDER_KEYS_REQUIRED', r);

  // 5. Another user cannot see Alice's data.
  await onboard(bob.token);
  r = await call(bob.token, 'GET', `/api/interviews/${id}`);
  check("Bob cannot read Alice's interview -> 404", r.status === 404, r);
  r = await call(bob.token, 'GET', '/api/interviews');
  check("Bob's list is empty", r.status === 200 && r.json.interviews.length === 0, r);

  // 6. Row level security: the browser's key cannot read or write these tables directly, signed in or not.
  for (const table of ['interviews', 'profiles', 'resumes', 'user_provider_keys', 'user_model_selection']) {
    const signedIn = await alice.browser.from(table).select('*').limit(1);
    check(`RLS: signed-in browser cannot read ${table}`, !!signedIn.error || (signedIn.data ?? []).length === 0, signedIn);
  }
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const anonRead = await anon.from('interviews').select('*').limit(1);
  check('RLS: anonymous browser cannot read interviews', !!anonRead.error || (anonRead.data ?? []).length === 0, anonRead);
  const forged = await alice.browser.from('interviews').update({ status: 'completed' }).eq('id', id).select();
  check('RLS: a signed-in browser cannot modify an interview', !!forged.error || (forged.data ?? []).length === 0, forged);

  // 7. Encrypted provider keys, with a real validation call to Groq when a key is available.
  if (GROQ_API_KEY) {
    r = await call(alice.token, 'PUT', '/api/providers/keys/groq', { apiKey: GROQ_API_KEY });
    check('real Groq key validated by Groq and saved', r.status === 200 && r.json.last4 === GROQ_API_KEY.slice(-4) && r.json.models.llm.length > 0, { status: r.status, body: r.json?.error });
    const { data: row } = await admin.from('user_provider_keys').select('*').eq('user_id', alice.id).eq('provider', 'groq').single();
    check(
      'the key is stored encrypted (no plaintext anywhere in the row)',
      !!row && !JSON.stringify(row).includes(GROQ_API_KEY) && row.ciphertext.length > 20 && row.last4 === GROQ_API_KEY.slice(-4),
      { hasRow: !!row },
    );
    const signedInKeys = await alice.browser.from('user_provider_keys').select('*');
    check('RLS: the browser cannot read the encrypted key row', !!signedInKeys.error || (signedInKeys.data ?? []).length === 0, signedInKeys);
    r = await call(alice.token, 'PUT', '/api/providers/selection', {
      stt: { provider: 'groq', model: 'whisper-large-v3-turbo' },
      llm: { provider: 'groq', model: 'openai/gpt-oss-120b' },
    });
    check('selection saved', r.status === 200 && r.json.selection.llm.provider === 'groq', r);
    r = await call(alice.token, 'GET', '/api/providers');
    check('listing shows the key as saved and never the key itself', r.json.providers.find((p) => p.id === 'groq').configured === true && !JSON.stringify(r.json).includes(GROQ_API_KEY), r.status);
    r = await call(alice.token, 'DELETE', '/api/providers/keys/groq');
    check('deleting the key clears the stages that used it', r.status === 200 && r.json.selection.llm === null, r);
  } else {
    console.log('SKIP  encrypted key flow (no GROQ_API_KEY in .env)');
  }
} catch (err) {
  console.error('Live check crashed:', err);
  failures++;
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
  // Deleting the auth users removes every row that hangs off them.
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`Could not delete test user ${id}: ${error.message} (delete it in the dashboard)`);
  }
  if (failures) console.log('\n--- API log ---\n' + serverLog.split('\n').slice(-40).join('\n'));
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll live checks passed');
  process.exit(failures ? 1 : 0);
}
