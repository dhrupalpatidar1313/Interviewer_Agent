import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { toIso } from '../candidate.js';
import { HttpError } from '../http.js';
import { extractResumeText, isAllowedResumeFile, MAX_RESUME_BYTES } from '../resume.js';
import { store } from '../store/index.js';

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

async function resumeMeta(userId: string) {
  const resume = await store.getResume(userId);
  if (!resume) return null;
  return {
    filename: resume.filename,
    charCount: resume.text.length,
    uploadedAt: toIso(resume.uploadedAt),
    preview: resume.text.slice(0, 700),
  };
}

profileRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const [profile, resume] = await Promise.all([store.getProfile(userId), resumeMeta(userId)]);
  res.json({ profile, resume });
});

profileRouter.put('/', async (req, res) => {
  const p = profileSchema.parse(req.body);
  const profile = await store.upsertProfile(req.user!.id, p);
  res.json({ profile });
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

  await store.upsertResume(req.user!.id, { filename, text });
  res.status(201).json({ resume: await resumeMeta(req.user!.id) });
});

profileRouter.delete('/resume', async (req, res) => {
  await store.deleteResume(req.user!.id);
  res.json({ ok: true });
});
