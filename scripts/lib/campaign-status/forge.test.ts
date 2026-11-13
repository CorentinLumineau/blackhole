import { describe, expect, test } from 'bun:test';
import type { ForgeIssue } from '../forge-adapter/types.ts';
import { fakeForge, prRow } from './forge-fake.ts';
import { fetchForgeCounts, fetchMergedPrs, MERGED_PR_LIMIT } from './forge.ts';

const issue = (number: number, milestone: string | null = null): ForgeIssue => ({
  number,
  title: `issue ${number}`,
  body: '',
  labels: [],
  milestone: milestone ? { title: milestone } : null,
  state: 'OPEN',
});

describe('fetchForgeCounts, through the forge adapter', () => {
  test('a Gitea forge is counted by its own adapter, not by gh', async () => {
    const forge = fakeForge({ forge: 'gitea', issues: [issue(1), issue(2)], prs: { open: [prRow(10), prRow(11)] } });
    expect(await fetchForgeCounts({}, forge)).toEqual({
      openIssues: 2,
      openPrs: 2,
      openPrList: [
        { number: 10, title: 'PR 10' },
        { number: 11, title: 'PR 11' },
      ],
      ok: true,
    });
  });

  test('the milestone scope is applied to the adapter rows', async () => {
    const forge = fakeForge({ issues: [issue(1, 'v1'), issue(2, 'v2')], prs: { open: [] } });
    expect((await fetchForgeCounts({ milestone: 'v1' }, forge)).openIssues).toBe(1);
  });

  test('an unreachable forge is ok:false with its message, never a clean zero', async () => {
    expect(await fetchForgeCounts({}, fakeForge({ prs: { open: [] } }))).toMatchObject({ ok: false, openIssues: 0, openPrs: 0 });
    const prFails = await fetchForgeCounts({}, fakeForge({ issues: [issue(1), issue(2)] }));
    expect(prFails).toMatchObject({ ok: false, openIssues: 2, openPrs: 0 });
    expect(prFails.error).toContain('prList');
  });
});

describe('fetchMergedPrs', () => {
  test('keeps the merged PRs of the forge with their merge time, and drops open and closed-unmerged ones', async () => {
    const forge = fakeForge({
      prs: {
        all: [
          prRow(30, { title: 'feat(a): one', state: 'MERGED', mergedAt: '2026-11-12T08:00:00Z' }),
          prRow(31, { state: 'CLOSED' }),
          prRow(32),
          prRow(33, { title: 'fix(b): two', state: 'MERGED', mergedAt: '2026-11-13T07:00:00Z' }),
        ],
      },
    });
    expect(await fetchMergedPrs(forge)).toEqual([
      { number: 30, title: 'feat(a): one', mergedAt: '2026-11-12T08:00:00Z', closes: [], labels: undefined },
      { number: 33, title: 'fix(b): two', mergedAt: '2026-11-13T07:00:00Z', closes: [], labels: undefined },
    ]);
    expect(forge.calls).toEqual([`prList:all:${MERGED_PR_LIMIT}`]);
  });

  test('carries the issues a PR body closes and the labels the forge reports', async () => {
    const forge = fakeForge({
      prs: { all: [prRow(40, { state: 'MERGED', mergedAt: '2026-11-12T08:00:00Z', body: 'Closes #7', labels: ['campaign'] })] },
    });
    expect(await fetchMergedPrs(forge)).toEqual([{ number: 40, title: 'PR 40', mergedAt: '2026-11-12T08:00:00Z', closes: [7], labels: ['campaign'] }]);
  });

  test('a failed read is null ("not read"), never an empty list', async () => {
    expect(await fetchMergedPrs(fakeForge())).toBeNull();
  });
});

describe('a forge failure message', () => {
  test('is the forge\'s own text, and a JSON parse failure is named without a forge', async () => {
    const parse = fakeForge({ issues: [issue(1)] });
    parse.prList = async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    };
    const out = await fetchForgeCounts({}, parse);
    expect(out.error).toBe('the forge answered with invalid JSON');
    expect(out.error).not.toContain('gh');
  });
});
