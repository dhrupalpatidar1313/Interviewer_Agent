import { store } from './store/index.js';
import type { CandidateContext } from './types.js';

/** Returns null until both the form and the resume exist. */
export async function buildCandidateContext(userId: string): Promise<CandidateContext | null> {
  const [profile, resume] = await Promise.all([store.getProfile(userId), store.getResume(userId)]);
  if (!profile || !resume) return null;
  return { profile, resume: { filename: resume.filename, text: resume.text } };
}

/** Normalises a database timestamp to ISO-8601 for the browser. Tolerates the older "YYYY-MM-DD HH:MM:SS" form. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
