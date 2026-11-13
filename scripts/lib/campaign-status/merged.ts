import { DONE_STATUSES } from './queue.ts';
import type { MergedPr, QueueDrift, QueueIssue } from './types.ts';

export type Reconciled = {
  /** The queue as the forge has it: an entry whose PR is merged reads as `merged`. The input is not changed. */
  issues: Record<string, QueueIssue>;
  /** Entries the forge contradicted, in queue order. */
  drift: QueueDrift[];
  /** Merged PRs no entry names, merged since the campaign started: done work that never had a queue entry. */
  mergedOnly: MergedPr[];
};

/**
 * Brings the queue in line with the merged PRs the forge reports, for rendering. `merged` is null
 * when the forge's merged list was not read, and then nothing changes and no drift is claimed.
 * Merged PRs without an entry count only from `startedAt` on; with no start date they cannot be
 * bounded to the campaign, so none counts.
 */
export function reconcileMerged(issues: Record<string, QueueIssue>, merged: MergedPr[] | null, startedAt: string | null): Reconciled {
  if (!merged) return { issues, drift: [], mergedOnly: [] };
  const byNumber = new Map(merged.map((p) => [p.number, p]));
  const named = new Set<number>();
  const drift: QueueDrift[] = [];
  const out: Record<string, QueueIssue> = {};
  for (const [key, issue] of Object.entries(issues)) {
    out[key] = issue;
    if (issue.pr == null) continue;
    named.add(issue.pr);
    if (!byNumber.has(issue.pr) || DONE_STATUSES.includes(issue.status ?? '')) continue;
    drift.push({ issue: Number(key), pr: issue.pr, title: issue.title ?? '', queue: issue.status ?? 'no status', forge: 'merged' });
    out[key] = { ...issue, status: 'merged' };
  }
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const mergedOnly = Number.isNaN(start) ? [] : merged.filter((p) => !named.has(p.number) && Date.parse(p.mergedAt) >= start);
  return { issues: out, drift, mergedOnly };
}
