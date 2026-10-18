import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'Create your account' };

export default function SignupPage() {
  return (
    <Shell>
      <AuthForm mode="signup" />
    </Shell>
  );
}
