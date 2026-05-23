'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import AuthCard from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLogin } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api/client';
import { toast } from '@/lib/store/ui.store';

export default function LoginPage() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/';
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      toast({ variant: 'success', title: 'Welcome back' });
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    }
  };

  const signupHref = `/auth/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to Fyphost."
      footer={
        <>
          New here?{' '}
          <Link href={signupHref} className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={setEmail} />
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="pwd" className="text-sm font-medium text-fg">
              Password
            </label>
            <Link href="/auth/forgot" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="pwd"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  required,
  value,
  onChange,
  helper,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  helper?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5"
      />
      {helper && <p className="mt-1.5 text-xs text-muted-fg">{helper}</p>}
    </div>
  );
}
