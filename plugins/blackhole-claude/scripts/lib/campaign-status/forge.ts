import { crossRepoBlockers, type CrossRepoBlocker, type CrossRepoLandingReader } from '../../forge-deps.ts';
import { issueMatchesScope, type CampaignScope } from '../../forge-scope.ts';
import type { ForgeAdapter, ForgeIssue } from '../forge-adapter/types.ts';
import { closedIssues } from './merged.ts';
import type { ForgeCounts, MergedPr } from './types.ts';

// Open-issue and open-PR counts, and the merged PRs, read through the forge adapter of the
// configured forge (GitHub, Gitea or GitLab). Scope (milestone, labels) is applied to the fetched
// rows with the same matcher the sync uses, so both read one definition.
const COUNT_LIMIT = 1000;

/** The newest PRs of any state read to find the merged ones: a few pages, not the whole history. */
export const MERGED_PR_LIMIT = 300;

/** The open issues, read once per status run and shared by every consumer; `ok: false` keeps the error text. */
export type OpenIssueRead = { ok: true; issues: ForgeIssue[] } | { ok: false; error: string };

export async function readOpenIssues(adapter: ForgeAdapter): Promise<OpenIssueRead> {
  try {
    return { ok: true, issues: await adapter.issueList({ state: 'open', limit: COUNT_LIMIT }) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Counts from `open` when the caller already read the open issues; otherwise reads them itself. */
export async function fetchForgeCounts(scope: CampaignScope, adapter: ForgeAdapter, open?: OpenIssueRead): Promise<ForgeCounts> {
  const read = open ?? (await readOpenIssues(adapter));
  if (!read.ok) return { openIssues: 0, openPrs: 0, ok: false, error: read.error };
  const openIssues = read.issues.filter((i) => issueMatchesScope(i, scope)).length;
  // A PR-list failure must never render as a clean zero (issue #864): `ok: false` with the
  // error text, while the issue count that did succeed stays populated.
  try {
    const prs = await adapter.prList({ state: 'open', limit: COUNT_LIMIT });
    return { openIssues, openPrs: prs.length, openPrList: prs.map((p) => ({ number: p.number, title: p.title })), ok: true };
  } catch (error) {
    return { openIssues, openPrs: 0, ok: false, error: errorText(error) };
  }
}

/** The merged PRs among the newest `MERGED_PR_LIMIT`, or null when the read failed: "not read" is never an empty list. */
export async function fetchMergedPrs(adapter: ForgeAdapter): Promise<MergedPr[] | null> {
  try {
    return (await adapter.prList({ state: 'all', limit: MERGED_PR_LIMIT }))
      .filter((p) => p.state === 'MERGED' && p.mergedAt)
      .map((p) => ({ number: p.number, title: p.title, mergedAt: p.mergedAt as string, closes: closedIssues(p.body), labels: p.labels }));
  } catch {
    return null;
  }
}

/**
 * Unmet cross-repo dependencies of the open issues numbered in `queueIssues`, from their bodies'
 * `Depends on owner/repo#N` lines. Null when the open issues could not be read: "not read" is never "none".
 */
export function crossRepoBlockersOf(
  open: OpenIssueRead,
  queueIssues: Set<number>,
  read: CrossRepoLandingReader,
): CrossRepoBlocker[] | null {
  if (!open.ok) return null;
  return crossRepoBlockers(open.issues.filter((i) => queueIssues.has(i.number)), read);
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unexpected token') || message.includes('JSON') ? 'the forge answered with invalid JSON' : message;
}
