import { issueMatchesScope, type CampaignScope } from '../../forge-scope.ts';
import type { ForgeAdapter } from '../forge-adapter/types.ts';
import type { ForgeCounts, MergedPr } from './types.ts';

// Open-issue and open-PR counts, and the merged PRs, read through the forge adapter of the
// configured forge (GitHub, Gitea or GitLab). Scope (milestone, labels) is applied to the fetched
// rows with the same matcher the sync uses, so both read one definition.
const COUNT_LIMIT = 1000;

/** The newest PRs of any state read to find the merged ones: a few pages, not the whole history. */
export const MERGED_PR_LIMIT = 300;

export async function fetchForgeCounts(scope: CampaignScope, adapter: ForgeAdapter): Promise<ForgeCounts> {
  let openIssues: number;
  try {
    openIssues = (await adapter.issueList({ state: 'open', limit: COUNT_LIMIT })).filter((i) => issueMatchesScope(i, scope)).length;
  } catch (error) {
    return { openIssues: 0, openPrs: 0, ok: false, error: errorText(error) };
  }
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
      .map((p) => ({ number: p.number, title: p.title, mergedAt: p.mergedAt as string }));
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unexpected token') || message.includes('JSON') ? 'invalid gh JSON' : message;
}
