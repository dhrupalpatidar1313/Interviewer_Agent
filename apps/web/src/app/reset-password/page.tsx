import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/PasswordResetForm';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <Shell>
      <ResetPasswordForm />
    </Shell>
  );
}
