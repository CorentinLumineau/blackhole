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
    let openPrs = 0;
    try {
      const prs = runGhJson<{ number: number }[]>(
        ['pr', 'list', '--state', 'open', '--json', 'number'],
        { repo },
      );
      openPrs = prs.length;
    } catch {
      openPrs = 0;
    }
    return { openIssues: issues.length, openPrs, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unexpected token') || message.includes('JSON')) {
      return { openIssues: 0, openPrs: 0, ok: false, error: 'invalid gh JSON' };
    }
    return { openIssues: 0, openPrs: 0, ok: false, error: message };
  }
}
