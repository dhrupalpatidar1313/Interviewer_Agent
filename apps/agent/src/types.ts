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

export interface InterviewContext {
  interviewId: string;
  userId: string;
  participantIdentity: string;
  status: string;
  maxMinutes: number;
  candidate: CandidateContext | null;
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
