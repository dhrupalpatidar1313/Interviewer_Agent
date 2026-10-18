'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { RequireAuth, Shell } from '@/components/Shell';
import { ResumeDrop } from '@/components/ResumeDrop';
import { TagInput } from '@/components/TagInput';
import { api, ApiError, errorMessage, type FieldIssue } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EXPERIENCE_LEVELS, type ExperienceLevel, type Profile, type ResumeMeta } from '@/lib/types';

const FOCUS_SUGGESTIONS = [
  'Behavioral questions',
  'Problem solving',
  'Communication',
  'Leadership',
  'System design',
  'Technical depth',
];

interface FormState {
  fullName: string;
  targetRole: string;
  experienceLevel: ExperienceLevel;
  yearsExperience: string;
  skills: string[];
  focusAreas: string[];
  linkedinUrl: string;
  githubUrl: string;
  about: string;
}

function OnboardingForm() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState<FormState>({
    fullName: user?.name ?? '',
    targetRole: '',
    experienceLevel: 'mid',
    yearsExperience: '',
    skills: [],
    focusAreas: [],
    linkedinUrl: '',
    githubUrl: '',
    about: '',
  });
  const [resume, setResume] = useState<ResumeMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ profile: Profile | null; resume: ResumeMeta | null }>('/profile')
      .then((data) => {
        if (cancelled) return;
        setResume(data.resume);
        if (data.profile) {
          const p = data.profile;
          setForm({
            fullName: p.fullName,
            targetRole: p.targetRole,
            experienceLevel: p.experienceLevel,
            yearsExperience: String(p.yearsExperience),
            skills: p.skills,
            focusAreas: p.focusAreas,
            linkedinUrl: p.linkedinUrl,
            githubUrl: p.githubUrl,
            about: p.about,
          });
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fieldError = (name: string) => issues.find((i) => i.path === name)?.message;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues([]);

    if (!resume) {
      setError('Upload your resume first, so the interviewer can read it.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const years = Number(form.yearsExperience);
    if (form.yearsExperience.trim() === '' || !Number.isInteger(years) || years < 0 || years > 50) {
      setIssues([{ path: 'yearsExperience', message: 'Enter whole years, from 0 to 50.' }]);
      return;
    }

    setBusy(true);
    try {
      await api('/profile', {
        method: 'PUT',
        body: { ...form, yearsExperience: years, fullName: form.fullName.trim(), targetRole: form.targetRole.trim() },
      });
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setIssues(err.issues);
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="container page">
        <p className="muted" role="status">
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div className="container container--narrow page">
      <form className="stack stack--xl" onSubmit={onSubmit} noValidate>
        <header className="stack">
          <h1 className="h1">Tell us about you</h1>
          <p className="lede">The interviewer reads your resume and these answers before it starts, so the questions fit you.</p>
        </header>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <section className="stack" aria-labelledby="resume-heading">
          <h2 className="h2" id="resume-heading">
            Your resume
          </h2>
          <ResumeDrop resume={resume} onChange={setResume} />
        </section>

        <section className="stack stack--lg" aria-labelledby="about-heading">
          <h2 className="h2" id="about-heading">
            The basics
          </h2>

          <div className="form-grid form-grid--2">
            <div className="field">
              <label className="field__label" htmlFor="fullName">
                Full name
              </label>
              <input
                id="fullName"
                className="input"
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                autoComplete="name"
                aria-invalid={fieldError('fullName') ? true : undefined}
                required
              />
              {fieldError('fullName') && <p className="field__error">{fieldError('fullName')}</p>}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="targetRole">
                Role you are interviewing for
              </label>
              <input
                id="targetRole"
                className="input"
                value={form.targetRole}
                onChange={(e) => set('targetRole', e.target.value)}
                placeholder="Senior backend engineer"
                aria-invalid={fieldError('targetRole') ? true : undefined}
                required
              />
              {fieldError('targetRole') && <p className="field__error">{fieldError('targetRole')}</p>}
            </div>
          </div>

          <div className="form-grid form-grid--2">
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="field__label" style={{ padding: 0, marginBottom: '0.4rem' }}>
                Experience level
              </legend>
              <div className="segments">
                {EXPERIENCE_LEVELS.map((level) => (
                  <div className="segments__item" key={level.value}>
                    <input
                      className="segments__input"
                      type="radio"
                      name="experienceLevel"
                      id={`level-${level.value}`}
                      value={level.value}
                      checked={form.experienceLevel === level.value}
                      onChange={() => set('experienceLevel', level.value)}
                    />
                    <label className="segments__label" htmlFor={`level-${level.value}`}>
                      {level.label}
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="field">
              <label className="field__label" htmlFor="yearsExperience">
                Years of experience
              </label>
              <input
                id="yearsExperience"
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={50}
                value={form.yearsExperience}
                onChange={(e) => set('yearsExperience', e.target.value)}
                aria-invalid={fieldError('yearsExperience') ? true : undefined}
                required
              />
              {fieldError('yearsExperience') && <p className="field__error">{fieldError('yearsExperience')}</p>}
            </div>
          </div>

          <TagInput
            id="skills"
            label="Skills"
            hint="Type a skill and press Enter. The interviewer starts with the ones you list."
            value={form.skills}
            onChange={(v) => set('skills', v)}
            placeholder="TypeScript, PostgreSQL, stakeholder management"
            max={30}
            error={fieldError('skills')}
          />

          <TagInput
            id="focusAreas"
            label="Anything you want extra practice on? (optional)"
            value={form.focusAreas}
            onChange={(v) => set('focusAreas', v)}
            suggestions={FOCUS_SUGGESTIONS}
            max={10}
            placeholder="Press Enter after each one"
          />

          <div className="form-grid form-grid--2">
            <div className="field">
              <label className="field__label" htmlFor="linkedinUrl">
                LinkedIn (optional)
              </label>
              <input
                id="linkedinUrl"
                className="input"
                type="url"
                value={form.linkedinUrl}
                onChange={(e) => set('linkedinUrl', e.target.value)}
                placeholder="https://linkedin.com/in/…"
                aria-invalid={fieldError('linkedinUrl') ? true : undefined}
              />
              {fieldError('linkedinUrl') && <p className="field__error">{fieldError('linkedinUrl')}</p>}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="githubUrl">
                GitHub or portfolio (optional)
              </label>
              <input
                id="githubUrl"
                className="input"
                type="url"
                value={form.githubUrl}
                onChange={(e) => set('githubUrl', e.target.value)}
                placeholder="https://github.com/…"
                aria-invalid={fieldError('githubUrl') ? true : undefined}
              />
              {fieldError('githubUrl') && <p className="field__error">{fieldError('githubUrl')}</p>}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="about">
              Anything else the interviewer should know? (optional)
            </label>
            <textarea
              id="about"
              className="textarea"
              value={form.about}
              onChange={(e) => set('about', e.target.value)}
              maxLength={1500}
              aria-describedby="about-count"
            />
            <p className="field__hint" id="about-count">
              {form.about.length} of 1,500 characters
            </p>
          </div>
        </section>

        <div className="row">
          <button className="btn btn--lg" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Shell>
      <RequireAuth>
        <OnboardingForm />
      </RequireAuth>
    </Shell>
  );
}
