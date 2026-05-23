'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import AuthCard from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSignup, useResendVerification } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api/client';

export default function SignupPage() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  const signup = useSignup();
  const resend = useResendVerification();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      await signup.mutateAsync({ email, password, displayName: displayName || undefined });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Signup failed');
    }
  };

  if (submitted) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We sent a verification link to ${email}. Click it to finish setting up your account.`}
        footer={
          <>
            Wrong email?{' '}
            <Link href="/auth/signup" className="font-medium text-primary hover:underline">
              Start over
            </Link>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 p-3">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
          <p className="text-sm text-fg-soft">Account created. Verification link sent.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="mt-4 w-full"
          disabled={resend.isPending}
          onClick={() => void resend.mutate(email)}
        >
          {resend.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Resend verification email
        </Button>
        {resend.isSuccess && (
          <p className="mt-3 text-center text-xs text-muted-fg">If we have an account for that email, a new link was sent.</p>
        )}
      </AuthCard>
    );
  }

  const loginHref = `/auth/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AuthCard
      title="Create your account"
      subtitle="Save the media you stream. Free to start."
      footer={
        <>
          Already have an account?{' '}
          <Link href={loginHref} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="dn" className="text-sm font-medium text-fg">
            Name <span className="text-muted-fg">(optional)</span>
          </label>
          <Input id="dn" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <label htmlFor="em" className="text-sm font-medium text-fg">Email</label>
          <Input id="em" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <label htmlFor="pwd" className="text-sm font-medium text-fg">Password</label>
          <Input
            id="pwd"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5"
          />
          <p className="mt-1.5 text-xs text-muted-fg">At least 8 characters with letters and numbers.</p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={signup.isPending}>
          {signup.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Create account
        </Button>
        <p className="text-center text-xs text-muted-fg">
          By creating an account you agree to the terms of service.
        </p>
      </form>
    </AuthCard>
  );
}
