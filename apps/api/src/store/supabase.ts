import { createAdminClient } from '@supabase/server/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assessment, CandidateProfile, ExperienceLevel, InterviewReport, TranscriptTurn } from '../types.js';
import type { EncryptedSecret } from '../crypto.js';
import type {
  CompletionData,
  InterviewFilter,
  InterviewMode,
  InterviewRecord,
  ModelSelection,
  NewInterview,
  ProviderKeyMeta,
  ResumeRecord,
  StageSelection,
  Store,
  StoredProviderKey,
} from './types.js';
import { randomUUID } from 'node:crypto';

/** Database rows as PostgREST returns them (snake_case, jsonb already parsed). */
interface ProfileRow {
  user_id: string;
  full_name: string;
  target_role: string;
  experience_level: ExperienceLevel;
  years_experience: number;
  skills: string[];
  focus_areas: string[];
  linkedin_url: string;
  github_url: string;
  about: string;
}

interface ResumeRow {
  filename: string;
  text: string;
  uploaded_at: string;
}

interface InterviewRow {
  id: string;
  user_id: string;
  room_name: string;
  status: InterviewRecord['status'];
  mode: InterviewMode;
  max_minutes: number;
  snapshot: InterviewRecord['snapshot'];
  provider_config: Record<string, unknown> | null;
  transcript: TranscriptTurn[] | null;
  assessments: Assessment[] | null;
  report: InterviewReport | null;
  ended_by: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  rejoin_until: string | null;
  token_issued_at: string | null;
}

interface KeyRow {
  provider: string;
  ciphertext: string;
  iv: string;
  tag: string;
  last4: string;
  validated_at: string;
}

interface SelectionRow {
  stt_provider: string | null;
  stt_model: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  tts_provider: string | null;
  tts_model: string | null;
  tts_voice: string | null;
}

function fail(action: string, error: { message: string; code?: string }): never {
  // Keep the database's wording out of the message the browser sees; the handler logs the original.
  // PGRST205 = the table is not in the schema: the migration has not been run on this Supabase project.
  const hint =
    error.code === 'PGRST205'
      ? ' -> The database tables are missing. Run supabase/migrations/0001_init.sql in the Supabase SQL Editor.'
      : '';
  throw new Error(`Database error while ${action}: ${error.message}${error.code ? ` (${error.code})` : ''}${hint}`);
}

function toProfile(row: ProfileRow): CandidateProfile {
  return {
    fullName: row.full_name,
    targetRole: row.target_role,
    experienceLevel: row.experience_level,
    yearsExperience: row.years_experience,
    skills: row.skills ?? [],
    focusAreas: row.focus_areas ?? [],
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    about: row.about,
  };
}

function toInterview(row: InterviewRow): InterviewRecord {
  return {
    id: row.id,
    userId: row.user_id,
    roomName: row.room_name,
    status: row.status,
    mode: row.mode,
    maxMinutes: row.max_minutes,
    snapshot: row.snapshot,
    providerConfig: row.provider_config,
    transcript: row.transcript,
    assessments: row.assessments,
    report: row.report,
    endedBy: row.ended_by,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    rejoinUntil: row.rejoin_until,
    tokenIssuedAt: row.token_issued_at,
  };
}

/** Production store: Supabase Postgres through PostgREST, using the server-side secret key (bypasses RLS). */
export class SupabaseStore implements Store {
  private client: SupabaseClient | null = null;

  /** Created lazily so importing the module never needs credentials. */
  private get db(): SupabaseClient {
    this.client ??= createAdminClient() as unknown as SupabaseClient;
    return this.client;
  }

