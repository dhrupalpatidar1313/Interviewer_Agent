import { randomUUID } from 'node:crypto';
import type { CandidateProfile } from '../types.js';
import type { EncryptedSecret } from '../crypto.js';
import type {
  CompletionData,
  InterviewFilter,
  InterviewRecord,
  ModelSelection,
  NewInterview,
  ProviderKeyMeta,
  ResumeRecord,
  Store,
  StoredProviderKey,
} from './types.js';

/**
 * In-memory store for tests (STORE_BACKEND=memory). Mirrors SupabaseStore's semantics, including the atomic
 * "first writer wins" operations, so the API's behaviour can be tested without a database.
 * Refused in production by the env check.
 */
export class MemoryStore implements Store {
  private profiles = new Map<string, CandidateProfile>();
  private resumes = new Map<string, ResumeRecord>();
  private interviews = new Map<string, InterviewRecord>();
  private keys = new Map<string, StoredProviderKey>(); // `${userId}:${provider}`
  private selections = new Map<string, ModelSelection>();
  /** Users whose email is NOT confirmed; tests list their ids in MEMORY_UNCONFIRMED_USER_IDS (comma-separated). */
  readonly unconfirmed = new Set((process.env.MEMORY_UNCONFIRMED_USER_IDS ?? '').split(',').filter(Boolean));

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }

  async upsertProfile(userId: string, profile: CandidateProfile) {
    this.profiles.set(userId, { ...profile });
    return { ...profile };
  }

  async getResume(userId: string) {
    return this.resumes.get(userId) ?? null;
  }

  async upsertResume(userId: string, resume: { filename: string; text: string }) {
    const record = { ...resume, uploadedAt: new Date().toISOString() };
    this.resumes.set(userId, record);
    return record;
  }

  async deleteResume(userId: string) {
    this.resumes.delete(userId);
  }

  async createInterview(input: NewInterview) {
    const id = randomUUID();
    const record: InterviewRecord = {
      id,
      userId: input.userId,
      roomName: `interview-${id}`,
      status: 'created',
      mode: input.mode,
      maxMinutes: input.maxMinutes,
      snapshot: input.snapshot,
      providerConfig: input.providerConfig ?? null,
      transcript: null,
      assessments: null,
      report: null,
      endedBy: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date().toISOString(),
      rejoinUntil: null,
      tokenIssuedAt: null,
    };
    this.interviews.set(id, record);
    return { ...record };
  }

  async getInterview(id: string) {
    const row = this.interviews.get(id);
    return row ? { ...row } : null;
  }

  async listInterviews(userId: string, limit: number) {
    return [...this.interviews.values()]
      .filter((i) => i.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((i) => ({ ...i }));
  }

  async markStarted(id: string) {
    const row = this.interviews.get(id);
    if (row?.status === 'created') {
      row.status = 'in_progress';
      row.startedAt = new Date().toISOString();
    }
  }

  async failStale(id: string) {
    const row = this.interviews.get(id);
    if (row?.status === 'in_progress') {
      row.status = 'failed';
      row.endedAt = new Date().toISOString();
      row.endedBy = 'timeout';
      row.rejoinUntil = null;
    }
  }

  async complete(id: string, data: CompletionData) {
    const row = this.interviews.get(id);
    if (!row || (row.status !== 'created' && row.status !== 'in_progress')) return false;
    const now = new Date().toISOString();
    row.status = data.status;
    row.transcript = data.transcript;
    row.assessments = data.assessments;
    row.report = data.report;
    row.endedBy = data.endedBy;
    row.endedAt = now;
    row.startedAt ??= now;
    row.rejoinUntil = null;
    return true;
  }

  async setRejoinUntil(id: string, until: Date | null) {
    const row = this.interviews.get(id);
    if (row?.status === 'in_progress') row.rejoinUntil = until ? until.toISOString() : null;
  }

  async claimToken(id: string, minGapSeconds: number) {
    const row = this.interviews.get(id);
    if (!row) return false;
    const now = Date.now();
    if (row.tokenIssuedAt && Date.parse(row.tokenIssuedAt) >= now - minGapSeconds * 1000) return false;
    row.tokenIssuedAt = new Date(now).toISOString();
    return true;
  }

  async isEmailConfirmed(userId: string) {
    return !this.unconfirmed.has(userId);
  }

  async upsertProviderKey(userId: string, provider: string, key: EncryptedSecret & { last4: string }) {
    this.keys.set(`${userId}:${provider}`, { provider, ...key, validatedAt: new Date().toISOString() });
  }

  async listProviderKeys(userId: string): Promise<ProviderKeyMeta[]> {
    return [...this.keys.entries()]
      .filter(([k]) => k.startsWith(`${userId}:`))
      .map(([, v]) => ({ provider: v.provider, last4: v.last4, validatedAt: v.validatedAt }));
  }

  async getProviderKey(userId: string, provider: string) {
    const key = this.keys.get(`${userId}:${provider}`);
    return key ? { ...key } : null;
  }

  async deleteProviderKey(userId: string, provider: string) {
    this.keys.delete(`${userId}:${provider}`);
  }

  async getSelection(userId: string): Promise<ModelSelection> {
    return this.selections.get(userId) ?? { stt: null, llm: null, tts: null };
  }

  async saveSelection(userId: string, selection: ModelSelection) {
    this.selections.set(userId, structuredClone(selection));
  }

  async countInterviews(filter: InterviewFilter) {
    return [...this.interviews.values()].filter(
      (i) =>
        (!filter.userId || i.userId === filter.userId) &&
        (!filter.mode || i.mode === filter.mode) &&
        (!filter.statuses || filter.statuses.includes(i.status)) &&
        (!filter.createdSince || Date.parse(i.createdAt) >= filter.createdSince.getTime()),
    ).length;
  }
}
