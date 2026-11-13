import { describe, expect, test } from 'bun:test';
import type { ForgeCheck } from '../forge-adapter/types.ts';
import { fakeForge, prRow } from './forge-fake.ts';
import { ciOf, fetchPrSignals, reviewOf } from './pr-signals.ts';

describe('ciOf / reviewOf', () => {
  const check = (status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED', conclusion: string | null, name = 'ci') =>
    ({ name, status, conclusion }) as Parameters<typeof ciOf>[0][number];

  test('no check is "none", never green; a running check is "running"; all success is green', () => {
    expect(ciOf([])).toEqual({ ci: 'none', failing: [] });
    expect(ciOf([check('COMPLETED', 'SUCCESS'), check('IN_PROGRESS', null)])).toEqual({ ci: 'running', failing: [] });
    expect(ciOf([check('COMPLETED', 'SUCCESS'), check('COMPLETED', 'SKIPPED')])).toEqual({ ci: 'green', failing: [] });
  });

  test('failed, cancelled or action-required checks fail CI and are named once, sorted', () => {
    expect(ciOf([check('COMPLETED', 'FAILURE', 'unit'), check('COMPLETED', 'CANCELLED', 'lint'), check('COMPLETED', 'FAILURE', 'unit')])).toEqual({
      ci: 'failing',
      failing: ['lint', 'unit'],
    });
  });

  test('the verdict is the ai-review label without its prefix', () => {
    expect(reviewOf([{ name: 'bug' }, { name: 'ai-review:NEEDS_CHANGES' }])).toBe('NEEDS_CHANGES');
    expect(reviewOf(['ai-review:LGTM'])).toBe('LGTM');
    expect(reviewOf([{ name: 'bug' }])).toBeNull();
    expect(reviewOf(undefined)).toBeNull();
  });
});

describe('fetchPrSignals, through the forge adapter', () => {
  const ok = (name: string): ForgeCheck => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' });

  test('a Gitea PR carries its review verdict, CI and mergeability', async () => {
    const forge = fakeForge({
      forge: 'gitea',
      views: {
        7: prRow(7, { labels: ['bug', 'ai-review:LGTM'], mergeable: true }),
        8: prRow(8, { labels: [], mergeable: false }),
      },
      checks: { 7: [ok('build'), ok('test')], 8: [{ name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' }] },
    });
    const signals = await fetchPrSignals(forge, [8, 7]);
    expect(signals[7]).toEqual({ review: 'LGTM', review_read: true, mergeable: true, ci: 'green', failing: [] });
    expect(signals[8]).toEqual({ review: null, review_read: true, mergeable: false, ci: 'failing', failing: ['unit'] });
  });

  test('a mergeability the forge has not computed is null, not a conflict', async () => {
    const forge = fakeForge({ views: { 1: prRow(1, { mergeable: null }), 2: prRow(2) }, checks: { 1: [], 2: [] } });
    const signals = await fetchPrSignals(forge, [1, 2]);
    expect(signals[1]!.mergeable).toBeNull();
    expect(signals[2]!.mergeable).toBeNull();
  });

  test('reads the lowest PRs up to the cap and leaves out a PR whose reads all fail', async () => {
    const forge = fakeForge({
      views: { 1: prRow(1), 5: prRow(5), 9: prRow(9) },
      checks: { 1: [{ name: 'build', status: 'IN_PROGRESS', conclusion: null }], 5: [], 9: [] },
    });
    const signals = await fetchPrSignals(forge, [9, 2, 1, 5], 3);
    expect(Object.keys(signals).map(Number)).toEqual([1, 5]);
    expect(signals[1]).toEqual({ review: null, review_read: true, mergeable: null, ci: 'running', failing: [] });
    expect(forge.calls.filter((c) => c.startsWith('prView:'))).toEqual(['prView:1', 'prView:2', 'prView:5']);
  });

  // One failing read must not discard the others: each is a separate forge call and a separate fact.
  test('a failing CI read keeps the review verdict and mergeability, and marks CI unknown', async () => {
    const forge = fakeForge({ views: { 3: prRow(3, { labels: ['ai-review:LGTM'], mergeable: true }) } });
    expect(await fetchPrSignals(forge, [3])).toEqual({ 3: { review: 'LGTM', review_read: true, mergeable: true, ci: 'unknown', failing: [] } });
  });

  test('a failing review read keeps CI, and marks the review unknown', async () => {
    const forge = fakeForge({ checks: { 4: [{ name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' }] } });
    expect(await fetchPrSignals(forge, [4])).toEqual({ 4: { review: null, review_read: false, mergeable: null, ci: 'failing', failing: ['unit'] } });
  });

  test('a PR whose reads all fail has no signal, so the card says "not checked" and never "no CI"', async () => {
    expect(await fetchPrSignals(fakeForge(), [5])).toEqual({});
  });
});
