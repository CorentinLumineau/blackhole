import { describe, expect, test } from 'bun:test';
import { isBlackholeBranchName } from './campaign-branch.ts';

describe('isBlackholeBranchName', () => {
  test.each([
    ['blackhole/issue-12', true],
    ['blackhole/issue-1239-cd-tracking', true],
    ['blackhole/issue-12-v1.2_x', true],
    ['blackhole/issue-12-', false],
    ['blackhole/issue-12x', false],
    ['blackhole/issue-', false],
    ['blackhole/issue-abc', false],
    ['claude/issue-12-fix', false],
    ['xblackhole/issue-12', false],
    ['blackhole/issue-12/extra', false],
  ])('%s -> %s', (name, expected) => {
    expect(isBlackholeBranchName(name)).toBe(expected);
  });
});
