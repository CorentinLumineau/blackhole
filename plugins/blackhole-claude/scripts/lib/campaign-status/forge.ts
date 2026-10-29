import { issueMatchesScope, type CampaignScope } from '../../forge-scope.ts';
import { listIssues, listPrs } from '../forge-adapter/github-rest.ts';
import type { ForgeCounts } from './types.ts';

// Open-issue and open-PR counts over GitHub REST (ADR-048). Scope (milestone, labels) is applied
// to the fetched rows with the same matcher the sync uses, so both read one definition.
const COUNT_LIMIT = 1000;

export function fetchForgeCounts(scope: CampaignScope, repo: string): ForgeCounts {
  let openIssues: number;
  try {
    openIssues = listIssues(repo, { state: 'open', limit: COUNT_LIMIT }).filter((i) => issueMatchesScope(i, scope)).length;
  } catch (error) {
    return { openIssues: 0, openPrs: 0, ok: false, error: errorText(error) };
  }
  // A PR-list failure must never render as a clean zero (issue #864): `ok: false` with the
  // error text, while the issue count that did succeed stays populated.
  try {
    return { openIssues, openPrs: listPrs(repo, 'open', COUNT_LIMIT).length, ok: true };
  } catch (error) {
    return { openIssues, openPrs: 0, ok: false, error: errorText(error) };
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unexpected token') || message.includes('JSON') ? 'invalid gh JSON' : message;
}
