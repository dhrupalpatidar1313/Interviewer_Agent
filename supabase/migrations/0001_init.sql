-- Voice Interviewer: initial schema.
--
-- Apply once per Supabase project: Dashboard -> SQL Editor -> paste this file -> Run.
-- (Or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.)
--
-- Accounts live in Supabase Auth (auth.users). Every table here hangs off auth.users(id) and is deleted with
-- the user. The API reads and writes with the server-side secret key, which bypasses Row Level Security, so RLS is
-- enabled with NO policies: the publishable/anon key and signed-in browsers can read and write nothing here.

create table if not exists public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null,
  target_role      text not null,
  experience_level text not null check (experience_level in ('intern', 'junior', 'mid', 'senior', 'lead')),
  years_experience integer not null check (years_experience between 0 and 50),
  skills           jsonb not null default '[]'::jsonb,
  focus_areas      jsonb not null default '[]'::jsonb,
  linkedin_url     text not null default '',
  github_url       text not null default '',
  about            text not null default '',
  updated_at       timestamptz not null default now()
);

create table if not exists public.resumes (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  filename    text not null,
  text        text not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.interviews (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  room_name       text not null unique,
  status          text not null default 'created' check (status in ('created', 'in_progress', 'completed', 'failed')),
  -- 'demo' runs on the platform's own model keys, 'byok' on the candidate's keys.
  mode            text not null default 'byok' check (mode in ('demo', 'byok')),
  max_minutes     integer not null default 25 check (max_minutes between 3 and 90),
  snapshot        jsonb not null,         -- CandidateContext captured when the interview was created
  provider_config jsonb,                  -- which providers/models were used; never any key material
  transcript      jsonb,
  assessments     jsonb,
  report          jsonb,
  ended_by        text,
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  -- The agent sets this while it holds a disconnected candidate's place; the API allows a rejoin until then.
  rejoin_until    timestamptz,
  -- Last time a join token was issued; stops two tabs racing for the same interview.
  token_issued_at timestamptz
);
create index if not exists idx_interviews_user on public.interviews (user_id, created_at desc);
create index if not exists idx_interviews_mode_started on public.interviews (mode, started_at);

-- Candidate-supplied provider API keys, encrypted by the API (AES-256-GCM) before they reach the database.
create table if not exists public.user_provider_keys (
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     text not null,
  ciphertext   text not null,
  iv           text not null,
  tag          text not null,
  last4        text not null,
  validated_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  primary key (user_id, provider)
);

-- Which provider/model/voice the candidate chose for each stage of their own (non-demo) interviews.
create table if not exists public.user_model_selection (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  stt_provider text,
  stt_model    text,
  llm_provider text,
  llm_model    text,
  tts_provider text,
  tts_model    text,
  tts_voice    text,
  updated_at   timestamptz not null default now()
);

alter table public.profiles             enable row level security;
alter table public.resumes              enable row level security;
alter table public.interviews           enable row level security;
alter table public.user_provider_keys   enable row level security;
alter table public.user_model_selection enable row level security;

-- Belt and braces: even without policies, take away the table privileges the browser-facing roles get by default.
revoke all on public.profiles             from anon, authenticated;
revoke all on public.resumes              from anon, authenticated;
revoke all on public.interviews           from anon, authenticated;
revoke all on public.user_provider_keys   from anon, authenticated;
revoke all on public.user_model_selection from anon, authenticated;
