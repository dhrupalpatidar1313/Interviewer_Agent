'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { APP_NAME } from '@/lib/brand';
import { useAuth } from '@/lib/auth';

export function Logo({ size = 26 }: { size?: number }) {
  const heights = [8, 15, 22, 12, 18];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      {heights.map((h, i) => (
        <rect
          key={i}
          x={2 + i * 5.2}
          y={14 - h / 2}
          width={3.2}
          height={h}
          rx={1.2}
          fill={i === 3 ? 'var(--signal)' : 'var(--ink)'}
        />
      ))}
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await logout();
    router.replace('/');
  }

  return (
    <>
      <header className="site-header">
        <div className="container site-header__inner">
          <Link className="brand" href={user ? '/dashboard' : '/'}>
            <Logo />
            {APP_NAME}
          </Link>
          <nav className="nav" aria-label="Main">
            {user ? (
              <>
                <Link
                  className="nav__link"
                  href="/dashboard"
                  aria-current={pathname === '/dashboard' ? 'page' : undefined}
                >
                  Dashboard
                </Link>
                <Link
                  className="nav__link"
                  href="/onboarding"
                  aria-current={pathname === '/onboarding' ? 'page' : undefined}
                >
                  Profile and resume
                </Link>
                <Link
                  className="nav__link"
                  href="/settings"
                  aria-current={pathname === '/settings' ? 'page' : undefined}
                >
                  API keys
                </Link>
                <button type="button" className="btn btn--quiet" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link className="nav__link" href="/login">
                  Sign in
                </Link>
                <Link className="btn" href="/signup">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}

/** Redirects signed-out visitors to /login, and (optionally) people who have not finished onboarding to /onboarding. */
export function RequireAuth({ children, needsOnboarding = false }: { children: ReactNode; needsOnboarding?: boolean }) {
  const { loading, user, onboarding } = useAuth();
  const router = useRouter();

  const mustOnboard = needsOnboarding && !!onboarding && !onboarding.complete;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    } else if (mustOnboard) {
      router.replace('/onboarding');
    }
  }, [loading, user, mustOnboard, router]);

  if (loading || !user || mustOnboard) {
    return (
      <div className="container page">
        <p className="muted" role="status">
          Loading…
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
