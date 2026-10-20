import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/PasswordResetForm';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <Shell>
      <ForgotPasswordForm />
    </Shell>
  );
}
