import { spawnSync } from 'child_process';
import { buildListArgs, type CampaignScope } from '../../forge-scope.ts';
import type { ForgeCounts } from './types.ts';

export function fetchForgeCounts(scope: CampaignScope, repo: string): ForgeCounts {
  const listArgs = buildListArgs(scope);
  const issueRes = spawnSync(
    'gh',
    ['issue', 'list', '--state', 'open', '--repo', repo, '--json', 'number', ...listArgs],
    { encoding: 'utf-8' },
  );
  const prRes = spawnSync(
    'gh',
    ['pr', 'list', '--state', 'open', '--repo', repo, '--json', 'number'],
    { encoding: 'utf-8' },
  );

  if (issueRes.status !== 0) {
    return {
      openIssues: 0,
      openPrs: 0,
      ok: false,
      error: issueRes.stderr?.trim() || issueRes.stdout?.trim() || 'issue list failed',
    };
  }

  let openIssues = 0;
  let openPrs = 0;
  try {
    openIssues = JSON.parse(issueRes.stdout || '[]').length;
    openPrs = prRes.status === 0 ? JSON.parse(prRes.stdout || '[]').length : 0;
  } catch {
    return { openIssues: 0, openPrs: 0, ok: false, error: 'invalid gh JSON' };
  }

  return { openIssues, openPrs, ok: true };
}
