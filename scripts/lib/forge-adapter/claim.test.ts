import { describe, expect, test } from 'bun:test';
import { claimIssue, latestClosingPrActivity, releaseIssue, type ClaimOps, type ClaimSnapshot } from './claim.ts';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const ago = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
const lease = { leaseHours: 24, now: NOW };

const fake = (snaps: ClaimSnapshot[], prActivity: string | null = null) => {
  const calls: string[] = [];
  let reads = 0;
  const ops: ClaimOps = {
    read: async () => snaps[Math.min(reads++, snaps.length - 1)],
    prActivity: async () => prActivity,
    ensureLabel: async (l) => void calls.push(`ensure ${l}`),
    labelAdd: async (_i, l) => void calls.push(`add ${l}`),
    labelRemove: async (_i, l) => void calls.push(`remove ${l}`),
    assign: async (_i, u) => void calls.push(`assign ${u}`),
    unassign: async (_i, u) => void calls.push(`unassign ${u}`),
  };
  return { ops, calls, reads: () => reads };
};
const snap = (labels: string[], extra: Partial<ClaimSnapshot> = {}): ClaimSnapshot => ({ state: 'OPEN', labels, assignees: [], updatedAt: ago(1), ...extra });

describe('claimIssue', () => {
  test('claims an unclaimed issue and reads back once', async () => {
    const f = fake([snap([])]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'CLAIMED' });
    expect(f.calls).toEqual(['ensure in-progress:acct-a', 'add in-progress:acct-a', 'assign me']);
    expect(f.reads()).toBe(2);
  });
  test('already labelled and assigned writes nothing', async () => {
    const f = fake([snap(['in-progress:acct-a'], { assignees: ['me'] })]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'ALREADY-OWN' });
    expect(f.calls).toEqual([]);
  });
  test('labelled but not assigned only assigns', async () => {
    const f = fake([snap(['in-progress:acct-a'])]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'CLAIMED' });
    expect(f.calls).toEqual(['assign me']);
  });
  test('a live foreign claim is HELD with no write', async () => {
    const f = fake([snap(['in-progress:acct-b'], { updatedAt: ago(2) })]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'HELD', held_by: 'acct-b' });
    expect(f.calls).toEqual([]);
  });
  test('a stale foreign claim is reclaimed', async () => {
    const f = fake([snap(['in-progress:acct-b'], { updatedAt: ago(30) }), snap(['in-progress:acct-a'])]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'RECLAIMED' });
    expect(f.calls).toEqual(['ensure in-progress:acct-a', 'remove in-progress:acct-b', 'add in-progress:acct-a', 'assign me']);
  });
  test('recent PR activity keeps a stale-looking claim held', async () => {
    const f = fake([snap(['in-progress:acct-b'], { updatedAt: ago(30) })], ago(1));
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'HELD', held_by: 'acct-b' });
  });
  test('agent labels never lease', async () => {
    const f = fake([snap(['agent:cursor'], { updatedAt: ago(30) })]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'HELD', held_by: 'cursor' });
  });
  test('a closed issue writes nothing', async () => {
    const f = fake([snap([], { state: 'CLOSED' })]);
    expect(await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'CLOSED' });
    expect(f.calls).toEqual([]);
  });
  test('an absent updatedAt on a foreign claim reads as live', async () => {
    const f = fake([snap(['in-progress:acct-b'], { updatedAt: null })]);
    expect((await claimIssue(f.ops, 1, 'acct-a', 'me', lease)).verdict).toBe('HELD');
  });
  test('a race is settled by lane order: the greater lane rolls back', async () => {
    const rival = snap(['in-progress:acct-b', 'in-progress:acct-z'], { assignees: ['me'] });
    const z = fake([snap([]), rival]);
    expect(await claimIssue(z.ops, 1, 'acct-z', 'me', lease)).toEqual({ verdict: 'HELD', held_by: 'acct-b' });
    expect(z.calls).toContain('remove in-progress:acct-z');
    expect(z.calls).toContain('unassign me');
    const a = fake([snap([]), snap(['in-progress:acct-b', 'in-progress:acct-a'])]);
    expect(await claimIssue(a.ops, 1, 'acct-a', 'me', lease)).toEqual({ verdict: 'CLAIMED' });
  });
});

describe('releaseIssue', () => {
  test('removes the own label and unassigns the user', async () => {
    const f = fake([snap(['in-progress:acct-a'], { assignees: ['me', 'other'] })]);
    expect(await releaseIssue(f.ops, 1, 'acct-a', 'me')).toEqual({ verdict: 'RELEASED' });
    expect(f.calls).toEqual(['remove in-progress:acct-a', 'unassign me']);
  });
  test('without the own label it touches nothing', async () => {
    const f = fake([snap(['in-progress:acct-b'])]);
    expect(await releaseIssue(f.ops, 1, 'acct-a', 'me')).toEqual({ verdict: 'NOT-HELD' });
    expect(f.calls).toEqual([]);
  });
});

describe('latestClosingPrActivity', () => {
  const pr = (n: number, body: string, updatedAt: string | undefined, state: 'OPEN' | 'MERGED' = 'OPEN') => ({ number: n, title: 't', body, headRefName: 'x', state, mergedAt: null, updatedAt });
  test('takes the latest open closing PR', () => {
    expect(latestClosingPrActivity([pr(1, 'Closes #5', ago(5)), pr(2, 'Fixes #5', ago(2)), pr(3, 'Closes #6', ago(1)), pr(4, 'Closes #5', ago(0), 'MERGED')], 5)).toBe(ago(2));
    expect(latestClosingPrActivity([], 5)).toBeNull();
  });
});
