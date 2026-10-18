import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { loadProfile, loadResume, toIso } from '../candidate.js';
import { run } from '../db.js';
import { HttpError } from '../http.js';
import { extractResumeText, isAllowedResumeFile, MAX_RESUME_BYTES } from '../resume.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

const optionalUrl = z
  .union([z.url({ protocol: /^https?$/, error: 'Enter a full URL starting with https://' }).max(300), z.literal('')])
  .default('');

function cleanList(max: number, itemMax: number) {
  return z
    .array(z.string().trim().min(1).max(itemMax))
    .max(max)
    .transform((items) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
}

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(100),
  targetRole: z.string().trim().min(2, 'Target role is required').max(120),
  experienceLevel: z.enum(['intern', 'junior', 'mid', 'senior', 'lead']),
  yearsExperience: z.number().int().min(0).max(50),
  skills: cleanList(30, 50).refine((s) => s.length >= 1, 'Add at least one skill'),
  focusAreas: cleanList(10, 60).default([]),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  about: z.string().trim().max(1500).default(''),
});

function resumeMeta(userId: string) {
  const resume = loadResume(userId);
  if (!resume) return null;
  return {
    filename: resume.filename,
    charCount: resume.text.length,
    uploadedAt: toIso(resume.uploaded_at),
    preview: resume.text.slice(0, 700),
  };
}

profileRouter.get('/', (req, res) => {
  const userId = req.user!.id;
  res.json({ profile: loadProfile(userId) ?? null, resume: resumeMeta(userId) });
});

profileRouter.put('/', (req, res) => {
  const p = profileSchema.parse(req.body);
  run(
    `INSERT INTO profiles
       (user_id, full_name, target_role, experience_level, years_experience, skills, focus_areas,
        linkedin_url, github_url, about, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       full_name = excluded.full_name,
       target_role = excluded.target_role,
       experience_level = excluded.experience_level,
       years_experience = excluded.years_experience,
       skills = excluded.skills,
       focus_areas = excluded.focus_areas,
       linkedin_url = excluded.linkedin_url,
       github_url = excluded.github_url,
       about = excluded.about,
       updated_at = datetime('now')`,
    req.user!.id,
    p.fullName,
    p.targetRole,
    p.experienceLevel,
    p.yearsExperience,
    JSON.stringify(p.skills),
    JSON.stringify(p.focusAreas),
    p.linkedinUrl,
    p.githubUrl,
    p.about,
  );
  res.json({ profile: loadProfile(req.user!.id) });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESUME_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!isAllowedResumeFile(file.originalname)) {
      cb(new HttpError(415, 'Unsupported file type. Upload a PDF, DOCX or TXT file.'));
      return;
    }
    cb(null, true);
  },
});

profileRouter.post('/resume', upload.single('resume'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose a resume file to upload.');

  const text = await extractResumeText(file.buffer, file.originalname);
  // multer decodes the filename as latin1; restore UTF-8 names.
  const filename = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);

  run(
    `INSERT INTO resumes (user_id, filename, text, uploaded_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET filename = excluded.filename, text = excluded.text, uploaded_at = datetime('now')`,
    req.user!.id,
    filename,
    text,
  );
  res.status(201).json({ resume: resumeMeta(req.user!.id) });
});

profileRouter.delete('/resume', (req, res) => {
  run('DELETE FROM resumes WHERE user_id = ?', req.user!.id);
  res.json({ ok: true });
});
