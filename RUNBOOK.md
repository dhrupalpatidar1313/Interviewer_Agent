# Runbook

Every command needed to set up, run, test and debug the voice interviewer. Run everything from the repository root unless a command says otherwise.

## 1. What runs, and where

| # | Process | Port | Start command | Needed for |
| --- | --- | --- | --- | --- |
| 1 | LiveKit server | 7880 (7881 TCP, 7882 UDP) | `livekit-server --dev` or `docker compose up -d` | Rooms, WebRTC, agent dispatch |
| 2 | API (Express) | 4000 | `npm run dev:api` | Auth, profiles, interviews, tokens |
| 3 | Agent worker | random | `npm run dev:agent` | The AI interviewer (STT, LLM, TTS) |
| 4 | Web (Next.js) | 3000 | `npm run dev:web` | The browser app |

**All four must be running.** If the agent worker (3) is missing, the room opens and your transcript may appear, but nobody answers. `npm run dev` starts 2, 3 and 4 together; the LiveKit server (1) is always started separately.

## 2. First-time setup

```bash
node --version                 # needs 22.13 or newer
npm install
cp .env.example .env           # then edit .env (section 3)
openssl rand -hex 32           # INTERNAL_API_KEY
openssl rand -base64 32        # KEY_ENCRYPTION_SECRET (back it up: without it saved candidate keys are unreadable)
npm run agent:download-files   # once: fetches the end-of-turn model files if the agent complains they are missing
```

**Supabase, once per project** (Dashboard of the project):

1. **SQL Editor** -> paste `supabase/migrations/0001_init.sql` -> Run. It creates five tables with row level security on and no policies, so only the API's secret key can touch them.
2. **Authentication -> Sign In / Providers -> Email**: keep "Confirm email" **on**. The free demo relies on verified addresses.
3. **Authentication -> URL Configuration**: Site URL `http://localhost:3000` (your real domain in production) and add the same origin to the redirect URLs, so the confirmation and reset-password links land back in the app.
4. **Project Settings -> API Keys**: copy the project URL, the publishable key and the secret key into `.env` (section 3).
5. Check it all: `npm run test:supabase`. It creates two throwaway users, exercises the real database and row level security, then deletes them.

Supabase's built-in email sender allows only a few messages per hour. If sign-up emails stop arriving while testing, that is the limit; set up custom SMTP (Authentication -> Emails -> SMTP Settings) for anything beyond a handful.

## 3. Configuration (`.env` in the repository root)

All three apps read this one file. Never commit it.

### LiveKit server (local) and LiveKit Inference (Cloud)

```bash
# Local server: rooms, tokens, agent dispatch
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# LiveKit Cloud project keys, used ONLY by the Inference gateway (cloud STT / TTS / turn detector).
# These are different from the three lines above. Do not reuse the name LIVEKIT_API_SECRET for them.
LIVEKIT_INFERENCE_API_KEY=<key from your LiveKit Cloud project>
LIVEKIT_INFERENCE_API_SECRET=<secret from your LiveKit Cloud project>
```

A variable name may appear **only once** in `.env`. A duplicate later in the file silently overrides the earlier one.

### Model providers (current setup)

```bash
STT_PROVIDER=inference         # LiveKit Cloud speech to text (deepgram/nova-3)
TTS_PROVIDER=inference         # LiveKit Cloud text to speech (cartesia/sonic-3)
LLM_PROVIDER=groq              # Groq
GROQ_API_KEY=<your Groq key>
GROQ_LLM_MODEL=qwen/qwen3.8-27b
```

Options: `STT_PROVIDER` = `inference | deepgram | openai | groq | google`; `LLM_PROVIDER` = `inference | openai | groq | google`; `TTS_PROVIDER` = `inference | openai | google`. Unset, each follows `MODEL_PROVIDER` (`plugins` or `inference`).

