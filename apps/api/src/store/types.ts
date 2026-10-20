import type { EncryptedSecret } from '../crypto.js';
import type {
  Assessment,
  CandidateContext,
  CandidateProfile,
  InterviewReport,
  InterviewStatus,
  TranscriptTurn,
} from '../types.js';

/** 'demo' runs on the platform's own model keys, 'byok' on the candidate's. */
export type InterviewMode = 'demo' | 'byok';

export interface ResumeRecord {
  filename: string;
  text: string;
  uploadedAt: string;
}

export interface InterviewRecord {
  id: string;
  userId: string;
  roomName: string;
  status: InterviewStatus;
  mode: InterviewMode;
  maxMinutes: number;
  snapshot: CandidateContext;
  /** Which providers/models ran this interview. Never contains key material. */
  providerConfig: Record<string, unknown> | null;
  transcript: TranscriptTurn[] | null;
  assessments: Assessment[] | null;
  report: InterviewReport | null;
  endedBy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  /** While in the future, the agent is holding a disconnected candidate's place. */
  rejoinUntil: string | null;
  tokenIssuedAt: string | null;
}

export interface NewInterview {
  userId: string;
  snapshot: CandidateContext;
  mode: InterviewMode;
  maxMinutes: number;
  providerConfig?: Record<string, unknown> | null;
}

export interface CompletionData {
  status: 'completed' | 'failed';
  endedBy: string;
  transcript: TranscriptTurn[];
  assessments: Assessment[];
  report: InterviewReport | null;
}

/** A stored provider key without the secret: all that is ever shown back to the person. */
export interface ProviderKeyMeta {
  provider: string;
  last4: string;
  validatedAt: string;
}

/** The encrypted key, only ever read server-side when an interview starts. */
export type StoredProviderKey = ProviderKeyMeta & EncryptedSecret;

/** The provider, model and (TTS) voice chosen for one stage. */
export interface StageSelection {
  provider: string;
  model: string;
  voice?: string;
}

export interface ModelSelection {
  stt: StageSelection | null;
  llm: StageSelection | null;
  tts: StageSelection | null;
}

export interface InterviewFilter {
  userId?: string;
  mode?: InterviewMode;
  statuses?: InterviewStatus[];
  createdSince?: Date;
}

/** Everything the API persists. Implemented over Supabase (production) and in memory (tests). */
export interface Store {
  getProfile(userId: string): Promise<CandidateProfile | null>;
  upsertProfile(userId: string, profile: CandidateProfile): Promise<CandidateProfile>;

  getResume(userId: string): Promise<ResumeRecord | null>;
  upsertResume(userId: string, resume: { filename: string; text: string }): Promise<ResumeRecord>;
  deleteResume(userId: string): Promise<void>;

  createInterview(input: NewInterview): Promise<InterviewRecord>;
  getInterview(id: string): Promise<InterviewRecord | null>;
  listInterviews(userId: string, limit: number): Promise<InterviewRecord[]>;

  /** created -> in_progress. No-op in any other state. */
  markStarted(id: string): Promise<void>;
  /** Marks an interview that never reported back as failed. Only touches in_progress rows. */
  failStale(id: string): Promise<void>;
  /** Atomic: only the first report for an open interview wins. Returns false if it was already finalised. */
  complete(id: string, data: CompletionData): Promise<boolean>;
  /** Only applies while the interview is in_progress. */
  setRejoinUntil(id: string, until: Date | null): Promise<void>;
  /** Atomic: true if a token may be issued now, and records the time. False inside the minimum gap. */
  claimToken(id: string, minGapSeconds: number): Promise<boolean>;

  /** Whether the account's email address has been confirmed (the demo is gated on it). */
  isEmailConfirmed(userId: string): Promise<boolean>;

  upsertProviderKey(userId: string, provider: string, key: EncryptedSecret & { last4: string }): Promise<void>;
  listProviderKeys(userId: string): Promise<ProviderKeyMeta[]>;
  getProviderKey(userId: string, provider: string): Promise<StoredProviderKey | null>;
  deleteProviderKey(userId: string, provider: string): Promise<void>;

  getSelection(userId: string): Promise<ModelSelection>;
  saveSelection(userId: string, selection: ModelSelection): Promise<void>;

  /** Counts interviews matching every given filter; used for the demo allowance and daily caps. */
  countInterviews(filter: InterviewFilter): Promise<number>;
}
