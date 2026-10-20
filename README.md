# Voice AI Interviewer

A full-stack voice interviewer built on [LiveKit Agents](https://docs.livekit.io/agents/) in TypeScript.

**Flow:** sign up (confirm your email), upload a resume and fill in a short form, then talk to an AI interviewer that has already read both and works from basic questions up to advanced ones. When the interview ends you get a transcript, per-answer ratings, and written feedback.

**Free demo, then your own keys.** Every new account gets one short demo interview on the platform's own models. After that, people add their own API keys (OpenAI, Google Gemini, Groq, Deepgram, ElevenLabs or Cartesia) in Settings and run full-length interviews on those. Keys are checked with the provider, stored encrypted, and used only to run that person's interviews.

| Part | Stack | Folder |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router), React 19, `@livekit/components-react` | `apps/web` |
| Accounts + data | Supabase: Auth (email + password, confirmed addresses) and Postgres with row level security | `supabase/` |
| Backend API | Express 5, `@supabase/server` (verifies Supabase tokens, admin client), `livekit-server-sdk` | `apps/api` |
| Voice agent | `@livekit/agents` 1.9 (Node), OpenAI + Deepgram or LiveKit Inference | `apps/agent` |

## How it fits together

```
Browser (Next.js :3000)
  ├── sign-up / sign-in / reset ───────────────►  Supabase Auth
  ├── /api/*  ──(Next rewrite, Bearer token)───►  Express API :4000 ──► Supabase Postgres
  └── WebRTC audio ──────────────────────────►  LiveKit server  ◄──  Agent worker
                                                                       │
                                                 GET  /internal/interviews/:id/context
                                                 POST /internal/interviews/:id/started
                                                 POST /internal/interviews/:id/complete
                                                                       └──► Express API
```

1. **Sign up / sign in.** The browser talks to Supabase Auth directly (the publishable key). The session's access token is sent to the API as `Authorization: Bearer`, and the API verifies it against the project's JWKS with `@supabase/server`. The browser reaches the API through the Next.js rewrite, so no CORS setup is needed.
2. **Onboarding.** The resume (PDF, DOCX or TXT, up to 5 MB) is uploaded and its text extracted on the server. The form (role, level, years, skills, focus areas, links, notes) is saved. The user sees what was extracted before continuing.
3. **Start interview.** The API first decides how it is paid for: the candidate's own keys if all three stages are set up, otherwise the one free demo (capped per person and per day), otherwise it asks for keys. It snapshots the profile and resume text into an `interviews` row, creates a unique room name, and mints a LiveKit token. The token carries an agent dispatch (`RoomAgentDispatch`) whose metadata is just `{ "interviewId": "..." }`.
4. **Agent joins.** When the browser joins, LiveKit dispatches the named agent. The worker reads the interview id, fetches the full candidate context from the API using `INTERNAL_API_KEY`, builds its instructions from the form and resume, and greets the candidate by name.
5. **Interview.** Speech to text, LLM, text to speech, with VAD and an end-of-turn model tuned to give candidates time to think. The agent tracks progress through tools (below) and publishes its current stage so the browser shows a progress rail.
6. **Finish.** When the interview ends (the agent wraps up, the candidate leaves, or time runs out) the agent posts the transcript, assessments and summary back to the API. The browser polls and shows the report.

## Quick start

**Prerequisites:** Node 22.13 or newer, a Supabase project, Docker (for a local LiveKit server) or a LiveKit Cloud project, and model keys for the free demo (for example Groq, or a LiveKit Cloud project for Inference, see below).

```bash
npm install
cp .env.example .env        # then edit it
# Supabase, once: run supabase/migrations/0001_init.sql in the dashboard's SQL Editor,
# and turn on Authentication -> Sign In / Providers -> Email -> "Confirm email".
npm run test:supabase       # optional: checks the real project end to end, then cleans up after itself
docker compose up -d        # local LiveKit server: ws://localhost:7880, keys devkey / secret
npm run dev                 # API :4000, agent worker, web :3000
```

