import { describe, expect, test } from 'bun:test';
import { prLandingFromRow, readPrLanding } from './pr-landing.ts';

describe('prLandingFromRow', () => {
  test('a GitHub squash-merged row is merged and carries the merge commit', () => {
    expect(
      prLandingFromRow({ state: 'closed', merged: true, merged_at: '2026-01-02T03:04:05Z', merge_commit_sha: 'abc123' }),
    ).toEqual({ state: 'merged', mergedAt: '2026-01-02T03:04:05Z', mergeCommitSha: 'abc123' });
  });

  test('a Gitea row with only merged_at set is merged', () => {
    expect(prLandingFromRow({ state: 'closed', merged_at: '2026-01-02T03:04:05Z' })).toEqual({
      state: 'merged',
      mergedAt: '2026-01-02T03:04:05Z',
      mergeCommitSha: null,
    });
  });

  test('closed with no merge evidence is closed-unmerged', () => {
    expect(prLandingFromRow({ state: 'closed', merged: false, merged_at: null })).toEqual({
      state: 'closed-unmerged',
      mergedAt: null,
      mergeCommitSha: null,
    });
  });

  test('an open row is open', () => {
    expect(prLandingFromRow({ state: 'open', merged: false })).toEqual({ state: 'open', mergedAt: null, mergeCommitSha: null });
  });

  test('a state that is neither open nor closed, with no merge evidence, is unreadable', () => {
    expect(prLandingFromRow({ state: 'draft' })).toBeNull();
    expect(prLandingFromRow({ state: 'weird', merged: false })).toBeNull();
  });

  test('a row with no state is unreadable (null), never open', () => {
    expect(prLandingFromRow({})).toBeNull();
    expect(prLandingFromRow(null)).toBeNull();
  });
});

describe('readPrLanding', () => {
  test('reads the row through the injected fetcher', () => {
    const landing = readPrLanding('github', 'o/r', 7, () => ({ state: 'closed', merged: true }));
    expect(landing?.state).toBe('merged');
  });

  test('a throwing fetcher is null, never open', () => {
    expect(
      readPrLanding('github', 'o/r', 7, () => {
        throw new Error('network down');
      }),
    ).toBeNull();
  });

  test('a forge with no reader is null', () => {
    expect(readPrLanding('gitlab' as never, 'o/r', 7, () => ({ state: 'open' }))).toBeNull();
  });
});
