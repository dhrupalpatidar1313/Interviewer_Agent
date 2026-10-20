import type { Metadata } from 'next';
import { ProviderSettings } from '@/components/ProviderSettings';
import { RequireAuth, Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'API keys and models' };

export default function SettingsPage() {
  return (
    <Shell>
      <RequireAuth>
        <div className="container container--narrow page">
          <div className="stack stack--xl">
            <header className="stack">
              <h1 className="h1">API keys and models</h1>
              <p className="lede">
                Your first interview is a free demo on our models. For full-length interviews, use your own accounts
                with the providers you like.
              </p>
            </header>
            <ProviderSettings />
          </div>
        </div>
      </RequireAuth>
    </Shell>
  );
}
