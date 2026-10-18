import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Shell>
      <AuthForm mode="login" />
    </Shell>
  );
}
