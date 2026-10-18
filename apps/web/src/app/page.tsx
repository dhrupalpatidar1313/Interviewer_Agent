'use client';

import Link from 'next/link';
import { BarField } from '@/components/BarField';
import { Shell } from '@/components/Shell';
import { StageRail } from '@/components/StageRail';
import { useAuth } from '@/lib/auth';

export default function Landing() {
  const { user, onboarding } = useAuth();

  return (
    <Shell>
      <section className="container hero">
        <div className="stack stack--lg">
          <h1 className="display">Practice the interview out loud.</h1>
          <p className="lede">
            Upload your resume, tell us the role you want, and talk with an AI interviewer that starts with the basics
            and works up to the hard questions. When you finish, you get a transcript and honest feedback.
          </p>
          <div className="row">
            {user ? (
              <Link className="btn btn--lg" href={onboarding?.complete ? '/dashboard' : '/onboarding'}>
                {onboarding?.complete ? 'Go to your dashboard' : 'Finish setting up'}
              </Link>
            ) : (
              <>
                <Link className="btn btn--lg" href="/signup">
                  Create an account
                </Link>
                <Link className="btn btn--lg btn--secondary" href="/login">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="container" aria-label="A sample question">
        <BarField />
        <div className="hero__caption">
          <span className="hero__speaker">Alex</span>
          <p className="hero__quote">Tell me about the last system you took from prototype to production.</p>
        </div>
      </section>

      <section className="container page">
        <div className="stack stack--lg">
          <div className="stack">
            <h2 className="h2">How an interview runs</h2>
            <p className="muted" style={{ maxWidth: '40rem' }}>
              Five stages, always in this order. The interviewer reads your resume first, then pushes harder or eases
              off depending on how you answer.
            </p>
          </div>
          <StageRail withDescriptions />
          <p className="muted" style={{ maxWidth: '40rem' }}>
            Afterwards you see a rating for each answer, what went well, what to work on, and the full conversation.
          </p>
        </div>
      </section>
    </Shell>
  );
}
