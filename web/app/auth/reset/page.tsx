'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import AuthCard from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useResetPassword } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api/client';

export default function ResetPage() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const router = useRouter();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('Invalid or expired reset link.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      await reset.mutateAsync({ token, password });
      setDone(true);
      setTimeout(() => router.push('/auth/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.');
    }
  };

  if (done) {
    return (
      <AuthCard title="Password updated" subtitle="Redirecting to sign in…">
        <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 p-3">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
          <p className="text-sm text-fg-soft">Your password was updated.</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Pick something strong you'll remember."
      footer={
        <>
          Need a new link?{' '}
          <Link href="/auth/forgot" className="font-medium text-primary hover:underline">
            Start over
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="pwd" className="text-sm font-medium text-fg">New password</label>
          <Input id="pwd" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <label htmlFor="pwd2" className="text-sm font-medium text-fg">Confirm password</label>
          <Input id="pwd2" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5" />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={reset.isPending}>
          {reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
