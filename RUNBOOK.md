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
node --version                 # needs 22.13 or newer (the API uses the built-in node:sqlite)
npm install
cp .env.example .env           # then edit .env (section 3)
openssl rand -hex 32           # run twice: one value for JWT_SECRET, one for INTERNAL_API_KEY
npm run agent:download-files   # once: fetches the end-of-turn model files if the agent complains they are missing
```

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

Options: `STT_PROVIDER` = `inference | deepgram | openai | groq`; `LLM_PROVIDER` = `inference | openai | groq`; `TTS_PROVIDER` = `inference | openai`. Unset, each follows `MODEL_PROVIDER` (`plugins` or `inference`).

### Other required values

```bash
JWT_SECRET=<openssl rand -hex 32>
INTERNAL_API_KEY=<openssl rand -hex 32>
API_PORT=4000
API_URL=http://localhost:4000
WEB_ORIGIN=http://localhost:3000
AGENT_NAME=ai-interviewer      # must match between the API and the agent
INTERVIEW_MAX_MINUTES=25
DATABASE_PATH=./data/interviewer.db
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

1. Sign up or log in at <http://localhost:3000>, complete onboarding (and resume upload if you want one).
2. Start an interview from the dashboard and allow the microphone.
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
- SQLite experimental warning on Node 22.

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

## 11. Production build

```bash
npm run build              # builds API, agent and web
npm run start -w apps/api  # node dist/server.js
npm run start -w apps/agent   # node dist/main.js start
npm run start -w apps/web  # next start -p 3000
```

Set `API_URL` before `npm run build`; Next.js bakes it in. For production use LiveKit Cloud or a properly configured self-hosted LiveKit deployment instead of `--dev` keys.

## 12. Reference

| Item | Value |
| --- | --- |
| Web app | <http://localhost:3000> |
| API | <http://localhost:4000>, health at `/api/health`, docs at `/api-docs` |
| LiveKit (local) | `ws://localhost:7880`, keys `devkey` / `secret` |
| Agent dispatch name | `ai-interviewer` (`AGENT_NAME`) |
| Database | `data/interviewer.db` (SQLite) |
| Agent model wiring | `apps/agent/src/models.ts`, settings in `apps/agent/src/env.ts` |
| Interview behaviour | `apps/agent/src/prompts.ts`, `apps/agent/src/interviewer.ts`, `apps/agent/src/main.ts` |
