import { isClaimStale, laneLabel, laneOfLabel, LANE_LABEL_PREFIX, DEFAULT_CLAIM_LEASE_HOURS } from '../lane.ts';
import { closedIssues } from '../campaign-status/merged.ts';
import type { ClaimLease, ClaimResult, ForgePr, ReleaseResult } from './types.ts';

// The one claim and release flow behind every backend's `claim`/`release` (ADR-053 C4), the way
// `dependencies.ts` holds the dependency flow: a backend supplies its channel, this module decides.

export type ClaimSnapshot = { state: 'OPEN' | 'CLOSED'; labels: string[]; assignees: string[]; updatedAt?: string | null };

export interface ClaimOps {
  read(issue: number): Promise<ClaimSnapshot>;
  /** Latest update time among open PRs closing the issue; null when none. Read only when a foreign claim exists. */
  prActivity(issue: number): Promise<string | null>;
  /** Creates the label when the forge needs it to exist before use. */
  ensureLabel(label: string): Promise<void>;
  labelAdd(issue: number, label: string): Promise<void>;
  labelRemove(issue: number, label: string): Promise<void>;
  assign(issue: number, user: string, current: string[]): Promise<void>;
  unassign(issue: number, user: string, current: string[]): Promise<void>;
}

/** Latest `updatedAt` among the open PRs whose body closes `issue`. */
export const latestClosingPrActivity = (prs: ForgePr[], issue: number): string | null => {
  const times = prs
    .filter((p) => p.state === 'OPEN' && p.updatedAt && closedIssues(p.body ?? '').includes(issue))
    .map((p) => p.updatedAt as string)
    .filter((t) => !Number.isNaN(Date.parse(t)));
  return times.length ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
};

const foreignLabels = (labels: string[], lane: string): string[] => labels.filter((l) => {
  const named = laneOfLabel(l);
  return named !== null && named !== lane;
});

export async function claimIssue(ops: ClaimOps, issue: number, lane: string, user: string, lease?: ClaimLease): Promise<ClaimResult> {
  const snap = await ops.read(issue);
  if (snap.state === 'CLOSED') return { verdict: 'CLOSED' };
  const own = laneLabel(lane);
  const hasOwn = snap.labels.includes(own);
  const assigned = snap.assignees.includes(user);
  const foreign = foreignLabels(snap.labels, lane);

  // Only `in-progress:*` leases; `agent:*` is another tool's statement and always holds.
  let stale: string[] = [];
  if (foreign.length > 0) {
    const activityAt = foreign.some((l) => l.startsWith(LANE_LABEL_PREFIX)) ? await ops.prActivity(issue) : null;
    const now = lease?.now ?? Date.now();
    const leaseHours = lease?.leaseHours ?? DEFAULT_CLAIM_LEASE_HOURS;
    stale = foreign.filter((l) => l.startsWith(LANE_LABEL_PREFIX) && isClaimStale({ updatedAt: snap.updatedAt, activityAt, now, leaseHours }));
    const live = foreign.filter((l) => !stale.includes(l));
    if (live.length > 0) return { verdict: 'HELD', held_by: laneOfLabel(live[0]) as string };
  }
  if (hasOwn && assigned && stale.length === 0) return { verdict: 'ALREADY-OWN' };

  if (!hasOwn) await ops.ensureLabel(own);
  if (stale.length > 0) for (const l of stale) await ops.labelRemove(issue, l);
  if (!hasOwn) await ops.labelAdd(issue, own);
  if (!assigned) await ops.assign(issue, user, snap.assignees);

  // Race: another lane may have labelled the issue meanwhile. Both claimants apply the same rule,
  // so exactly one survives: the lexicographically greater lane rolls back.
  const after = await ops.read(issue);
  const rival = foreignLabels(after.labels, lane).map((l) => laneOfLabel(l) as string).find((r) => !stale.includes(laneLabel(r)));
  if (rival !== undefined && lane > rival) {
    await ops.labelRemove(issue, own);
    if (!assigned) await ops.unassign(issue, user, [...snap.assignees, user]);
    return { verdict: 'HELD', held_by: rival };
  }
  return { verdict: stale.length > 0 ? 'RECLAIMED' : 'CLAIMED' };
}

export async function releaseIssue(ops: ClaimOps, issue: number, lane: string, user: string): Promise<ReleaseResult> {
  const snap = await ops.read(issue);
  const own = laneLabel(lane);
  if (!snap.labels.includes(own)) return { verdict: 'NOT-HELD' };
  await ops.labelRemove(issue, own);
  if (snap.assignees.includes(user)) await ops.unassign(issue, user, snap.assignees);
  return { verdict: 'RELEASED' };
}
