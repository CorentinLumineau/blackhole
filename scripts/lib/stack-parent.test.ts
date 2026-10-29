import { describe, expect, test } from 'bun:test';
import {
  formatStackMergeOrder,
  globsMatchFiles,
  pickStackParent,
  stackMergeOrder,
  touchPathsOverlap,
} from './stack-parent.ts';

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

describe('globsMatchFiles', () => {
  test('a glob matches only concrete files it covers', () => {
    expect(globsMatchFiles(['src/a/*.ts'], ['src/a/x.ts'])).toBe(true);
    expect(globsMatchFiles(['src/a/*.ts'], ['src/a/x.md'])).toBe(false);
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
  test('each default or broad glob is dropped individually from a mixed list', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/x.ts'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts', 'src/**', 'scripts/**'] },
      '12': { status: 'ready', touch_paths: ['src/**', 'scripts/**'] },
    };
    const o = { defaultTouchPaths: ['src/**', 'scripts/**'] };
    expect(pickStackParent(q, 11, o)?.parent).toBe(10);
    expect(pickStackParent(q, 12, o)).toBeNull();
  });
  test('broad globs are unknown even when no defaults are supplied', () => {
    for (const g of ['src/**', 'scripts/**', '**', '*.md']) {
      const q = {
        '10': { status: 'in-flight', pr: 100, touch_paths: [g] },
        '11': { status: 'ready', touch_paths: [g] },
      };
      expect(pickStackParent(q, 11)).toBeNull();
    }
  });
  test('an empty parentFiles list is unknown and falls back to the parent narrowed touch_paths', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/x.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': [] } })?.parent).toBe(10);
  });
  test('a child glob must match a concrete parent file, not just share a prefix', () => {
    const q = {
      '10': { status: 'in-flight', pr: 100, touch_paths: ['src/a/**'] },
      '11': { status: 'ready', touch_paths: ['src/a/*.ts'] },
    };
    expect(pickStackParent(q, 11, { parentFiles: { '10': ['src/a/x.md'] } })).toBeNull();
  });
});

describe('stackMergeOrder', () => {
  const pr = (n: number, extra: Record<string, unknown> = {}) => ({ [String(n)]: { status: 'in-flight', pr: n + 1000, ...extra } });
  const fmt = (issues: Record<string, never>) => stackMergeOrder(issues).map(formatStackMergeOrder);

  test('linear chain', () => {
    const issues = { ...pr(1), ...pr(2, { stacked_on: 1 }), ...pr(3, { stacked_on: 2 }) } as never;
    expect(fmt(issues)).toEqual(['merge #1, then #2 (stacked on #1), then #3 (stacked on #2)']);
  });
  test('branching: lowest-numbered child first, depth-first', () => {
    const issues = { ...pr(1), ...pr(5, { stacked_on: 1 }), ...pr(2, { stacked_on: 1 }), ...pr(3, { stacked_on: 2 }) } as never;
    expect(fmt(issues)).toEqual([
      'merge #1, then #2 (stacked on #1), then #3 (stacked on #2), then #5 (stacked on #1)',
    ]);
  });
  test('independent PRs are not listed', () => {
    expect(stackMergeOrder({ ...pr(1), ...pr(2) } as never)).toEqual([]);
  });
  test('merged parent is dropped; child heads the remaining stack', () => {
    const issues = {
      '1': { status: 'merged', pr: 1001 },
      ...pr(2, { stacked_on: 1 }),
      ...pr(3, { stacked_on: 2 }),
    } as never;
    expect(fmt(issues)).toEqual(['merge #2, then #3 (stacked on #2)']);
  });
  test('empty queue yields no stacks', () => {
    expect(stackMergeOrder({})).toEqual([]);
  });
});
