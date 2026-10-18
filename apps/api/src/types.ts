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

/** Snapshot of everything the agent needs, captured when the interview is created. */
export interface CandidateContext {
  profile: CandidateProfile;
  resume: { filename: string; text: string };
}

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Unix epoch milliseconds. */
  at: number;
}

export interface Assessment {
  stage: string;
  topic: string;
  question: string;
  /** 1 (poor) to 5 (excellent). */
  rating: number;
  notes: string;
}

export interface InterviewReport {
  overallRating: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

export type InterviewStatus = 'created' | 'in_progress' | 'completed' | 'failed';
