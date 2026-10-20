'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

/** Step 1: ask for the email. The answer is the same whether or not an account exists. */
export function ForgotPasswordForm() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container container--narrow page">
      <div className="stack stack--lg" style={{ maxWidth: '28rem' }}>
        <div className="stack">
          <h1 className="h1">Reset your password</h1>
          <p className="muted">Enter your email and we will send you a link to choose a new one.</p>
        </div>

        {sent ? (
          <p className="notice" role="status">
            If an account exists for {email.trim()}, a reset link is on its way. It can take a minute.
          </p>
        ) : (
          <form className="form-grid" onSubmit={onSubmit} noValidate>
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
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button className="btn btn--lg" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
          </form>
        )}

        <p className="muted">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** Step 2: the emailed link signs the person in (recovery session); here they choose the new password. */
export function ResetPasswordForm() {
  const router = useRouter();
  const { updatePassword } = useAuth();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // The link's session may already have been picked up before this effect ran.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    // No session after a few seconds means the link was opened without a valid recovery token.
    const timer = setTimeout(() => setExpired(true), 4000);
    return () => {
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await updatePassword(password);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="container container--narrow page">
        <div className="stack stack--lg" style={{ maxWidth: '28rem' }}>
          {expired ? (
            <>
              <h1 className="h1">This link has expired</h1>
              <p className="muted">Reset links work once and only for a short time. Ask for a new one.</p>
              <div className="row">
                <Link className="btn" href="/forgot-password">
                  Send a new link
                </Link>
              </div>
            </>
          ) : (
            <p className="muted" role="status">
              Checking your link…
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container container--narrow page">
      <div className="stack stack--lg" style={{ maxWidth: '28rem' }}>
        <h1 className="h1">Choose a new password</h1>
        <form className="form-grid" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="field__hint">At least 8 characters.</p>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button className="btn btn--lg" type="submit" disabled={busy || password.length < 8}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
