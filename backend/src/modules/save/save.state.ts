/**
 * SavedMedia state aggregation.
 *
 * The aggregate is derived from the underlying MediaVariant.state values for
 * every variant the user has claimed. We never store an aggregate that
 * disagrees with the variant rows.
 *
 * Rules:
 *
 *   - all PERSISTED                        → COMPLETE
 *   - any PERSISTED + any FAILED, none in flight → PARTIAL
 *   - all FAILED                           → FAILED
 *   - any in-flight (PENDING/FETCHING/...) → IN_PROGRESS
 *   - everything PENDING                   → PENDING
 *
 * IN_FLIGHT_STATES is the set of states that mean "still doing something"
 * for aggregation purposes.
 */

import type { SavedState, VariantState } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export const IN_FLIGHT_VARIANT_STATES: VariantState[] = [
  'PENDING',
  'FETCHING',
  'DOWNLOADING',
  'GENERATING_HLS',
  'GENERATING_THUMBNAIL',
  'FINALIZING',
];

export function aggregateSavedState(states: VariantState[]): SavedState {
  if (states.length === 0) return 'PENDING';
  const persisted = states.filter((s) => s === 'PERSISTED').length;
  const failed = states.filter((s) => s === 'FAILED').length;
  const inflight = states.filter((s) => IN_FLIGHT_VARIANT_STATES.includes(s)).length;

  if (persisted === states.length) return 'COMPLETE';
  if (failed === states.length) return 'FAILED';
  if (inflight > 0) return 'IN_PROGRESS';
  if (persisted > 0 && failed > 0) return 'PARTIAL';
  return 'PENDING';
}

export async function recomputeSavedMediaState(savedMediaId: string): Promise<SavedState | null> {
  const claims = await prisma.savedVariant.findMany({
    where: { savedMediaId },
    include: { variant: { select: { state: true } } },
  });
  if (claims.length === 0) return null;
  const states = claims.map((c) => c.variant.state);
  const next = aggregateSavedState(states);
  const completedAt = next === 'COMPLETE' ? new Date() : null;
  await prisma.savedMedia.update({
    where: { id: savedMediaId },
    data: { state: next, completedAt },
  });
  return next;
}
