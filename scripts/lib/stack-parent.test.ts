import { describe, expect, test } from 'bun:test';
import { pickStackParent, touchPathsOverlap } from './stack-parent.ts';

describe('touchPathsOverlap', () => {
  test('nested literal prefixes overlap', () => {
    expect(touchPathsOverlap(['src/a/**'], ['src/a/b.ts'])).toBe(true);
  });
  test('disjoint prefixes do not overlap', () => {
    expect(touchPathsOverlap(['src/a/**'], ['src/ab/**'])).toBe(false);
  });
  test('a root-only wildcard overlaps nothing', () => {
    expect(touchPathsOverlap(['**'], ['docs/x.md'])).toBe(false);
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
  test('A->B->C: the third overlapping issue stacks on the chain tip', () => {
    const q = {
      ...base,
      '11': { status: 'in-flight', pr: 101, touch_paths: ['src/a/x.ts'], stacked_on: 10 },
      '12': { status: 'ready', touch_paths: ['src/a/y.ts'] },
    };
    expect(pickStackParent(q, 12)?.parent).toBe(11);
  });
  test('default touch_paths never stack', () => {
    const d = ['src/**', 'scripts/**'];
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: d },
      '11': { status: 'ready', touch_paths: d },
    };
    expect(pickStackParent(q, 11, { defaultTouchPaths: d })).toBeNull();
    expect(pickStackParent({ ...q, '11': { status: 'ready', touch_paths: ['**'] } }, 11)).toBeNull();
  });
  test('narrowed overlap stacks, narrowed disjoint pair does not', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts'] },
      '12': { status: 'ready', touch_paths: ['src/b/x.ts'] },
    };
    const o = { defaultTouchPaths: ['src/**'] };
    expect(pickStackParent(q, 11, o)?.parent).toBe(10);
    expect(pickStackParent(q, 12, o)).toBeNull();
  });
  test('parent PR changed files take precedence over declared globs', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['docs/z.md'] } })).toBeNull();
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['src/a/x.ts'] } })?.parent).toBe(10);
  });
});
