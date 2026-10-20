'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RatingMeter } from '@/components/RatingMeter';
import { RequireAuth, Shell } from '@/components/Shell';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { endedByLabel, formatDateTime } from '@/lib/format';
import {
  EXPERIENCE_LEVELS,
  type EntitlementInfo,
  type InterviewDetail,
  type InterviewSummary,
  type Profile,
  type ProvidersResponse,
  type ResumeMeta,
} from '@/lib/types';

function statusView(i: InterviewSummary): { label: string; tone: 'ok' | 'bad' | 'neutral'; action: string } {
  switch (i.status) {
    case 'completed':
      return { label: endedByLabel(i.endedBy), tone: 'ok', action: 'View feedback' };
    case 'failed':
      return { label: 'Did not run', tone: 'bad', action: 'View details' };
    case 'in_progress':
      return i.canRejoin
        ? { label: 'Disconnected, you can rejoin', tone: 'neutral', action: 'Rejoin' }
        : { label: 'In progress', tone: 'neutral', action: 'Open' };
    default:
      return { label: 'Not started', tone: 'neutral', action: 'Open' };
  }
}

function DashboardContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resume, setResume] = useState<ResumeMeta | null>(null);
  const [interviews, setInterviews] = useState<InterviewSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null);
  // Set when starting was refused for a reason Settings can fix (no keys, demo used up, demo at capacity).
  const [needsKeys, setNeedsKeys] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ profile: Profile | null; resume: ResumeMeta | null }>('/profile'),
      api<{ interviews: InterviewSummary[] }>('/interviews'),
      // Not essential: if this fails the dashboard still works and starting reports any problem itself.
      api<ProvidersResponse>('/providers').catch(() => null),
    ])
      .then(([p, i, providers]) => {
        if (cancelled) return;
        setProfile(p.profile);
        setResume(p.resume);
        setInterviews(i.interviews);
        setEntitlement(providers?.entitlement ?? null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const data = await api<{ interview: InterviewDetail }>('/interviews', { method: 'POST', body: {} });
      router.push(`/interview/${data.interview.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setNeedsKeys(err instanceof ApiError && (err.code === 'PROVIDER_KEYS_REQUIRED' || err.code === 'DEMO_CAPACITY'));
      setStarting(false);
    }
  }

  const blocked = entitlement?.kind === 'blocked';

  const firstName = (profile?.fullName ?? user?.name ?? '').trim().split(/\s+/)[0];
  const level = EXPERIENCE_LEVELS.find((l) => l.value === profile?.experienceLevel)?.label;

  return (
    <div className="container page">
      <div className="stack stack--xl">
        <header className="stack">
          <h1 className="h1">{firstName ? `Hi, ${firstName}` : 'Your dashboard'}</h1>
          <p className="lede">Find a quiet spot, put on headphones if you can, and start when you are ready.</p>
        </header>

        {error && (
          <div className="alert" role="alert">
            <p>{error}</p>
            {needsKeys && (
              <p style={{ marginTop: '0.5rem' }}>
                <Link href="/settings">Add your API keys</Link>
              </p>
            )}
          </div>
        )}

        {!loaded ? (
          <p className="muted" role="status">
            Loading…
          </p>
        ) : (
          <>
            <section className="stack stack--lg" aria-labelledby="next-heading">
              <h2 className="h2" id="next-heading">
                Your next interview
              </h2>
              {profile && (
                <dl className="facts">
                  <dt>Role</dt>
                  <dd>{profile.targetRole}</dd>
                  <dt>Level</dt>
                  <dd>
                    {level}, {profile.yearsExperience} {profile.yearsExperience === 1 ? 'year' : 'years'}
                  </dd>
                  <dt>Skills</dt>
                  <dd>{profile.skills.join(', ')}</dd>
                  {profile.focusAreas.length > 0 && (
                    <>
                      <dt>Extra focus</dt>
                      <dd>{profile.focusAreas.join(', ')}</dd>
                    </>
                  )}
                  <dt>Resume</dt>
                  <dd>{resume ? resume.filename : 'Not uploaded'}</dd>
                </dl>
              )}
              {entitlement?.kind === 'demo' && (
                <div className="notice" role="note">
                  <p>
                    Your first interview is a free {entitlement.maxMinutes}-minute demo on our models, covering the
                    basics and a look at your resume. To keep practising with full-length interviews and harder
                    questions, add your own API keys in <Link href="/settings">Settings</Link>.
                  </p>
                  <p className="small" style={{ marginTop: '0.5rem' }}>
                    Your voice and resume text are processed by third-party AI providers to run the interview. The demo
                    may use providers whose free tiers allow them to improve their products with that content.
                  </p>
                </div>
              )}
              {blocked && (
                <div className="notice" role="note">
                  <p>{entitlement.message}</p>
                </div>
              )}
              <div className="row">
                {blocked ? (
                  <Link className="btn btn--lg" href="/settings">
                    Add your API keys
                  </Link>
                ) : (
                  <button className="btn btn--lg" type="button" onClick={start} disabled={starting}>
                    {starting ? 'Setting up…' : 'Start an interview'}
                  </button>
                )}
                <Link className="btn btn--lg btn--secondary" href="/onboarding">
                  Edit profile and resume
                </Link>
              </div>
            </section>

            <section className="stack" aria-labelledby="past-heading">
              <h2 className="h2" id="past-heading">
                Past interviews
              </h2>
              {interviews.length === 0 ? (
                <p className="muted">Your feedback will show up here after your first interview.</p>
              ) : (
                <ul className="runs">
                  {interviews.map((i) => {
                    const view = statusView(i);
                    return (
                      <li className="runs__row" key={i.id}>
                        <div>
                          <p className="h3">
                            {i.targetRole ?? 'Interview'}
                            {i.mode === 'demo' && (
                              <>
                                {' '}
                                <span className="tag">Demo</span>
                              </>
                            )}
                          </p>
                          <p className="muted small">{formatDateTime(i.startedAt ?? i.createdAt)}</p>
                        </div>
                        <p className="status" data-tone={view.tone}>
                          {view.label}
                        </p>
                        <div>{i.overallRating ? <RatingMeter rating={i.overallRating} /> : null}</div>
                        <Link href={`/interview/${i.id}`}>{view.action}</Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Shell>
      <RequireAuth needsOnboarding>
        <DashboardContent />
      </RequireAuth>
    </Shell>
  );
}