  async getProfile(userId: string): Promise<CandidateProfile | null> {
    const { data, error } = await this.db.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error) fail('loading the profile', error);
    return data ? toProfile(data as ProfileRow) : null;
  }

  async upsertProfile(userId: string, p: CandidateProfile): Promise<CandidateProfile> {
    const { data, error } = await this.db
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          full_name: p.fullName,
          target_role: p.targetRole,
          experience_level: p.experienceLevel,
          years_experience: p.yearsExperience,
          skills: p.skills,
          focus_areas: p.focusAreas,
          linkedin_url: p.linkedinUrl,
          github_url: p.githubUrl,
          about: p.about,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) fail('saving the profile', error);
    return toProfile(data as ProfileRow);
  }

  async getResume(userId: string): Promise<ResumeRecord | null> {
    const { data, error } = await this.db
      .from('resumes')
      .select('filename, text, uploaded_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) fail('loading the resume', error);
    if (!data) return null;
    const row = data as ResumeRow;
    return { filename: row.filename, text: row.text, uploadedAt: row.uploaded_at };
  }

  async upsertResume(userId: string, resume: { filename: string; text: string }): Promise<ResumeRecord> {
    const { data, error } = await this.db
      .from('resumes')
      .upsert(
        { user_id: userId, filename: resume.filename, text: resume.text, uploaded_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select('filename, text, uploaded_at')
      .single();
    if (error) fail('saving the resume', error);
    const row = data as ResumeRow;
    return { filename: row.filename, text: row.text, uploadedAt: row.uploaded_at };
  }

  async deleteResume(userId: string): Promise<void> {
    const { error } = await this.db.from('resumes').delete().eq('user_id', userId);
    if (error) fail('deleting the resume', error);
  }

  async createInterview(input: NewInterview): Promise<InterviewRecord> {
    const id = randomUUID();
    const { data, error } = await this.db
      .from('interviews')
      .insert({
        id,
        user_id: input.userId,
        room_name: `interview-${id}`,
        snapshot: input.snapshot,
        mode: input.mode,
        max_minutes: input.maxMinutes,
        provider_config: input.providerConfig ?? null,
      })
      .select('*')
      .single();
    if (error) fail('creating the interview', error);
    return toInterview(data as InterviewRow);
  }

  async getInterview(id: string): Promise<InterviewRecord | null> {
    const { data, error } = await this.db.from('interviews').select('*').eq('id', id).maybeSingle();
    if (error) fail('loading the interview', error);
    return data ? toInterview(data as InterviewRow) : null;
  }

  async listInterviews(userId: string, limit: number): Promise<InterviewRecord[]> {
    const { data, error } = await this.db
      .from('interviews')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail('listing interviews', error);
    return (data as InterviewRow[]).map(toInterview);
  }

  async markStarted(id: string): Promise<void> {
    const { error } = await this.db
      .from('interviews')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'created');
    if (error) fail('marking the interview started', error);
  }

  async failStale(id: string): Promise<void> {
    const { error } = await this.db
      .from('interviews')
      .update({ status: 'failed', ended_at: new Date().toISOString(), ended_by: 'timeout', rejoin_until: null })
      .eq('id', id)
      .eq('status', 'in_progress');
    if (error) fail('closing a stale interview', error);
  }

  async complete(id: string, data: CompletionData): Promise<boolean> {
    const now = new Date().toISOString();
    // started_at is only filled when the agent never got to mark the start.
    const { data: rows, error } = await this.db
      .from('interviews')
      .update({
        status: data.status,
        transcript: data.transcript,
        assessments: data.assessments,
        report: data.report,
        ended_by: data.endedBy,
        ended_at: now,
        rejoin_until: null,
      })
      .eq('id', id)
      .in('status', ['created', 'in_progress'])
      .select('id, started_at');
    if (error) fail('saving the interview results', error);
    const updated = rows?.[0] as { id: string; started_at: string | null } | undefined;
    if (!updated) return false;
    if (!updated.started_at) {
      await this.db.from('interviews').update({ started_at: now }).eq('id', id).is('started_at', null);
    }
    return true;
  }

  async setRejoinUntil(id: string, until: Date | null): Promise<void> {
    const { error } = await this.db
      .from('interviews')
      .update({ rejoin_until: until ? until.toISOString() : null })
      .eq('id', id)
      .eq('status', 'in_progress');
    if (error) fail('updating the rejoin window', error);
  }

  async claimToken(id: string, minGapSeconds: number): Promise<boolean> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - minGapSeconds * 1000).toISOString();
    const { data, error } = await this.db
      .from('interviews')
      .update({ token_issued_at: now.toISOString() })
      .eq('id', id)
      .or(`token_issued_at.is.null,token_issued_at.lt.${cutoff}`)
      .select('id');
    if (error) fail('issuing a join token', error);
    return (data?.length ?? 0) > 0;
  }

  async isEmailConfirmed(userId: string): Promise<boolean> {
    const { data, error } = await this.db.auth.admin.getUserById(userId);
    if (error || !data.user) return false;
    return !!data.user.email_confirmed_at;
  }

  async upsertProviderKey(userId: string, provider: string, key: EncryptedSecret & { last4: string }): Promise<void> {
    const { error } = await this.db.from('user_provider_keys').upsert(
      {
        user_id: userId,
        provider,
        ciphertext: key.ciphertext,
        iv: key.iv,
        tag: key.tag,
        last4: key.last4,
        validated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );
    if (error) fail('saving a provider key', error);
  }

  async listProviderKeys(userId: string): Promise<ProviderKeyMeta[]> {
    // Selects only the non-secret columns: the ciphertext never leaves the database for a listing.
    const { data, error } = await this.db
      .from('user_provider_keys')
      .select('provider, last4, validated_at')
      .eq('user_id', userId);
    if (error) fail('listing provider keys', error);
    return (data as Pick<KeyRow, 'provider' | 'last4' | 'validated_at'>[]).map((r) => ({
      provider: r.provider,
      last4: r.last4,
      validatedAt: r.validated_at,
    }));
  }

  async getProviderKey(userId: string, provider: string): Promise<StoredProviderKey | null> {
    const { data, error } = await this.db
      .from('user_provider_keys')
      .select('provider, ciphertext, iv, tag, last4, validated_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (error) fail('loading a provider key', error);
    if (!data) return null;
    const r = data as KeyRow;
    return { provider: r.provider, ciphertext: r.ciphertext, iv: r.iv, tag: r.tag, last4: r.last4, validatedAt: r.validated_at };
  }

  async deleteProviderKey(userId: string, provider: string): Promise<void> {
    const { error } = await this.db.from('user_provider_keys').delete().eq('user_id', userId).eq('provider', provider);
    if (error) fail('deleting a provider key', error);
  }

  async getSelection(userId: string): Promise<ModelSelection> {
    const { data, error } = await this.db.from('user_model_selection').select('*').eq('user_id', userId).maybeSingle();
    if (error) fail('loading the model selection', error);
    const r = data as SelectionRow | null;
    const stage = (provider: string | null, model: string | null, voice?: string | null): StageSelection | null =>
      provider && model ? { provider, model, ...(voice ? { voice } : {}) } : null;
    return {
      stt: stage(r?.stt_provider ?? null, r?.stt_model ?? null),
      llm: stage(r?.llm_provider ?? null, r?.llm_model ?? null),
      tts: stage(r?.tts_provider ?? null, r?.tts_model ?? null, r?.tts_voice),
    };
  }

  async saveSelection(userId: string, s: ModelSelection): Promise<void> {
    const { error } = await this.db.from('user_model_selection').upsert(
      {
        user_id: userId,
        stt_provider: s.stt?.provider ?? null,
        stt_model: s.stt?.model ?? null,
        llm_provider: s.llm?.provider ?? null,
        llm_model: s.llm?.model ?? null,
        tts_provider: s.tts?.provider ?? null,
        tts_model: s.tts?.model ?? null,
        tts_voice: s.tts?.voice ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) fail('saving the model selection', error);
  }

  async countInterviews(filter: InterviewFilter): Promise<number> {
    let query = this.db.from('interviews').select('id', { count: 'exact', head: true });
    if (filter.userId) query = query.eq('user_id', filter.userId);
    if (filter.mode) query = query.eq('mode', filter.mode);
    if (filter.statuses) query = query.in('status', filter.statuses);
    if (filter.createdSince) query = query.gte('created_at', filter.createdSince.toISOString());
    const { count, error } = await query;
    if (error) fail('counting interviews', error);
    return count ?? 0;
  }
}
