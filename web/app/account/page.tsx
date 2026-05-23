'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser, useLogout, isRegistered } from '@/hooks/use-auth';

export default function AccountPage() {
  const router = useRouter();
  const { data, isLoading } = useCurrentUser();
  const logout = useLogout();
  const user = data?.user;

  useEffect(() => {
    if (!isLoading && !isRegistered(user)) {
      router.replace('/auth/login?next=/account');
    }
  }, [isLoading, user, router]);

  if (isLoading || !isRegistered(user)) {
    return (
      <div className="container py-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-4 h-32 w-full max-w-xl" />
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-8 md:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-fg">Manage your sign-in and profile.</p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <h2 className="text-base font-semibold">Profile</h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" value={user.displayName ?? '—'} />
          <Field label="Email" value={user.email ?? '—'} />
          <Field
            label="Email verified"
            value={
              user.emailVerified ? (
                <span className="inline-flex items-center gap-1.5 text-success">
                  <ShieldCheck className="h-4 w-4" /> Verified
                </span>
              ) : (
                'Not verified'
              )
            }
          />
          <Field label="Role" value={user.role} />
          <Field label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-card">
        <h2 className="text-base font-semibold">Security</h2>
        <p className="mt-1 text-sm text-muted-fg">Sign out of this device.</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => void logout.mutate()}
          disabled={logout.isPending}
        >
          {logout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign out
        </Button>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-fg">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}