Open <http://localhost:3000>.

In `.env`, set at minimum:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: from the Supabase dashboard (API Keys). The secret key stays on the server.
- `INTERNAL_API_KEY`: a long random string (`openssl rand -hex 32`).
- `KEY_ENCRYPTION_SECRET`: `openssl rand -base64 32`. Encrypts candidates' saved keys; **back it up**, because without it every saved key is unreadable.
- Models for the free demo: for example `STT_PROVIDER` / `LLM_PROVIDER` / `TTS_PROVIDER` (below), or `OPENAI_API_KEY` and `DEEPGRAM_API_KEY`.
- For LiveKit Cloud instead of Docker: set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from your project.

**No provider keys?** Set `MODEL_PROVIDER=inference` to use the LiveKit Inference gateway for STT, LLM and TTS. The gateway only accepts keys from a LiveKit Cloud project. With a local server, keep `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` for the local server and add the Cloud project's keys as `LIVEKIT_INFERENCE_API_KEY` / `LIVEKIT_INFERENCE_API_SECRET`.

**Mixing providers.** `STT_PROVIDER`, `LLM_PROVIDER` and `TTS_PROVIDER` pick each stage on its own (see `.env.example`). For example, LiveKit Inference for speech and Groq for the LLM:

```
STT_PROVIDER=inference
TTS_PROVIDER=inference
LLM_PROVIDER=groq
GROQ_API_KEY=...
```

Run each process separately if you prefer: `npm run dev:api`, `npm run dev:agent`, `npm run dev:web`.

The end-of-turn model may need its files fetched on first run. If the agent complains about missing model files, run `npm run agent:download-files` once. Set `TURN_DETECTOR=off` to fall back to VAD-only endpointing.

## How the interview works

The interviewer's behaviour lives in `apps/agent/src/prompts.ts` and `apps/agent/src/interviewer.ts`.

**Five stages, always in order:** warm-up, fundamentals, your experience (resume deep-dive), advanced, wrap-up. Each stage has its own guidance, and the instructions are rebuilt whenever the stage changes.

**Level calibration.** The experience level from the form (intern, junior, mid, senior, lead) changes what "fundamentals" and "advanced" mean. A senior candidate gets brief confirmation questions and an open-ended architecture problem; an intern gets foundational questions and one stretch question on a topic they know.

**Adaptive difficulty.** After every substantive answer the LLM calls `record_assessment` (topic, question, 1 to 5 rating, evidence). A running summary is fed back into the instructions, and the model is told to advance early after strong answers or stay longer with simpler questions after weak ones.

**Tools the model can call**

| Tool | Purpose |
| --- | --- |
| `record_assessment` | Silently log a rating and evidence for the last answer |
| `advance_stage` | Move forward a stage (stages cannot go backwards) |
| `end_interview` | Save the overall rating, summary, strengths and improvements, then close once the goodbye finishes playing |

**Time.** `INTERVIEW_MAX_MINUTES` is a target, not a hard cut. Three minutes before it, the instructions tell the model to start wrapping up (no spoken interruption). Two minutes after it, the agent asks for a closing turn, and two minutes after that it force-ends.

**If the candidate goes quiet** for about 25 seconds, the agent checks in once with a short, kind line (at most once every 45 seconds).

**If the candidate leaves early**, whatever was answered is still saved. If no rating was written, a plain average of the recorded assessments is used. If they never spoke, the interview is marked as not run.

**Prompt-injection hardening.** The resume and form are inserted as delimited data, the delimiter cannot be closed from inside the resume, and the instructions tell the model to ignore directions found in either, or in spoken answers.

## Configuration

All three apps read the single `.env` in the repository root. See `.env.example` for every option; the important ones:

