import { buildListArgs, type CampaignScope } from '../../forge-scope.ts';
import { runGhJson } from '../forge-adapter/cli.ts';
import type { ForgeCounts } from './types.ts';

export function fetchForgeCounts(scope: CampaignScope, repo: string): ForgeCounts {
  const listArgs = buildListArgs(scope);
  const issueArgs = [
    'issue',
    'list',
    '--state',
    'open',
    '--json',
    'number',
    ...listArgs,
  ];

  try {
    const issues = runGhJson<{ number: number }[]>(issueArgs, { repo });
    // A `gh pr list` failure here used to render as `openPrs: 0, ok: true` — indistinguishable
    // from the legitimate "zero open PRs" state (issue #864). An unattended orchestrator reading
    // `ok: true` treats the count as authoritative; a swallowed forge failure must never look
    // like a clean read. Surfaced as `ok: false` with the stderr text, same as the outer catch
    // below — `openIssues` stays populated since that half of the call did succeed.
    try {
      const prs = runGhJson<{ number: number }[]>(
        ['pr', 'list', '--state', 'open', '--json', 'number'],
        { repo },
      );
      return { openIssues: issues.length, openPrs: prs.length, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { openIssues: issues.length, openPrs: 0, ok: false, error: message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unexpected token') || message.includes('JSON')) {
      return { openIssues: 0, openPrs: 0, ok: false, error: 'invalid gh JSON' };
    }
    return { openIssues: 0, openPrs: 0, ok: false, error: message };
  }
}