### Supabase and key storage

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # browser-safe; the web app signs people in with it
SUPABASE_SECRET_KEY=sb_secret_...             # SERVER ONLY: bypasses row level security
KEY_ENCRYPTION_SECRET=<openssl rand -base64 32>
```

Do not use the legacy `anon` / `service_role` keys. If `SUPABASE_URL` points at a different project than the browser signs in to, every API call returns 401.

### The free demo

```bash
DEMO_ENABLED=true
DEMO_MAX_MINUTES=8
DEMO_DAILY_LIMIT=30            # demo interviews that ran per UTC day across everyone (0 = no limit)
DEMO_ATTEMPTS_PER_DAY=3        # per person
```

The demo runs on the platform models from "Model providers" above. A demo counts as used only once it actually ran and did not fail (so "no response" and technical failures do not use it up). Candidates' own full interviews use their own keys and ignore the `*_PROVIDER` settings.

### Other required values

```bash
INTERNAL_API_KEY=<openssl rand -hex 32>
API_PORT=4000
API_URL=http://localhost:4000
WEB_ORIGIN=http://localhost:3000
AGENT_NAME=ai-interviewer      # must match between the API and the agent
INTERVIEW_MAX_MINUTES=25       # length of a full (own-keys) interview

# Interruptions (all optional, these are the defaults)
REJOIN_GRACE_SECONDS=120       # how long Alex holds a disconnected candidate's place
NO_RESPONSE_SECONDS=180        # end as "no response" if the candidate never says anything
TOKEN_REISSUE_SECONDS=10       # minimum gap between join tokens for one interview
```

**Any change to `.env` needs a restart of the process that reads it.** The agent reads it once at start-up.

## 4. Start everything

Use one terminal per process so each log stays readable.

```bash
# Terminal 1: LiveKit server (pick one)
livekit-server --dev                 # local binary, keys devkey / secret
docker compose up -d                 # or Docker, same keys

# Terminal 2: API
npm run dev:api

# Terminal 3: agent worker
npm run dev:agent

# Terminal 4: web app
npm run dev:web
```

Shortcut for terminals 2 to 4 in a single terminal: `npm run dev`.

Open <http://localhost:3000>.

### Healthy start-up looks like this

| Process | Line to look for |
| --- | --- |
| LiveKit server | `starting LiveKit server ... "portHttp": 7880` |
| API | listening on port 4000 |
| Agent | `registered worker ... agentName: "ai-interviewer"` |
| Web | `Ready` on port 3000 |

## 5. Verify it is up

```bash
curl -s localhost:4000/api/health          # API alive
curl -sI localhost:3000 | head -1          # web alive
curl -sI localhost:7880 | head -1          # LiveKit alive
ps -eo pid,args | grep -E "livekit-server|src/server.ts|src/main.ts|next dev" | grep -v grep
```

API docs (Swagger UI): <http://localhost:4000/api-docs>

## 6. Run an interview

1. Sign up at <http://localhost:3000>, **open the confirmation link in the email**, then sign in and complete onboarding (profile and resume).
2. Start an interview from the dashboard and allow the microphone. Your first one is the free demo (about 8 minutes, basics and intermediate questions). After that, add your keys under **API keys** in the top bar: save a key per provider (it is checked with the provider), then choose a provider for listening, thinking and voice.
3. **Start a new interview after every worker restart.** A worker only picks up new rooms, and a blocked or failed attempt cannot be reused.
4. Alex greets you first. If nothing is spoken within a few seconds, go to section 8.

## 7. Stop, restart and clean up

```bash
# Stop a process: press Ctrl+C in its terminal.
docker compose down                       # stop the Docker LiveKit server

# Restart only the agent after editing .env or agent code
# (Ctrl+C in its terminal, then:)
npm run dev:agent

