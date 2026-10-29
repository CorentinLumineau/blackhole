import { describe, expect, test } from 'bun:test';
import { pickStackParent, touchPathsOverlap } from './stack-parent.ts';

describe('touchPathsOverlap', () => {
  test('nested literal prefixes overlap', () => {
    expect(touchPathsOverlap(['src/a/**'], ['src/a/b.ts'])).toBe(true);
  });
  test('disjoint prefixes do not overlap', () => {
    expect(touchPathsOverlap(['src/a/**'], ['src/ab/**'])).toBe(false);
  });
  test('a bare wildcard overlaps everything', () => {
    expect(touchPathsOverlap(['**'], ['docs/x.md'])).toBe(true);
  });
});

describe('pickStackParent', () => {
  const base = {
    '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
    '11': { status: 'ready', pr: null, touch_paths: ['src/a/x.ts'] },
  };
  test('stacks on the open-PR overlapping issue', () => {
    expect(pickStackParent(base, 11)).toEqual({
      parent: 10,
      parentBranch: 'blackhole/issue-10',
      parentPr: 100,
      issueLinkKeyword: 'Part of',
    });
  });
  test('ignores merged parents and issues without a PR', () => {
    expect(pickStackParent({ ...base, '10': { ...base['10'], status: 'merged' } }, 11)).toBeNull();
    expect(pickStackParent({ ...base, '10': { ...base['10'], pr: null } }, 11)).toBeNull();
  });
  test('does not restack or form a cycle', () => {
    expect(pickStackParent({ ...base, '11': { ...base['11'], stacked_on: 5 } }, 11)).toBeNull();
    expect(pickStackParent({ ...base, '10': { ...base['10'], stacked_on: 11 } }, 11)).toBeNull();
  });
  test('chains transitively: lowest open overlapping issue wins', () => {
    const q = { ...base, '12': { status: 'ready', touch_paths: ['src/a/y.ts'] } };
    expect(pickStackParent(q, 12)?.parent).toBe(10);
  });
});