| Variable | Used by | Notes |
| --- | --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | API, agent | `LIVEKIT_PUBLIC_URL` (API) overrides the URL given to browsers, e.g. when Docker networking differs |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | API, web | The web app signs people in with these; the API derives the JWKS URL from the URL |
| `SUPABASE_SECRET_KEY` | API | **Server only.** Bypasses row level security; never expose it |
| `KEY_ENCRYPTION_SECRET` | API | AES-256-GCM key for candidates' saved provider keys. Required in production |
| `DEMO_ENABLED`, `DEMO_MAX_MINUTES`, `DEMO_DAILY_LIMIT`, `DEMO_ATTEMPTS_PER_DAY` | API | The free demo and its spend guards |
| `INTERNAL_API_KEY` | API, agent | Shared secret for the agent-only `/internal` routes, which are not proxied to browsers |
| `API_URL` | web, agent | **Next.js bakes the rewrite target in at build time, so set `API_URL` when you run `next build`** |
| `AGENT_NAME` | API, agent | Must match; it is the dispatch name |
| `INTERVIEW_MAX_MINUTES` | API, agent | Default 25 |
| `MODEL_PROVIDER` | agent | `plugins` (OpenAI, Deepgram) or `inference` (LiveKit Inference, needs Cloud project keys) |
| `STT_PROVIDER`, `LLM_PROVIDER`, `TTS_PROVIDER` | agent | The platform's models, used for the free demo. Optional per-stage override of `MODEL_PROVIDER`; `google` (Gemini) and Groq are available. Candidates' own interviews ignore these |
| `LIVEKIT_INFERENCE_API_KEY`, `LIVEKIT_INFERENCE_API_SECRET` | agent | Cloud project keys for the Inference gateway when `LIVEKIT_*` points at a local server |
| `INTERVIEWER_NAME` | agent | Default "Alex"; the web app shows whatever the agent publishes |

## Project layout

```
apps/
  api/src/
    server.ts            Express app, error handling
    auth.ts              requireAuth (verifies the Supabase access token), /me
    routes/profile.ts    profile form + resume upload (multer, memory storage)
    routes/interviews.ts create interview, list, detail, LiveKit token
    routes/internal.ts   agent-only: context (with decrypted keys for own-key interviews), started, presence, complete
    routes/providers.ts  save/check/remove provider keys, choose models, entitlement
    entitlement.ts       free demo vs own keys vs blocked, with the daily caps
    providers.ts         the six providers: defaults, key validation, model lists
    crypto.ts, keys.ts   AES-256-GCM for saved keys
    resume.ts            PDF / DOCX / TXT text extraction
    livekit.ts           access token with agent dispatch
    store/               data access: supabase.ts (production), memory.ts (tests only)
  agent/src/
    main.ts              worker entrypoint, session wiring, saving results
    interviewer.ts       Agent class, tools, stage machine, time checks
    prompts.ts           instructions and per-stage guidance
    models.ts            STT / LLM / TTS selection
    api.ts               internal API client (with retries when saving results)
  web/src/
    app/                 landing, login, signup, forgot/reset password, onboarding, dashboard, settings, interview/[id]
    components/          VoiceRoom, Report, ResumeDrop, TagInput, StageRail, ...
    app/globals.css      the whole design system (tokens at the top)
supabase/migrations/     the database schema (run once per project)
scripts/                 agent-logic.test.ts, api-logic.test.mts, smoke-api.mjs, supabase-live-check.mjs, probe-gemini.mjs
apps/agent/Dockerfile    for `lk agent create` / `lk agent deploy`
docker-compose.yml       local LiveKit server
```

## Customising

- **Product name:** `apps/web/src/lib/brand.ts` (the placeholder is "Candor").
- **Interviewer persona, question style, stage content:** `apps/agent/src/prompts.ts`.
- **Voices and models:** `.env` (`OPENAI_TTS_VOICE`, `OPENAI_LLM_MODEL`, the `INFERENCE_*` variables) or `apps/agent/src/models.ts` to swap in another LiveKit plugin (ElevenLabs, Cartesia, Google, ...).
- **Language:** the STT language is set to English in `models.ts` and the prompts are English.
- **Look and feel:** design tokens are at the top of `apps/web/src/app/globals.css`.