# Find and stop a stray agent worker by PID
ps -eo pid,args | grep "src/main.ts" | grep -v grep
kill <pid> [<pid> ...]
```

Do not use `pkill -f` with a pattern that also appears in your own command line; it can kill the shell running it.

## 8. Troubleshooting by symptom

Always check these three places first: the **LiveKit server log**, the **agent terminal**, and the **browser console**.

### "I speak, my transcript shows, but Alex never answers"

The speech-to-text side works. The LLM or TTS step is failing. Look in the **agent terminal**:

```bash
# if you saved the agent output to a file:
grep -nE "ERROR|agent session error|llm_error|statusCode|model_not_found" agent.log
```

| What the agent log says | Cause | Fix |
| --- | --- | --- |
| `llm_error ... model_not_found ... statusCode: 404` | The Groq model name does not exist for your key | List your models (below) and set `GROQ_LLM_MODEL` to one of them, then restart the agent |
| `statusCode: 401` | Wrong or empty `GROQ_API_KEY` | Fix the key, restart the agent |
| `statusCode: 429` | Groq rate limit | Wait, or use a smaller model |
| `GROQ_API_KEY is required ...` | Groq selected but no key | Set `GROQ_API_KEY`, restart |
| Errors mentioning `agent-gateway.livekit.cloud` or `401` on `/v1/stt` or `/v1/tts` | `LIVEKIT_INFERENCE_API_KEY` / `_SECRET` missing, wrong, or not from a Cloud project | Re-copy both from the Cloud dashboard, keep names exactly as in section 3 |

List the Groq models your key can use (the key is read from `.env` and not printed):

```bash
KEY=$(grep -E '^GROQ_API_KEY=' .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $KEY" https://api.groq.com/openai/v1/models \
  | python3 -c "import sys,json; print(sorted(m['id'] for m in json.load(sys.stdin)['data']))"
```

Model names change over time. `llama-3.3-70b-versatile` was removed, which caused exactly this symptom. Chat models that worked with tool calls here: `qwen/qwen3.8-27b` (fastest), `openai/gpt-oss-20b`, `openai/gpt-oss-120b`.

### Interviews that end early, or do not end the way you expect

Every interview is saved with an "ended by" reason. It shows on the dashboard and in the report, and in the agent log as `interview saved ... endedBy`.

| Reason | What happened | Notes |
| --- | --- | --- |
| `agent_completed` | Alex finished and wrote the summary | Normal |
| `candidate_ended` | The candidate pressed **End and save** | Saved immediately (about a second). The report is written from what was said |
| `candidate_left` | The candidate disconnected and did not return within `REJOIN_GRACE_SECONDS` | Until then the dashboard shows **Rejoin** |
| `no_response` | The candidate said nothing for `NO_RESPONSE_SECONDS` | Saved as "did not run" |
| `provider_error` | A model provider failed for good (bad key, removed model, quota) | Browser shows a technical-problem message; saved as "did not run" if nothing was answered |
| `time_limit` | Hard time limit reached | |
| `timeout` | The agent never reported back and the API marked it stale (`INTERVIEW_MAX_MINUTES` + 8 min) | Check the agent log for a crash |

- **Candidate refreshed or lost Wi-Fi:** the page shows "You were disconnected" with **Rejoin interview** for up to `REJOIN_GRACE_SECONDS`. Short drops reconnect on their own ("Reconnecting" banner). Rejoin tokens do not start a second interviewer.
- **"The interviewer is not available right now":** the browser joined but no agent appeared within 25 seconds. Start the agent worker (`npm run dev:agent`) and press **Try again**; the interview is not used up.
- **Agent log: `minijinja ... No user query found in messages`:** the model's chat template needs a user message. The opening greeting sends a stand-in message for this; if you see it again, check that `CANDIDATE_JOINED_MARKER` is still passed in `apps/agent/src/interviewer.ts`.
- **Agent log: `candidate disconnected; holding their place`** then `candidate reconnected` or `no_response` / `candidate_left` shows the rejoin flow working.
- **`409 TOKEN_RECENTLY_ISSUED`:** a second tab or double click asked for a join token within `TOKEN_REISSUE_SECONDS`. Wait a few seconds.
- **Console error `DataStreamError: Room disconnected in the middle of receiving data`:** fixed in the app (transcript reader in `apps/web/src/lib/useLiveTranscript.ts` ignores it). If it returns, something else is reading LiveKit text streams without a handler.
- **Results never appeared after a long wait:** check `FAILED to save interview results` in the agent log. The agent retries for about 45 seconds; after that only the stale-interview timeout will close the interview, without a transcript.

### Accounts, saved keys and the free demo

| Symptom | Cause | Fix |
| --- | --- | --- |
| API log: `Could not find the table 'public.…' in the schema cache (PGRST205)` | The migration has not been run on this Supabase project | Run `supabase/migrations/0001_init.sql` in the SQL Editor, then `npm run test:supabase` |
| Signed in, but every call is `401` ("session has expired") | `SUPABASE_URL` is a different project from the one the browser signs in to, or the system clock is far off | Use the same project URL everywhere; check the API log line `Token verification unavailable` |
| `503` "Sign-in is temporarily unavailable" | The API could not fetch the project's signing keys (JWKS) | Check the API host can reach `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` |
| Sign-up works but no email arrives | Supabase's built-in sender allows only a few emails per hour | Wait, or add custom SMTP (Authentication -> Emails -> SMTP Settings) |
| Confirmation link opens the wrong site | Site URL / redirect URLs not set to your domain | Authentication -> URL Configuration |
| `403 EMAIL_NOT_CONFIRMED` when starting | The address is unconfirmed (only possible if "Confirm email" was switched off) | Turn "Confirm email" on, or confirm the user in the dashboard |
| "Saving your own keys is not switched on" / `503 KEYS_NOT_CONFIGURED` | `KEY_ENCRYPTION_SECRET` is not set | `openssl rand -base64 32` into `.env`, restart the API |
| Saving a key fails with "did not accept that key" | The provider rejected it (`422 KEY_INVALID`) | Re-copy it; make sure it is active and not restricted to other services |
| Saving a key fails with "could not be reached" | Provider outage or the API host cannot reach the provider (`502`) | Try again; check outbound network access |
| "You have used your free demo interview" | `409 PROVIDER_KEYS_REQUIRED`: the one demo is spent | The candidate adds keys under **API keys** and chooses a provider for all three parts |
| "The free demo has reached its limit for today" / "tried the demo several times today" | `409 DEMO_CAPACITY`: `DEMO_DAILY_LIMIT` / `DEMO_ATTEMPTS_PER_DAY` reached | Raise the limit, wait for the next UTC day, or the candidate adds keys |
| Agent log: `could not set up the interview models` | A required key is missing (for example `GROQ_API_KEY` for the demo, or `GOOGLE_API_KEY` after switching to `google`) | Set it and restart the agent. The interview is closed as "did not run" and not counted |
| Browser says a key was rejected / a model is no longer available / the provider is limiting requests | The agent's `interview_error` (`key_rejected`, `model_unavailable`, `rate_limited`) after a provider failure | The candidate fixes the key or picks another model in **API keys**; the transcript so far is saved |
| A candidate's saved key stops working after a restore | `KEY_ENCRYPTION_SECRET` changed or was lost, so the key cannot be decrypted | Restore the original secret; otherwise ask people to re-enter their keys |

Rotating `KEY_ENCRYPTION_SECRET` is not supported yet: changing it makes every saved key unreadable. Do not change it casually.

### Room opens, nobody joins, no transcript

LiveKit server log shows:

```
not dispatching agent job since no worker is available   {"agentName": "ai-interviewer", ...}
```

The agent worker is not running, or its name does not match. Start it (`npm run dev:agent`), and confirm `AGENT_NAME` is identical in the API and the agent (same `.env`).

```bash
grep -n "no worker is available" logs.txt     # LiveKit server log saved to a file
```

### Agent log: `GROQ_API_KEY is required`, `apiKey is required: pass apiKey or set LIVEKIT_API_KEY`

A key is missing for the provider you selected. Check names and values:

```bash
# prints names and lengths only, never the values
for k in GROQ_API_KEY LIVEKIT_INFERENCE_API_KEY LIVEKIT_INFERENCE_API_SECRET; do
  v=$(grep -E "^$k=" .env | cut -d= -f2-); echo "$k len=${#v}"
done
grep -nE '^LIVEKIT_' .env | sed -E 's/=.*/=<set>/'     # each name must appear once
```

### Browser cannot connect, or the token is rejected

`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` must match the **local** server (`devkey` / `secret` for `--dev`). If they were overwritten with Cloud values, tokens signed by the API are rejected by the local server.

### Harmless warnings you will see

- `failed to send session event ... room session transport is closed` (one or two at start-up).
- `turn detection transport latency is too high`. The end-of-turn model runs on Cloud while the room is local, so replies can feel slightly slower. To avoid the remote call, set `TURN_DETECTOR=off` in `.env` (uses VAD-only endpointing) and restart the agent.
- `dev mode is deprecated ... use lk agent dev`.

### Browser console shows the proxy failing

`API_URL` was different when `next build` ran. Rebuild with the right value.

### Microphone blocked

Allow microphone access for localhost, then start a new interview from the dashboard.

## 9. Reading the logs

```bash
# Save each process's output while still seeing it
livekit-server --dev 2>&1 | tee logs.txt
npm run dev:agent 2>&1 | tee agent.log

# Errors in the agent log (strip colour codes first)
sed -E 's/\x1b\[[0-9;]*m//g' agent.log | grep -nE "ERROR|WARN" | grep -v "room session transport is closed"

# Did the agent get the job and hear the candidate?
sed -E 's/\x1b\[[0-9;]*m//g' agent.log | grep -nE "received job request|received user transcript|Creating speech handle|agent session error"

# LiveKit server: did the agent join, was dispatch skipped?
grep -nE "no worker is available|closing room|IDLE_TIMEOUT" logs.txt
grep -o '"participant": "[^"]*"' logs.txt | sort | uniq -c      # who joined the room
```

A good turn in the agent log reads: `received user transcript` then `Creating speech handle` then `performLLMInference started` with **no** `agent session error` after it.

Log files can contain tokens and keys. Do not paste them into public places without removing those first.

## 10. Checks and tests

```bash
npm run typecheck          # all workspaces
npm run test:agent         # prompts and stage logic, no keys needed
npm run test:api           # HTTP API smoke test with a throwaway database
npm test                   # both tests
```

Probe a single provider without a full interview:

```bash
# Groq chat model responds and supports tools
KEY=$(grep -E '^GROQ_API_KEY=' .env | cut -d= -f2-)
curl -s https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen/qwen3.8-27b","messages":[{"role":"user","content":"Say hello in five words."}]}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])"
```

## 11. Production

```bash
npm run build              # builds API, agent and web
npm run start -w apps/api  # node dist/server.js
npm run start -w apps/web  # next start -p 3000
```

Set `API_URL` (and the `SUPABASE_*` values) before `npm run build`; Next.js bakes them in. Use LiveKit Cloud (or a properly configured self-hosted LiveKit) instead of the `--dev` keys, and `NODE_ENV=production` (which makes `KEY_ENCRYPTION_SECRET` mandatory).

### The agent on LiveKit Cloud

```bash
cd apps/agent
lk cloud auth                          # once: sign in and pick the production project
lk agent create                        # first time: registers the agent and deploys the first version
lk agent secrets set --help            # see how to set secrets, then set the ones below
lk agent deploy                        # every later release
lk agent status                        # running?
lk agent logs                          # look for "registered worker"
```

The Dockerfile in `apps/agent` is self-contained (`lk` builds from that directory). Set these as agent secrets (not baked into the image): `API_URL` (the public HTTPS URL of the API), `INTERNAL_API_KEY`, `AGENT_NAME`, `GROQ_API_KEY` and/or `GOOGLE_API_KEY` for the demo models, and the `STT_PROVIDER` / `LLM_PROVIDER` / `TTS_PROVIDER` choices. `LIVEKIT_URL` and the project keys are provided by LiveKit Cloud, and `LIVEKIT_INFERENCE_*` is not needed because the agent runs inside the same project. Existing sessions keep running on the old version for up to an hour after a deploy. The Build plan allows 5 concurrent agent sessions.

Because the agent now calls the API over the internet, `/internal` is reachable from outside: keep `INTERNAL_API_KEY` long and secret (it is rate-limited and compared in constant time).

Test the image locally before deploying: `docker build -t agent apps/agent`.

### Switching the demo to Gemini

```bash
npm run probe:gemini                    # needs GOOGLE_API_KEY; checks the model ids and times one reply and one voice call
# then in .env:  STT_PROVIDER=google  LLM_PROVIDER=google  TTS_PROVIDER=google   and restart the agent
```

Run a real spoken interview afterwards. The probe cannot test the live speech-to-text model. The free tier has low per-project limits; if the demo starts failing with `demo_capacity`, enable billing on the key's project or switch back by removing the three `google` lines.

## 12. Reference

| Item | Value |
| --- | --- |
| Web app | <http://localhost:3000> |
| API | <http://localhost:4000>, health at `/api/health`, docs at `/api-docs` |
| LiveKit (local) | `ws://localhost:7880`, keys `devkey` / `secret` |
| Agent dispatch name | `ai-interviewer` (`AGENT_NAME`) |
| Database + accounts | Supabase project from `SUPABASE_URL`; schema in `supabase/migrations/0001_init.sql` |
| Old local database | `data/interviewer.db` is the retired SQLite file. Nothing reads it any more; delete it when you like |
| Agent model wiring | `apps/agent/src/models.ts`, settings in `apps/agent/src/env.ts` |
| Interview behaviour | `apps/agent/src/prompts.ts`, `apps/agent/src/interviewer.ts`, `apps/agent/src/main.ts` |
