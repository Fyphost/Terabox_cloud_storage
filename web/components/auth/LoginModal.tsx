'use client';

import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLogin } from '@/hooks/use-auth';
import { useUIStore, toast } from '@/lib/store/ui.store';
import { ApiError } from '@/lib/api/client';

/**
 * Lightweight inline login. Used when an unauthenticated user attempts a
 * gated action (Save, Library, etc.). For full signup/forgot flows, the
 * modal links out to the dedicated /auth pages.
 */
export function LoginModal() {
  const open = useUIStore((s) => s.loginModalOpen);
  const close = useUIStore((s) => s.closeLoginModal);
  const returnTo = useUIStore((s) => s.loginModalReturnTo);
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      toast({ variant: 'success', title: 'Signed in' });
      close();
      if (returnTo) router.push(returnTo);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Sign in failed',
        description: err instanceof ApiError ? err.message : 'Try again.',
      });
    }
  };

  const signupHref =
    `/auth/signup` + (returnTo ? `?next=${encodeURIComponent(returnTo)}` : '');
  const forgotHref = `/auth/forgot`;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : close())}>
      <DialogContent
        title="Sign in to continue"
        description="Sign in to save media to your library."
      >
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-fg" htmlFor="lm-email">
              Email
            </label>
            <Input
              id="lm-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-fg" htmlFor="lm-pwd">
                Password
              </label>
              <a className="text-xs text-primary hover:underline" href={forgotHref}>
                Forgot?
              </a>
            </div>
            <Input
              id="lm-pwd"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
            {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-fg">
          New to Fyphost?{' '}
          <a href={signupHref} className="font-medium text-primary hover:underline">
            Create an account
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
