import { describe, expect, test } from 'bun:test';
import {
  buildCreateArgs,
  buildListArgs,
  issueMatchesScope,
  readScope,
  type CampaignScope,
  type ForgeIssue,
} from './forge-scope';

describe('buildListArgs', () => {
  test('milestone only', () => {
    const args = buildListArgs({ milestone: 'v0.4.0' });
    expect(args).toContain('--milestone');
    expect(args).toContain('v0.4.0');
  });

  test('labels only', () => {
    const args = buildListArgs({ labels: ['a', 'b'] });
    expect(args.filter((a) => a === '--label')).toHaveLength(2);
    expect(args).toContain('a');
    expect(args).toContain('b');
  });

  test('milestone and labels', () => {
    const args = buildListArgs({ milestone: 'v0.4.0', labels: ['campaign/backlog'] });
    expect(args).toContain('--milestone');
    expect(args).toContain('v0.4.0');
    expect(args).toContain('--label');
    expect(args).toContain('campaign/backlog');
  });

  test('empty scope', () => {
    const args = buildListArgs({});
    expect(args).toEqual([]);
  });
});

describe('buildCreateArgs', () => {
  test('mirrors list args', () => {
    const scope: CampaignScope = { milestone: 'v0.4.0', labels: ['size:m'] };
    const args = buildCreateArgs(scope);
    expect(args).toContain('--milestone');
    expect(args).toContain('v0.4.0');
    expect(args).toContain('--label');
    expect(args).toContain('size:m');
  });
});

describe('issueMatchesScope', () => {
  const issue = (milestone: string | null, labels: string[]): ForgeIssue => ({
    milestone: milestone ? { title: milestone } : null,
    labels: labels.map((name) => ({ name })),
  });

  test('no scope matches all', () => {
    expect(issueMatchesScope(issue('v0.4.0', ['a']), {})).toBe(true);
  });

  test('milestone match', () => {
    expect(issueMatchesScope(issue('v0.4.0', []), { milestone: 'v0.4.0' })).toBe(true);
    expect(issueMatchesScope(issue('v0.3.0', []), { milestone: 'v0.4.0' })).toBe(false);
  });

  test('labels require all (AND)', () => {
    expect(issueMatchesScope(issue(null, ['a', 'b']), { labels: ['a', 'b'] })).toBe(true);
    expect(issueMatchesScope(issue(null, ['a']), { labels: ['a', 'b'] })).toBe(false);
  });

  test('milestone and labels combined', () => {
    const scope = { milestone: 'v0.4.0', labels: ['campaign/backlog'] };
    expect(issueMatchesScope(issue('v0.4.0', ['campaign/backlog']), scope)).toBe(true);
    expect(issueMatchesScope(issue('v0.4.0', []), scope)).toBe(false);
  });
});

describe('readScope', () => {
  test('reads milestone and labels', () => {
    const scope = readScope({
      scope_milestone: 'v0.4.0',
      scope_labels: ['campaign/backlog', 'size:m'],
    });
    expect(scope.milestone).toBe('v0.4.0');
    expect(scope.labels).toEqual(['campaign/backlog', 'size:m']);
  });

  test('empty scope_labels treated as unset', () => {
    const scope = readScope({ scope_milestone: 'v0.4.0', scope_labels: [] });
    expect(scope.milestone).toBe('v0.4.0');
    expect(scope.labels).toBeUndefined();
  });

  test('unset fields', () => {
    expect(readScope({})).toEqual({});
  });
});
