import { prisma } from '../../config/prisma.js';
import { saveQueue } from '../../queues/save.queue.js';
import { cacheCleanupQueue, storageCleanupQueue } from '../../queues/cleanup.queue.js';

export interface AdminStats {
  users: { total: number; registered: number; anon: number; verified: number };
  media: { total: number; variants: number; persisted: number };
  saves: { total: number; complete: number; pending: number; downloading: number; failed: number };
  storage: { permanentBytes: number; cacheBytes: number };
  queues: {
    save: QueueCounts;
    cleanupCache: QueueCounts;
    cleanupStorage: QueueCounts;
  };
}

interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export async function getStats(): Promise<AdminStats> {
  const [usersTotal, usersRegistered, usersVerified, mediaTotal, variantsTotal, variantsPersisted, savesByState] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { kind: 'REGISTERED' } }),
      prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      prisma.media.count(),
      prisma.mediaVariant.count(),
      prisma.mediaVariant.count({ where: { state: 'PERSISTED' } }),
      prisma.savedMedia.groupBy({ by: ['state'], _count: { _all: true } }),
    ]);

  const stateCount = (s: 'PENDING' | 'DOWNLOADING' | 'COMPLETE' | 'FAILED'): number =>
    savesByState.find((r) => r.state === s)?._count._all ?? 0;

  const [permanentBytes, cacheBytes] = await Promise.all([
    sumPersistedBytes(),
    sumCacheBytes(),
  ]);

  const [save, cache, storage] = await Promise.all([
    queueCounts(saveQueue),
    queueCounts(cacheCleanupQueue),
    queueCounts(storageCleanupQueue),
  ]);

  return {
    users: {
      total: usersTotal,
      registered: usersRegistered,
      anon: usersTotal - usersRegistered,
      verified: usersVerified,
    },
    media: { total: mediaTotal, variants: variantsTotal, persisted: variantsPersisted },
    saves: {
      total: savesByState.reduce((acc, r) => acc + r._count._all, 0),
      complete: stateCount('COMPLETE'),
      pending: stateCount('PENDING'),
      downloading: stateCount('DOWNLOADING'),
      failed: stateCount('FAILED'),
    },
    storage: { permanentBytes, cacheBytes },
    queues: { save, cleanupCache: cache, cleanupStorage: storage },
  };
}

async function sumPersistedBytes(): Promise<number> {
  const r = await prisma.mediaVariant.aggregate({
    _sum: { sizeBytes: true },
    where: { state: 'PERSISTED' },
  });
  return Number(r._sum.sizeBytes ?? 0);
}

async function sumCacheBytes(): Promise<number> {
  const r = await prisma.cacheEntry.aggregate({ _sum: { bytes: true } });
  return Number(r._sum.bytes ?? 0);
}

async function queueCounts(q: { getJobCounts: (...s: string[]) => Promise<Record<string, number>> }): Promise<QueueCounts> {
  const c = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  return {
    waiting: c.waiting ?? 0,
    active: c.active ?? 0,
    delayed: c.delayed ?? 0,
    completed: c.completed ?? 0,
    failed: c.failed ?? 0,
  };
}

export async function listUsers(opts: { take?: number; cursor?: string } = {}) {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const users = await prisma.user.findMany({
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      email: true,
      displayName: true,
      kind: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });
  const items = users.slice(0, take).map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
  }));
  const nextCursor = users.length > take ? users[users.length - 1]!.id : null;
  return { items, nextCursor };
}

export async function listFailedJobs(opts: { take?: number } = {}) {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const failed = await saveQueue.getJobs(['failed'], 0, take - 1);
  return failed.map((j) => ({
    id: j.id,
    name: j.name,
    data: j.data,
    failedReason: j.failedReason ?? null,
    attemptsMade: j.attemptsMade,
    timestamp: j.timestamp,
  }));
}
