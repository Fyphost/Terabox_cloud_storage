'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AlertTriangle, Database, Film, HardDrive, ListChecks, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthGate } from '@/hooks/use-auth';
import { getAdminStats, listAdminUsers, listFailedAdminJobs } from '@/lib/api/admin';
import { formatBytes } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export default function AdminPage() {
  const router = useRouter();
  const auth = useAuthGate('/admin');

  // Admin extra check: if user is registered but not admin, push them to /.
  useEffect(() => {
    if (auth.ready && auth.isRegistered && auth.user!.role !== 'ADMIN') {
      router.replace('/');
    }
  }, [auth.ready, auth.isRegistered, auth.user, router]);

  const isAdmin = auth.ready && auth.isRegistered && auth.user!.role === 'ADMIN';

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: ({ signal }) => getAdminStats(signal),
    refetchInterval: 30_000,
    enabled: isAdmin,
  });
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: ({ signal }) => listAdminUsers({ take: 25 }, signal),
    enabled: isAdmin,
  });
  const failed = useQuery({
    queryKey: ['admin', 'jobs-failed'],
    queryFn: ({ signal }) => listFailedAdminJobs({ take: 25 }, signal),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="container py-10">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-6 md:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted-fg">Operational overview.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI
          icon={<Users className="h-4 w-4" />}
          label="Users"
          value={stats.data?.users.total}
          sub={
            stats.data
              ? `${stats.data.users.registered} registered · ${stats.data.users.verified} verified`
              : undefined
          }
        />
        <KPI
          icon={<Film className="h-4 w-4" />}
          label="Media"
          value={stats.data?.media.total}
          sub={
            stats.data
              ? `${stats.data.media.variants} variants · ${stats.data.media.persisted} persisted`
              : undefined
          }
        />
        <KPI
          icon={<HardDrive className="h-4 w-4" />}
          label="Storage"
          value={stats.data ? formatBytes(stats.data.storage.permanentBytes) : undefined}
          sub={stats.data ? `Cache: ${formatBytes(stats.data.storage.cacheBytes)}` : undefined}
        />
        <KPI
          icon={<ListChecks className="h-4 w-4" />}
          label="Save jobs"
          value={stats.data?.saves.total}
          sub={
            stats.data
              ? `${stats.data.saves.complete} done · ${stats.data.saves.failed} failed`
              : undefined
          }
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-fg">Queues</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <QueueCard name="save" stats={stats.data?.queues.save} />
          <QueueCard name="cleanup-cache" stats={stats.data?.queues.cleanupCache} />
          <QueueCard name="cleanup-storage" stats={stats.data?.queues.cleanupStorage} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-fg">
          Recent users
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-fg">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Verified</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data?.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-fg">{u.displayName || u.email || u.id}</div>
                    {u.displayName && u.email && (
                      <div className="text-xs text-muted-fg">{u.email}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        u.kind === 'REGISTERED'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-fg',
                      )}
                    >
                      {u.kind}
                    </span>
                    {u.role === 'ADMIN' && (
                      <span className="ml-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        admin
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-fg-soft">
                    {u.emailVerifiedAt ? '✓' : '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-fg-soft">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 align-top text-fg-soft">
                    {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
              {!users.data && (
                <tr>
                  <td colSpan={5} className="px-3 py-6">
                    <Skeleton className="h-4 w-1/2" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 mb-12">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-fg">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Failed jobs
        </h2>
        {failed.data && failed.data.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted-fg shadow-soft">
            No failed jobs in the last window.
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
            {failed.data?.map((j) => (
              <li key={j.id} className="flex items-start justify-between gap-4 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{j.name}</p>
                  <p className="truncate text-xs text-muted-fg">
                    {j.id} · attempts: {j.attemptsMade}
                  </p>
                  {j.failedReason && (
                    <p className="mt-1 text-xs text-danger">{j.failedReason}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-fg">
                  {new Date(j.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KPI({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-fg">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">
        {value === undefined ? <Skeleton className="h-7 w-16" /> : value}
      </p>
      {sub && <p className="mt-1 truncate text-xs text-muted-fg">{sub}</p>}
    </div>
  );
}

function QueueCard({
  name,
  stats,
}: {
  name: string;
  stats?: { waiting: number; active: number; delayed: number; completed: number; failed: number };
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <Database className="h-4 w-4 text-primary" /> {name}
      </div>
      {stats ? (
        <dl className="mt-3 grid grid-cols-5 gap-2 text-center">
          <Stat k="waiting" v={stats.waiting} />
          <Stat k="active" v={stats.active} />
          <Stat k="delayed" v={stats.delayed} />
          <Stat k="done" v={stats.completed} />
          <Stat k="failed" v={stats.failed} dangerOnNonZero />
        </dl>
      ) : (
        <Skeleton className="mt-3 h-12 w-full" />
      )}
    </div>
  );
}

function Stat({
  k,
  v,
  dangerOnNonZero,
}: {
  k: string;
  v: number;
  dangerOnNonZero?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-fg">{k}</dt>
      <dd
        className={cn(
          'text-base font-semibold tabular-nums',
          dangerOnNonZero && v > 0 ? 'text-danger' : 'text-fg',
        )}
      >
        {v}
      </dd>
    </div>
  );
}
