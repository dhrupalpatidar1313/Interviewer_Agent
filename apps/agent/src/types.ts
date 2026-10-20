// Mirrors the shapes served by the API's /internal endpoints (apps/api/src/types.ts).

export type ExperienceLevel = 'intern' | 'junior' | 'mid' | 'senior' | 'lead';

export interface CandidateProfile {
  fullName: string;
  targetRole: string;
  experienceLevel: ExperienceLevel;
  yearsExperience: number;
  skills: string[];
  focusAreas: string[];
  linkedinUrl: string;
  githubUrl: string;
  about: string;
}

export interface CandidateContext {
  profile: CandidateProfile;
  resume: { filename: string; text: string };
}

export type InterviewMode = 'demo' | 'byok';
export type ModelStage = 'stt' | 'llm' | 'tts';

/** One stage of a candidate's own models. The key is only ever held in memory for the length of the job. */
export interface UserStageModel {
  provider: string;
  model: string;
  /** TTS only: a voice name or id. */
  voice?: string;
  apiKey: string;
}
export type UserModels = Record<ModelStage, UserStageModel>;

export interface InterviewContext {
  interviewId: string;
  userId: string;
  participantIdentity: string;
  status: string;
  /** 'demo' runs on the platform's own models; 'byok' on `models`. */
  mode: InterviewMode;
  maxMinutes: number;
  candidate: CandidateContext | null;
  /** Present for byok interviews only. */
  models: UserModels | null;
}

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface Assessment {
  stage: string;
  topic: string;
  question: string;
  rating: number;
  notes: string;
}

export interface InterviewReport {
  overallRating: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

export interface CompletionPayload {
  endedBy: string;
  failed: boolean;
  transcript: TranscriptTurn[];
  assessments: Assessment[];
  report: InterviewReport | null;
}
