import { closedIssues } from './campaign-status/merged.ts';
import type { ForgeAdapter, ForgePr } from './forge-adapter/types.ts';

// Releases the contract claim labels (`config.claim_labels`) a campaign leaves behind when it
// stops or drains. It works from the forge's own label state, so it needs no lane and no record of
// who claimed what: an issue the campaign dispatched that still carries a claim label and has no
// open PR in flight is released.

const SOFT_LINK = /\b(?:part\s+of|refs?)\s*:?\s+#(\d+)/gi;

export const RELEASE_COMMENT = 'released by blackhole stop: no work in flight; claim again to continue';

/** True when the branch name carries `issue` as a whole number token (`blackhole/issue-12`, not `issue-123`). */
export const branchNamesIssue = (branch: string, issue: number): boolean => new RegExp(`(?:^|[^0-9])${issue}(?:[^0-9]|$)`).test(branch);

/** True when an open PR works on `issue`: a closing keyword or a `Part of`/`Refs` line in its body, or the number in its head branch. */
export const prLinksIssue = (pr: ForgePr, issue: number): boolean =>
  closedIssues(pr.body ?? '').includes(issue) ||
  [...(pr.body ?? '').matchAll(SOFT_LINK)].some((m) => Number(m[1]) === issue) ||
  branchNamesIssue(pr.headRefName ?? '', issue);

/** Queue statuses of an entry this campaign worked; a `ready` or `blocked` entry may be claimed by another owner. */
export const DISPATCHED_STATUSES: readonly string[] = ['in-flight', 'merged', 'closed'];

export type ClaimReleaseReport = {
  released: Array<{ issue: number; label: string }>;
  kept: Array<{ issue: number; label: string; pr: number }>;
  failed: Array<{ issue: number; label: string; error: string }>;
};

/**
 * `issues` are the campaign's own issue numbers; `labels` the configured claim labels. Each member
 * of `issues` that carries a label and has no open linking PR loses the label and gets one comment.
 * A member with an open linking PR is kept: the PR is the work in flight. A forge error on one
 * member lands in `failed` and the pass goes on, so the report always covers every member reached.
 */
export async function releaseClaimLabels(
  adapter: Pick<ForgeAdapter, 'issueList' | 'prList' | 'labelRemove' | 'issueComment'>,
  issues: number[],
  labels: string[],
): Promise<ClaimReleaseReport> {
  const report: ClaimReleaseReport = { released: [], kept: [], failed: [] };
  if (labels.length === 0 || issues.length === 0) return report;
  const own = new Set(issues);
  const prs = (await adapter.prList({ state: 'open', limit: 200 })).filter((p) => p.state === 'OPEN');
  for (const label of labels) {
    const claimed = (await adapter.issueList({ state: 'open', labels: [label] })).filter((i) => own.has(i.number));
    for (const { number } of claimed) {
      const pr = prs.find((p) => prLinksIssue(p, number));
      if (pr) {
        report.kept.push({ issue: number, label, pr: pr.number });
        continue;
      }
      try {
        await adapter.labelRemove({ type: 'issue', number }, [label]);
        await adapter.issueComment(number, RELEASE_COMMENT);
        report.released.push({ issue: number, label });
      } catch (error) {
        report.failed.push({ issue: number, label, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return report;
}

/** The validated `claim_labels` of a config object: absent reads as none; a wrong type throws with the key path. */
export const readClaimLabels = (config: { claim_labels?: unknown }): string[] => {
  const raw = config.claim_labels;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((l) => typeof l !== 'string' || l.trim() === '')) {
    throw new Error('claim_labels must be an array of non-empty label names');
  }
  return [...new Set(raw as string[])];
};
