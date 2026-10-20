'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { EmailNotConfirmedError, useAuth } from '@/lib/auth';

function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const { user, loading, login, signup, resendConfirmation } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once Supabase has emailed a confirmation link (sign-up) or refused a sign-in until it is opened.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const isSignup = mode === 'signup';

  // Already signed in: skip the form.
  useEffect(() => {
    if (!loading && user && !busy) router.replace(safeNext() ?? '/dashboard');
  }, [loading, user, busy, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) {
        const { needsConfirmation } = await signup(name.trim(), email.trim(), password);
        if (needsConfirmation) {
          setAwaitingConfirmation(email.trim());
          setBusy(false);
          return;
        }
      } else {
        await login(email.trim(), password);
      }
      router.replace(safeNext() ?? (isSignup ? '/onboarding' : '/dashboard'));
    } catch (err) {
      if (err instanceof EmailNotConfirmedError) setAwaitingConfirmation(email.trim());
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function resend() {
    if (!awaitingConfirmation) return;
    setError(null);
    try {
      await resendConfirmation(awaitingConfirmation);
      setResent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (awaitingConfirmation && (isSignup || error)) {
    return (
      <div className="container container--narrow page">
        <div className="stack stack--lg" style={{ maxWidth: '28rem' }}>
          <div className="stack">
            <h1 className="h1">Check your email</h1>
            <p className="lede" role="status">
              We sent a confirmation link to <strong>{awaitingConfirmation}</strong>. Open it to finish creating your
              account, then come back and sign in.
            </p>
            <p className="muted">It can take a minute. Check your spam folder if you do not see it.</p>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {resent && (
            <p className="notice" role="status">
              Sent again. The newest link is the one that works.
            </p>
          )}
          <div className="row">
            <button className="btn btn--secondary" type="button" onClick={resend}>
              Send the link again
            </button>
            <Link className="btn btn--quiet" href="/login">
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container container--narrow page">
      <div className="stack stack--lg" style={{ maxWidth: '28rem' }}>
        <div className="stack">
          <h1 className="h1">{isSignup ? 'Create your account' : 'Sign in'}</h1>
          <p className="muted">
            {isSignup
              ? 'Next you will upload your resume and tell us about the role you want.'
              : 'Pick up where you left off.'}
          </p>
        </div>

        <form className="form-grid" onSubmit={onSubmit} noValidate>
          {isSignup && (
            <div className="field">
              <label className="field__label" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              minLength={isSignup ? 8 : undefined}
              required
              aria-describedby={isSignup ? 'password-hint' : undefined}
            />
            {isSignup ? (
              <p className="field__hint" id="password-hint">
                At least 8 characters.
              </p>
            ) : (
              <p className="field__hint">
                <Link href="/forgot-password">Forgot your password?</Link>
              </p>
            )}
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="row">
            <button className="btn btn--lg" type="submit" disabled={busy}>
              {busy ? (isSignup ? 'Creating account…' : 'Signing in…') : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </div>
        </form>

        <p className="muted">
          {isSignup ? (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/signup">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
