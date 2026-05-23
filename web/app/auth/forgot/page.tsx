'use client';

import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import AuthCard from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useForgotPassword } from '@/hooks/use-auth';

export default function ForgotPage() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await forgot.mutateAsync(email).catch(() => undefined);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If an account exists for ${email}, we've sent a password reset link.`}
        footer={
          <>
            Remembered it?{' '}
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <MailCheck className="h-5 w-5 text-primary" aria-hidden />
          <p className="text-sm text-fg-soft">Reset link sent (if the email is on file).</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link."
      footer={
        <>
          Back to{' '}
          <Link href="/auth/login" className="font-medium text-primary hover:underline">
            sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="em" className="text-sm font-medium text-fg">Email</label>
          <Input id="em" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={forgot.isPending}>
          {forgot.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