## Production checklist

This is a working foundation, not a hardened deployment. Before real users:

- Serve everything over HTTPS (browsers only allow microphone access on HTTPS or localhost) and run with `NODE_ENV=production`, which also makes `KEY_ENCRYPTION_SECRET` mandatory.
- Use strong, unique `INTERNAL_API_KEY` and `KEY_ENCRYPTION_SECRET`. When the agent runs on LiveKit Cloud it must reach `/internal` over the internet, so keep that key secret and rate-limited (it is).
- In Supabase: keep "Confirm email" on (the demo relies on it), set the Site URL and redirect URLs to your domain, and use custom SMTP for real traffic (the built-in sender is heavily rate limited).
- The rate limiters are in-memory; with more than one API instance use a shared store or your gateway.
- Run the agent as its own long-lived worker. On LiveKit Cloud: `cd apps/agent && lk agent create` then `lk agent deploy`, with the model keys as `lk agent secrets`. The Build plan allows 5 concurrent agent sessions.
- Gemini's free tier has low limits and may use prompts to improve Google's products; for real traffic enable billing on the key's project. Run `npm run probe:gemini` before switching the demo to Gemini.
- Resumes and transcripts are personal data. Add a retention and deletion policy, a consent notice that the conversation is processed by third-party AI services and stored, and an account-deletion path.
- The ratings are LLM-generated. This build is framed as practice feedback. If you use it to screen real applicants, add human review, a fairness and legal review, and do not treat the score as a decision.
- Not included: background noise cancellation (optional LiveKit plugin), a LiveKit webhook to close stuck interviews immediately (a stale-interview timeout covers it), account deletion, and automated browser tests.

## Tests and what has been verified

```bash
npm run typecheck     # all three workspaces
npm test              # agent logic + API units (encryption, providers) + API smoke test (own API, in-memory store, locally signed tokens)
npm run test:supabase # the real Supabase project: real tokens, Postgres, RLS, encrypted keys (needs the migration; cleans up)
```

The API smoke test (about 65 checks) covers token verification (wrong key, wrong project, expired), validation, resume upload and rejection of bad files, the free demo and its caps, saving and encrypting provider keys, token contents including agent dispatch, the internal agent endpoints and their auth, idempotent completion, rejoin windows, and cross-user isolation.

**Not yet exercised:** the interface was built and served but not looked at in a browser (layout, spacing and the animated meters have not been reviewed on screen), and no actual live voice conversation has been run. A live conversation needs a LiveKit server and OpenAI/Deepgram keys, which were not available where this was built, so the agent's real-time behaviour (speech pipeline, tool calls mid-conversation, turn detection tuning, the live transcript and meters in the browser) has been type-checked and unit-tested but not run end to end. Expect to spend a short session tuning `endpointing` delays in `apps/agent/src/main.ts` and the prompt wording after your first real interviews.

## Troubleshooting

- **The agent never joins.** Check the worker log shows it registered, that `AGENT_NAME` matches in `.env`, and that `LIVEKIT_URL` and keys are the same for the API and the agent.
- **"Alex" is silent but connected.** Confirm the keys for the providers you picked are set (`OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, or `LIVEKIT_INFERENCE_API_KEY` / `_SECRET` for Inference). The worker log shows provider errors.
- **Browser console shows the proxy failing.** `API_URL` was different when `next build` ran; rebuild with the right value.
- **Mic blocked.** Allow microphone access for the site, then start a new interview from the dashboard (the blocked attempt is already spent).
- **`Could not find the table 'public.…' in the schema cache`.** The migration has not been run on this Supabase project; run `supabase/migrations/0001_init.sql` in the SQL Editor.
- **Signed in but every API call returns 401.** The API verifies the token against `SUPABASE_URL`'s JWKS; check that `SUPABASE_URL` is the same project the browser signs in to.
- **"Saving your own keys is not switched on".** Set `KEY_ENCRYPTION_SECRET` (`openssl rand -base64 32`) and restart the API.
