import { issueMatchesScope, type CampaignScope } from '../../forge-scope.ts';
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

// A closing keyword followed directly by `#N` names an issue of this repository; `owner/repo#N`
// names another one and does not match. GitHub, Gitea and GitLab share these keywords.
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;

/** The issues of this repository a PR body closes, in order of appearance. */
export function closedIssues(body: string): number[] {
  return [...new Set([...body.matchAll(CLOSING)].map((m) => Number(m[1])))];
}

/**
 * Brings the queue in line with the merged PRs the forge reports, for rendering. `merged` is null
 * when the forge's merged list was not read, and then nothing changes and no drift is claimed.
 * A queue entry names its merged PR by `pr`, or, with no `pr`, by the PR's closing reference to its
 * issue, so the same work never counts as both an entry and a merged PR without one. Merged PRs
 * without an entry count only from `startedAt` on (with no start date nothing bounds them, so none
 * counts) and only when they carry every scope label the forge reports for them. The scope
 * milestone is not applied: a pull request row carries none.
 */
export function reconcileMerged(
  issues: Record<string, QueueIssue>,
  merged: MergedPr[] | null,
  startedAt: string | null,
  scope: CampaignScope = {},
): Reconciled {
  if (!merged) return { issues, drift: [], mergedOnly: [] };
  const byNumber = new Map(merged.map((p) => [p.number, p]));
  const closedBy = new Map<number, MergedPr>();
  for (const p of merged) for (const n of p.closes ?? []) if (!closedBy.has(n)) closedBy.set(n, p);
  const named = new Set<number>();
  const drift: QueueDrift[] = [];
  const out: Record<string, QueueIssue> = {};
  for (const [key, issue] of Object.entries(issues)) {
    out[key] = issue;
    const pr = issue.pr != null ? byNumber.get(issue.pr) : closedBy.get(Number(key));
    if (issue.pr != null) named.add(issue.pr);
    if (!pr) continue;
    named.add(pr.number);
    if (DONE_STATUSES.includes(issue.status ?? '')) continue;
    drift.push({ issue: Number(key), pr: pr.number, title: issue.title ?? '', queue: issue.status ?? 'no status', forge: 'merged' });
    out[key] = { ...issue, status: 'merged' };
  }
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const inScope = (p: MergedPr) => p.labels === undefined || issueMatchesScope({ labels: p.labels.map((name) => ({ name })) }, { labels: scope.labels });
  const mergedOnly = Number.isNaN(start) ? [] : merged.filter((p) => !named.has(p.number) && Date.parse(p.mergedAt) >= start && inScope(p));
  return { issues: out, drift, mergedOnly };
}
