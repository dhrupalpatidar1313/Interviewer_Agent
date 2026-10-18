import { one, parseJson } from './db.js';
import type { CandidateContext, CandidateProfile, ExperienceLevel } from './types.js';

interface ProfileRow {
  full_name: string;
  target_role: string;
  experience_level: string;
  years_experience: number;
  skills: string;
  focus_areas: string;
  linkedin_url: string;
  github_url: string;
  about: string;
  updated_at: string;
}

interface ResumeRow {
  filename: string;
  text: string;
  uploaded_at: string;
}

export function loadProfile(userId: string): CandidateProfile | undefined {
  const row = one<ProfileRow>(
    `SELECT full_name, target_role, experience_level, years_experience, skills, focus_areas,
            linkedin_url, github_url, about, updated_at
       FROM profiles WHERE user_id = ?`,
    userId,
  );
  if (!row) return undefined;
  return {
    fullName: row.full_name,
    targetRole: row.target_role,
    experienceLevel: row.experience_level as ExperienceLevel,
    yearsExperience: row.years_experience,
    skills: parseJson<string[]>(row.skills, []),
    focusAreas: parseJson<string[]>(row.focus_areas, []),
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    about: row.about,
  };
}

export function loadResume(userId: string): ResumeRow | undefined {
  return one<ResumeRow>('SELECT filename, text, uploaded_at FROM resumes WHERE user_id = ?', userId);
}

/** Returns null until both the form and the resume exist. */
export function buildCandidateContext(userId: string): CandidateContext | null {
  const profile = loadProfile(userId);
  const resume = loadResume(userId);
  if (!profile || !resume) return null;
  return { profile, resume: { filename: resume.filename, text: resume.text } };
}

/** SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; normalise to ISO-8601 for the browser. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
}
