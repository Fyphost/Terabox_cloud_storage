'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, MailX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import AuthCard from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useResendVerification, useVerifyEmail } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api/client';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyPage() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const ranRef = useRef(false);

  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState<string>('');
  const [resendEmail, setResendEmail] = useState('');

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!token) {
      setStatus('error');
      setMessage('Verification token missing.');
      return;
    }
    verify
      .mutateAsync(token)
      .then(() => {
        setStatus('success');
        setMessage('Email verified.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'Verification failed.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (status === 'verifying') {
    return (
      <AuthCard title="Verifying your email" subtitle="Hold on a second…">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-fg-soft">Checking your verification token.</p>
        </div>
      </AuthCard>
    );
  }

  if (status === 'success') {
    return (
      <AuthCard
        title="You're verified"
        subtitle="Your account is ready to use."
        footer={
          <>
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              Continue to sign in
            </Link>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 p-3">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
          <p className="text-sm text-fg-soft">{message}</p>
        </div>
        <Button asChild size="lg" className="mt-4 w-full">
          <Link href="/auth/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verification failed"
      subtitle="The link may have expired or already been used."
      footer={
        <Link href="/auth/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-danger/20 bg-danger/5 p-3">
        <MailX className="h-5 w-5 text-danger" aria-hidden />
        <p className="text-sm text-fg-soft">{message}</p>
      </div>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!resendEmail) return;
          void resend.mutate(resendEmail);
        }}
      >
        <label className="text-sm font-medium text-fg" htmlFor="re">Resend verification email</label>
        <Input id="re" type="email" required value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} placeholder="you@example.com" />
        <Button type="submit" size="md" className="w-full" disabled={resend.isPending}>
          {resend.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Send a new link
        </Button>
        {resend.isSuccess && (
          <p className="text-center text-xs text-muted-fg">If the address has an unverified account, a new link is on its way.</p>
        )}
      </form>
    </AuthCard>
  );
}
