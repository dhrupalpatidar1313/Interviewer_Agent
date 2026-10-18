'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RatingMeter } from '@/components/RatingMeter';
import { RequireAuth, Shell } from '@/components/Shell';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { endedByLabel, formatDateTime } from '@/lib/format';
import { EXPERIENCE_LEVELS, type InterviewDetail, type InterviewSummary, type Profile, type ResumeMeta } from '@/lib/types';

function statusView(i: InterviewSummary): { label: string; tone: 'ok' | 'bad' | 'neutral'; action: string } {
  switch (i.status) {
    case 'completed':
      return { label: endedByLabel(i.endedBy), tone: 'ok', action: 'View feedback' };
    case 'failed':
      return { label: 'Did not run', tone: 'bad', action: 'View details' };
    case 'in_progress':
      return { label: 'In progress', tone: 'neutral', action: 'Open' };
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ profile: Profile | null; resume: ResumeMeta | null }>('/profile'),
      api<{ interviews: InterviewSummary[] }>('/interviews'),
    ])
      .then(([p, i]) => {
        if (cancelled) return;
        setProfile(p.profile);
        setResume(p.resume);
        setInterviews(i.interviews);
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
      setStarting(false);
    }
  }

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
          <p className="alert" role="alert">
            {error}
          </p>
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
              <div className="row">
                <button className="btn btn--lg" type="button" onClick={start} disabled={starting}>
                  {starting ? 'Setting up…' : 'Start an interview'}
                </button>
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
                          <p className="h3">{i.targetRole ?? 'Interview'}</p>
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
