export type ExperienceLevel = 'intern' | 'junior' | 'mid' | 'senior' | 'lead';

export const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'intern', label: 'Intern' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
];

export type Stage = 'warmup' | 'fundamentals' | 'intermediate' | 'advanced' | 'wrapup';

export const STAGES: { id: Stage; name: string; description: string }[] = [
  { id: 'warmup', name: 'Warm-up', description: 'A short hello and an easy first question.' },
  { id: 'fundamentals', name: 'Fundamentals', description: 'Core concepts for your role, starting simple.' },
  { id: 'intermediate', name: 'Your experience', description: 'Questions about the projects on your resume.' },
  { id: 'advanced', name: 'Advanced', description: 'Open-ended problems that match your level.' },
  { id: 'wrapup', name: 'Wrap-up', description: 'Your questions, then your feedback.' },
];

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Onboarding {
  hasProfile: boolean;
  hasResume: boolean;
  complete: boolean;
}

export interface Profile {
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

export interface ResumeMeta {
  filename: string;
  charCount: number;
  uploadedAt: string | null;
  preview: string;
}

export type InterviewStatus = 'created' | 'in_progress' | 'completed' | 'failed';

export interface Assessment {
  stage: Stage;
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

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface InterviewSummary {
  id: string;
  status: InterviewStatus;
  targetRole: string | null;
  experienceLevel: ExperienceLevel | null;
  createdAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  overallRating: number | null;
}

export interface InterviewDetail extends InterviewSummary {
  maxMinutes: number;
  report: InterviewReport | null;
  transcript: TranscriptTurn[];
  assessments: Assessment[];
}
