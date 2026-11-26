import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { branchNamesIssue, prLinksIssue, readClaimLabels, RELEASE_COMMENT } from './lib/claim-release.ts';
import { reportExitCode, runReleaseClaims, UsageError } from './release-claims.ts';
import type { ForgeAdapter, ForgeIssue, ForgePr } from './lib/forge-adapter/types.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-claims-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (config: Record<string, unknown>, issues: number[], status = 'in-flight'): void => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ repo: 'o/r', forge: 'github', ...config }));
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ issues: Object.fromEntries(issues.map((n) => [String(n), { status }])) }));
};
const issue = (number: number, label: string): ForgeIssue => ({ number, title: 't', body: '', labels: [{ name: label }], milestone: null, state: 'OPEN' });
const pr = (number: number, body: string, headRefName = 'blackhole/other'): ForgePr => ({ number, title: 't', body, headRefName, state: 'OPEN', mergedAt: null });

const fake = (claimed: Record<string, ForgeIssue[]>, prs: ForgePr[], failOn: number[] = []) => {
  const calls: unknown[][] = [];
  const adapter = {
    issueList: async (f: { labels?: string[] }) => claimed[f.labels?.[0] ?? ''] ?? [],
    prList: async () => prs,
    labelRemove: async (e: { number: number }, l: unknown) => {
      if (failOn.includes(e.number)) throw new Error(`forge down for ${e.number}`);
      calls.push(['labelRemove', e, l]);
    },
    issueComment: async (n: number, b: string) => void calls.push(['issueComment', n, b]),
  } as unknown as ForgeAdapter;
  return { adapter, calls };
};

describe('runReleaseClaims', () => {
  test('no lane, claim_labels set: releases a claim without an open PR, keeps one with an open PR', async () => {
    write({ claim_labels: ['in-progress:claude'] }, [10, 11]);
    const f = fake({ 'in-progress:claude': [issue(10, 'in-progress:claude'), issue(11, 'in-progress:claude')] }, [pr(50, 'Closes #11')]);
    const report = await runReleaseClaims(['--campaign-dir', dir], { adapter: f.adapter });
    expect(report).toEqual({ released: [{ issue: 10, label: 'in-progress:claude' }], kept: [{ issue: 11, label: 'in-progress:claude', pr: 50 }], failed: [] });
    expect(f.calls).toEqual([
      ['labelRemove', { type: 'issue', number: 10 }, ['in-progress:claude']],
      ['issueComment', 10, RELEASE_COMMENT],
    ]);
  });

  test('an issue outside the queue is never touched', async () => {
    write({ claim_labels: ['in-progress:claude'] }, [10]);
    const f = fake({ 'in-progress:claude': [issue(99, 'in-progress:claude')] }, []);
    expect(await runReleaseClaims(['--campaign-dir', dir], { adapter: f.adapter })).toEqual({ released: [], kept: [], failed: [] });
    expect(f.calls).toEqual([]);
  });

  test.each(['ready', 'blocked'])('a %s queue entry the campaign never dispatched keeps its claim label', async (status) => {
    write({ claim_labels: ['in-progress:claude'] }, [10], status);
    const f = fake({ 'in-progress:claude': [issue(10, 'in-progress:claude')] }, []);
    expect(await runReleaseClaims(['--campaign-dir', dir], { adapter: f.adapter })).toEqual({ released: [], kept: [], failed: [] });
    expect(f.calls).toEqual([]);
  });

  test.each(['in-flight', 'merged', 'closed'])('a %s queue entry the campaign dispatched is released', async (status) => {
    write({ claim_labels: ['in-progress:claude'] }, [10], status);
    const f = fake({ 'in-progress:claude': [issue(10, 'in-progress:claude')] }, []);
    const report = await runReleaseClaims(['--campaign-dir', dir], { adapter: f.adapter });
    expect(report.released).toEqual([{ issue: 10, label: 'in-progress:claude' }]);
  });

  test('a forge error on one issue is reported in failed and the other issues are still released', async () => {
    write({ claim_labels: ['in-progress:claude'] }, [10, 11, 12]);
    const f = fake({ 'in-progress:claude': [10, 11, 12].map((n) => issue(n, 'in-progress:claude')) }, [pr(50, 'Closes #12')], [10]);
    const report = await runReleaseClaims(['--campaign-dir', dir], { adapter: f.adapter });
    expect(report).toEqual({
      released: [{ issue: 11, label: 'in-progress:claude' }],
      kept: [{ issue: 12, label: 'in-progress:claude', pr: 50 }],
      failed: [{ issue: 10, label: 'in-progress:claude', error: 'forge down for 10' }],
    });
    expect(f.calls).toEqual([
      ['labelRemove', { type: 'issue', number: 11 }, ['in-progress:claude']],
      ['issueComment', 11, RELEASE_COMMENT],
    ]);
  });

  test('exit code is 1 when any release failed, 0 otherwise', () => {
    expect(reportExitCode({ released: [], kept: [], failed: [{ issue: 1, label: 'l', error: 'e' }] })).toBe(1);
    expect(reportExitCode({ released: [{ issue: 1, label: 'l' }], kept: [], failed: [] })).toBe(0);
  });

  test('no claim_labels prints empty sets and never reads the forge', async () => {
    write({}, [10]);
    const f = fake({}, []);
    expect(await runReleaseClaims(['--campaign-dir', dir], { adapter: f.adapter })).toEqual({ released: [], kept: [], failed: [] });
    expect(f.calls).toEqual([]);
  });

  test('a malformed claim_labels throws with the key name', async () => {
    write({ claim_labels: 'in-progress:claude' }, [10]);
    await expect(runReleaseClaims(['--campaign-dir', dir], { adapter: fake({}, []).adapter })).rejects.toThrow('claim_labels');
  });

  test('an unknown flag is a UsageError', async () => {
    write({}, []);
    await expect(runReleaseClaims(['--campaign-dir', dir, '--nope', 'x'], {})).rejects.toBeInstanceOf(UsageError);
  });
});

describe('prLinksIssue', () => {
  test.each([
    ['Closes #12', 'blackhole/x', true],
    ['Part of #12', 'blackhole/x', true],
    ['Refs #12', 'blackhole/x', true],
    ['mentions #12 in passing', 'blackhole/x', false],
    ['', 'blackhole/issue-12', true],
    ['', 'blackhole/issue-123', false],
  ])('body %p branch %p -> %p', (body, branch, linked) => {
    expect(prLinksIssue(pr(1, body, branch), 12)).toBe(linked);
  });

  test('a branch number must be a whole token', () => {
    expect(branchNamesIssue('claude/v2-12-foo', 12)).toBe(true);
    expect(branchNamesIssue('claude/v2-112-foo', 12)).toBe(false);
  });
});

describe('readClaimLabels', () => {
  test('absent reads as none and duplicates collapse', () => {
    expect(readClaimLabels({})).toEqual([]);
    expect(readClaimLabels({ claim_labels: ['a', 'a'] })).toEqual(['a']);
  });
});
