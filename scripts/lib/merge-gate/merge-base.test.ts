import { describe, expect, test } from 'bun:test';
import {
  assertPreMergeBase,
  classifyPostMergeVerification,
  landedOnBranch,
  mergedIntoVerdict,
  verifyPostMergeLanding,
} from './merge-base.ts';

describe('assertPreMergeBase', () => {
  test('accepts a PR whose base is the campaign target branch', () => {
    const result = assertPreMergeBase({ baseRefName: 'main', targetBranch: 'main' });
    expect(result).toEqual({ ok: true });
  });

  test('refuses a stacked PR with no opt-in, naming both branches', () => {
    const result = assertPreMergeBase({ baseRefName: 'blackhole/issue-700', targetBranch: 'main' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('blackhole/issue-700');
    expect(result.reason).toContain('main');
  });

  test('accepts a stacked PR when the opt-in names the actual base', () => {
    expect(
      assertPreMergeBase({
        baseRefName: 'blackhole/issue-700',
        targetBranch: 'main',
        stackedInto: 'blackhole/issue-700',
      }),
    ).toEqual({ ok: true });
  });

  test('refuses when the opt-in names a branch that is not the actual base', () => {
    const result = assertPreMergeBase({
      baseRefName: 'blackhole/issue-700',
      targetBranch: 'main',
      stackedInto: 'blackhole/issue-999',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('blackhole/issue-999');
  });

  test('refuses a stacked opt-in on a PR that actually targets the base branch', () => {
    const result = assertPreMergeBase({
      baseRefName: 'main',
      targetBranch: 'main',
      stackedInto: 'blackhole/issue-700',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('blackhole/issue-700');
  });

  test('refuses an unreadable baseRefName instead of defaulting to the target branch', () => {
    const result = assertPreMergeBase({ baseRefName: '', targetBranch: 'main' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unreadable');
  });
});

describe('landedOnBranch', () => {
  test('matches a squash-merge subject carrying the PR number', () => {
    expect(landedOnBranch('a1b2c3d fix(merge): assert the PR base (#793)\n', 793)).toBe(true);
  });

  test('matches a merge-commit subject carrying the PR number', () => {
    expect(landedOnBranch('a1b2c3d Merge pull request #793 from CorentinLumineau/x\n', 793)).toBe(true);
  });

  test('does not match a longer number containing the PR number as a prefix', () => {
    expect(landedOnBranch('a1b2c3d chore: something (#7930)\n', 793)).toBe(false);
  });

  test('does not match a longer number containing the PR number as a suffix', () => {
    expect(landedOnBranch('a1b2c3d chore: something (#1793)\n', 793)).toBe(false);
  });

  test('empty log output is a miss', () => {
    expect(landedOnBranch('', 793)).toBe(false);
    expect(landedOnBranch('   \n', 793)).toBe(false);
  });
});

describe('classifyPostMergeVerification', () => {
  test('a hit on any attempt is verified', () => {
    expect(classifyPostMergeVerification({ landed: true, attempt: 1, maxAttempts: 3 })).toBe('verified');
    expect(classifyPostMergeVerification({ landed: true, attempt: 3, maxAttempts: 3 })).toBe('verified');
  });

  test('a miss below the attempt cap retries rather than concluding', () => {
    expect(classifyPostMergeVerification({ landed: false, attempt: 1, maxAttempts: 3 })).toBe('retry');
    expect(classifyPostMergeVerification({ landed: false, attempt: 2, maxAttempts: 3 })).toBe('retry');
  });

  test('a miss at the attempt cap is terminal, never tolerated as lag', () => {
    expect(classifyPostMergeVerification({ landed: false, attempt: 3, maxAttempts: 3 })).toBe('failed');
    expect(classifyPostMergeVerification({ landed: false, attempt: 4, maxAttempts: 3 })).toBe('failed');
  });

  test('throws on a non-positive attempt budget instead of silently passing', () => {
    expect(() => classifyPostMergeVerification({ landed: false, attempt: 1, maxAttempts: 0 })).toThrow(
      RangeError,
    );
    expect(() => classifyPostMergeVerification({ landed: false, attempt: 0, maxAttempts: 3 })).toThrow(
      RangeError,
    );
  });
});

describe('verifyPostMergeLanding', () => {
  test('stops at the first attempt that finds the commit', () => {
    const waits: number[] = [];
    const result = verifyPostMergeLanding({
      prNumber: 793,
      targetBranch: 'main',
      maxAttempts: 3,
      intervalMs: 5000,
      readLog: () => 'a1b2c3d feat: thing (#793)',
      wait: (ms) => waits.push(ms),
    });
    expect(result).toEqual({ ok: true, attempts: 1 });
    expect(waits).toEqual([]);
  });

  test('retries up to the cap and succeeds on a later attempt', () => {
    const waits: number[] = [];
    const result = verifyPostMergeLanding({
      prNumber: 793,
      targetBranch: 'main',
      maxAttempts: 3,
      intervalMs: 5000,
      readLog: (attempt) => (attempt < 3 ? '' : 'a1b2c3d feat: thing (#793)'),
      wait: (ms) => waits.push(ms),
    });
    expect(result).toEqual({ ok: true, attempts: 3 });
    expect(waits).toEqual([5000, 5000]);
  });

  test('exhausting the cap reports a terminal miss naming the PR and branch', () => {
    const result = verifyPostMergeLanding({
      prNumber: 793,
      targetBranch: 'main',
      maxAttempts: 2,
      intervalMs: 1,
      readLog: () => '',
      wait: () => {},
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.reason).toContain('#793');
    expect(result.reason).toContain('main');
  });
});

describe('mergedIntoVerdict', () => {
  test('reports base when the recorded branch is the campaign target', () => {
    expect(mergedIntoVerdict({ status: 'merged', merged_into: 'main' }, 'main')).toBe('base');
  });

  test('reports other when the PR landed on a different branch', () => {
    expect(mergedIntoVerdict({ status: 'merged', merged_into: 'blackhole/issue-700' }, 'main')).toBe('other');
  });

  test('an absent merged_into is unknown, never inferred as the base ref', () => {
    expect(mergedIntoVerdict({ status: 'merged' }, 'main')).toBe('unknown');
    expect(mergedIntoVerdict({ status: 'merged', merged_into: '' }, 'main')).toBe('unknown');
    expect(mergedIntoVerdict({ status: 'merged', merged_into: null }, 'main')).toBe('unknown');
  });

  test('a row that is not merged is unknown regardless of any recorded branch', () => {
    expect(mergedIntoVerdict({ status: 'in-flight', merged_into: 'main' }, 'main')).toBe('unknown');
  });
});
